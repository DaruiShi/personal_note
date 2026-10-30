package site.funshare.notes

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/** Server returned a non-2xx response; [code] is the machine-readable code ("conflict", "trashed") when present. */
class ApiException(
    val status: Int,
    val code: String?,
    val payload: JSONObject? = null,
    message: String,
) : Exception(message)

/**
 * Percent-encode a file name for the X-File-Name header. HTTP header values
 * may only hold ISO-8859-1 code points, so a raw Chinese file name makes OkHttp
 * throw before the request is sent. The server decodes this back with
 * decodeURIComponent(), matching the web client's encodeURIComponent().
 * URLEncoder is form-urlencoded (space → "+"), which decodeURIComponent()
 * would leave literal, so spaces are mapped to %20 instead.
 */
internal fun encodeUploadName(name: String): String =
    URLEncoder.encode(name, "UTF-8").replace("+", "%20")

/**
 * HTTP client for the Personal Notes server (server.js). Auth is the server's
 * HttpOnly session cookie, persisted across app restarts via [Store].
 */
class Api(private val store: Store) {

    @Volatile
    private var client: OkHttpClient = buildClient()

    /** Rebuild after server URL / trust-all settings change. */
    fun reloadClient() {
        client.dispatcher.executorService.shutdown()
        client.connectionPool.evictAll()
        client = buildClient()
    }

    /** The live OkHttp client (shares cookies and trust-all TLS config). */
    fun httpClient(): OkHttpClient = client

    private fun buildClient(): OkHttpClient {
        val b = OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .cookieJar(PersistedCookieJar(store))
        if (store.trustAllCerts) {
            // For self-hosted servers reached by IP where the certificate does
            // not match the address (e.g. Caddy cert issued for the domain).
            val tm = object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            }
            val sc = SSLContext.getInstance("TLS")
            sc.init(null, arrayOf(tm), SecureRandom())
            b.sslSocketFactory(sc.socketFactory, tm)
            b.hostnameVerifier { _, _ -> true }
        }
        return b.build()
    }

    /* ------------------------------------------------------------ plumbing */

    private fun urlFor(path: String, baseUrlOverride: String?): HttpUrl {
        val base = normalizeBaseUrl(baseUrlOverride ?: store.serverUrl)
        return "$base$path".toHttpUrl()
    }

    private suspend fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        baseUrlOverride: String? = null,
    ): JSONObject = withContext(Dispatchers.IO) {
        val rb = Request.Builder().url(urlFor(path, baseUrlOverride))
        when (method) {
            "GET" -> rb.get()
            else -> rb.method(
                method,
                (body ?: JSONObject()).toString().toRequestBody("application/json; charset=utf-8".toMediaType()),
            )
        }
        client.newCall(rb.build()).execute().use { resp ->
            val text = try { resp.body?.string() ?: "" } catch (e: Exception) { "" }
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (!resp.isSuccessful) {
                throw ApiException(
                    resp.code,
                    json.optString("code").ifEmpty { null },
                    json,
                    json.optString("error").ifEmpty { "HTTP ${resp.code}" },
                )
            }
            json
        }
    }

    private fun parseNote(j: JSONObject): Note = Note.fromJson(j.optJSONObject("note") ?: j)

    private fun parseUser(o: JSONObject) = User(
        id = o.optString("id"),
        name = o.optString("name"),
        isAdmin = o.optBoolean("isAdmin"),
        createdAt = o.optLong("createdAt"),
    )

    /* ------------------------------------------------------------- session */

    suspend fun session(baseUrlOverride: String? = null): SessionInfo =
        SessionInfo.fromJson(request("GET", "/api/session", baseUrlOverride = baseUrlOverride))

    suspend fun login(username: String, password: String): User {
        val j = request("POST", "/api/login", JSONObject()
            .put("username", username)
            .put("password", password))
        return parseUser(j.optJSONObject("user") ?: JSONObject())
    }

    suspend fun register(username: String, password: String): User {
        val j = request("POST", "/api/register", JSONObject()
            .put("username", username)
            .put("password", password))
        return parseUser(j.optJSONObject("user") ?: JSONObject())
    }

    suspend fun logout() { request("POST", "/api/logout") }

    suspend fun logoutAll() { request("POST", "/api/logout-all") }

    suspend fun changePassword(current: String, next: String) {
        request("POST", "/api/password", JSONObject().put("current", current).put("next", next))
    }

    suspend fun deleteAccount(password: String) {
        request("DELETE", "/api/account", JSONObject().put("password", password))
    }

    /* --------------------------------------------------------------- notes */

    suspend fun listNotes(): List<Note> {
        val j = request("GET", "/api/notes")
        val a = j.optJSONArray("notes") ?: JSONArray()
        return List(a.length()) { Note.fromJson(a.optJSONObject(it)) }
    }

    private fun noteBody(
        title: String,
        content: String,
        tags: List<String>,
        pinned: Boolean,
        folderId: String?,
    ): JSONObject = JSONObject()
        .put("title", title)
        .put("content", content)
        .put("tags", JSONArray(tags))
        .put("pinned", pinned)
        .put("folderId", folderId ?: JSONObject.NULL)

    suspend fun createNote(
        title: String,
        content: String,
        tags: List<String>,
        pinned: Boolean,
        folderId: String? = null,
    ): Note = parseNote(request("POST", "/api/notes", noteBody(title, content, tags, pinned, folderId)))

    /** Create a timeline note; the server derives the markdown mirror. */
    suspend fun createTimelineNote(
        title: String,
        items: List<TimelineItem>,
        tags: List<String>,
        pinned: Boolean,
        folderId: String? = null,
    ): Note = parseNote(request("POST", "/api/notes", JSONObject()
        .put("kind", "timeline")
        .put("timeline", TimelineItem.listToJson(items))
        .put("title", title)
        .put("tags", JSONArray(tags))
        .put("pinned", pinned)
        .put("folderId", folderId ?: JSONObject.NULL)))

    /** Update a timeline note (kind + items; content is server-derived). */
    suspend fun updateTimelineNote(
        id: String,
        title: String,
        items: List<TimelineItem>,
        tags: List<String>,
        pinned: Boolean,
        folderId: String? = null,
        rev: Int? = null,
    ): Note {
        val body = JSONObject()
            .put("kind", "timeline")
            .put("timeline", TimelineItem.listToJson(items))
            .put("title", title)
            .put("tags", JSONArray(tags))
            .put("pinned", pinned)
            .put("folderId", folderId ?: JSONObject.NULL)
        if (rev != null) body.put("rev", rev)
        return parseNote(request("PUT", "/api/notes/$id", body))
    }

    /**
     * Send pasted text (and nothing else) to the server's timeline parser.
     * Returns { items, model }; throws ApiException (llm_not_configured /
     * busy / too_many_requests / llm_timeout / llm_failed / llm_unparsable).
     */
    suspend fun parseTimeline(text: String, today: String): Pair<List<NotesTimeline.Parsed>, String> {
        val j = request("POST", "/api/timeline/parse", JSONObject()
            .put("text", text)
            .put("today", today))
        val a = j.optJSONArray("items") ?: JSONArray()
        val items = List(a.length()) { i ->
            val o = a.optJSONObject(i) ?: JSONObject()
            NotesTimeline.Parsed(
                date = o.optString("date"),
                text = o.optString("text"),
                guessed = o.optBoolean("guessed"),
                start = o.optString("start").ifEmpty { null },
                end = o.optString("end").ifEmpty { null },
            )
        }
        return items to j.optString("model")
    }

    suspend fun updateNote(
        id: String,
        title: String,
        content: String,
        tags: List<String>,
        pinned: Boolean,
        folderId: String? = null,
        rev: Int? = null,
    ): Note {
        val body = noteBody(title, content, tags, pinned, folderId)
        if (rev != null) body.put("rev", rev)
        return parseNote(request("PUT", "/api/notes/$id", body))
    }

    suspend fun deleteNote(id: String) {
        request("DELETE", "/api/notes/$id")
    }

    /* --------------------------------------------------------------- trash */

    /** Notes currently in the trash, newest deleted first. */
    suspend fun listTrash(): List<Note> {
        val j = request("GET", "/api/trash")
        val a = j.optJSONArray("notes") ?: JSONArray()
        return List(a.length()) { Note.fromJson(a.optJSONObject(it)) }
    }

    /** Restore a trashed note; returns it live, with a bumped rev. */
    suspend fun restoreNote(id: String): Note =
        parseNote(request("POST", "/api/notes/$id/restore"))

    /** Permanently delete a note (the trash view's "delete forever"). */
    suspend fun purgeNote(id: String) {
        request("POST", "/api/notes/$id/purge")
    }

    /** Permanently delete every trashed note; returns how many went. */
    suspend fun emptyTrash(): Int = request("POST", "/api/trash/empty").optInt("purged")

    /* -------------------------------------------------------------- folders */

    suspend fun listFolders(): List<Folder> {
        val j = request("GET", "/api/folders")
        val a = j.optJSONArray("folders") ?: JSONArray()
        return List(a.length()) {
            val o = a.optJSONObject(it)
            Folder(
                id = o.optString("id"),
                name = o.optString("name"),
                noteCount = o.optInt("noteCount"),
                pinned = o.optBoolean("pinned"),
            )
        }
    }

    suspend fun createFolder(name: String): Folder {
        val j = request("POST", "/api/folders", JSONObject().put("name", name))
        val o = j.optJSONObject("folder") ?: JSONObject()
        return Folder(o.optString("id"), o.optString("name"), o.optInt("noteCount"), o.optBoolean("pinned"))
    }

    /** Persist the folder order (must be a permutation of all folder ids). */
    suspend fun reorderFolders(ids: List<String>) {
        request("POST", "/api/folders/reorder", JSONObject().put("ids", JSONArray(ids)))
    }

    /** Pin or unpin a folder; pinned folders sort above the rest. */
    suspend fun setFolderPinned(id: String, pinned: Boolean): Folder {
        val j = request("POST", "/api/folders/$id/pin", JSONObject().put("pinned", pinned))
        val o = j.optJSONObject("folder") ?: JSONObject()
        return Folder(o.optString("id"), o.optString("name"), o.optInt("noteCount"), o.optBoolean("pinned"))
    }

    suspend fun renameFolder(id: String, name: String) {
        request("PUT", "/api/folders/$id", JSONObject().put("name", name))
    }

    suspend fun deleteFolder(id: String) {
        request("DELETE", "/api/folders/$id")
    }

    /**
     * Upload a file (image or document; the server sniffs magic bytes) and
     * return the server-relative URL ("/uploads/<hash>.<ext>"). The original
     * file name rides percent-encoded in X-File-Name so the server can record
     * it and pick the right extension for container formats (docx vs zip
     * etc.). HTTP header values may only hold ISO-8859-1, so a raw Chinese
     * file name would be rejected by OkHttp — hence [encodeUploadName].
     */
    suspend fun uploadFile(bytes: ByteArray, contentType: String, fileName: String): String = withContext(Dispatchers.IO) {
        val mediaType = (contentType.ifBlank { "application/octet-stream" }).toMediaType()
        val req = Request.Builder()
            .url(urlFor("/api/uploads", null))
            .header("X-File-Name", encodeUploadName(fileName))
            .method("POST", bytes.toRequestBody(mediaType))
            .build()
        client.newCall(req).execute().use { resp ->
            val text = try { resp.body?.string() ?: "" } catch (e: Exception) { "" }
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (!resp.isSuccessful) {
                throw ApiException(
                    resp.code,
                    json.optString("code").ifEmpty { null },
                    json,
                    json.optString("error").ifEmpty { "HTTP ${resp.code}" },
                )
            }
            val url = json.optString("url")
            if (url.isEmpty()) throw ApiException(resp.code, null, json, "Upload response missing url")
            url
        }
    }

    /** Create (or rotate) the public share link of a note; returns the server path. */
    suspend fun createShare(noteId: String): String = withContext(Dispatchers.IO) {
        val req = Request.Builder().url(urlFor("/api/notes/$noteId/share", null)).post("{}".toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        client.newCall(req).execute().use { resp ->
            val text = try { resp.body?.string() ?: "" } catch (e: Exception) { "" }
            val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
            if (!resp.isSuccessful) throw ApiException(resp.code, json.optString("code").ifEmpty { null }, json, json.optString("error").ifEmpty { "HTTP ${resp.code}" })
            json.optString("url").ifEmpty { throw ApiException(resp.code, null, json, "Share response missing url") }
        }
    }

    /** Revoke the public share link of a note. */
    suspend fun revokeShare(noteId: String) {
        withContext(Dispatchers.IO) {
            val req = Request.Builder().url(urlFor("/api/notes/$noteId/share", null)).delete("{}".toRequestBody("application/json; charset=utf-8".toMediaType())).build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    val text = try { resp.body?.string() ?: "" } catch (e: Exception) { "" }
                    val json = try { JSONObject(text) } catch (e: Exception) { JSONObject() }
                    throw ApiException(resp.code, json.optString("code").ifEmpty { null }, json, json.optString("error").ifEmpty { "HTTP ${resp.code}" })
                }
            }
        }
    }

    /**
     * Fetch the server-rendered QR for a share token, as SVG text. Fetched
     * through [baseUrlOverride] — the same origin the share link shows — so
     * the URL encoded in the code always matches the link in the dialog
     * (when the server has no PUBLIC_BASE_URL it derives the origin from the
     * request Host header). Returns null on any failure; callers hide the QR.
     */
    suspend fun fetchQrSvg(token: String, baseUrlOverride: String?): String? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url(urlFor("/share/$token/qr.svg", baseUrlOverride)).get().build()
            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@use null
                val body = resp.body?.string() ?: return@use null
                if (body.startsWith("<svg")) body else null
            }
        } catch (e: Exception) {
            null
        }
    }

    /* --------------------------------------------------------------- admin */

    suspend fun listUsers(): AdminData {
        val j = request("GET", "/api/users")
        val a = j.optJSONArray("users") ?: JSONArray()
        val users = List(a.length()) {
            val o = a.optJSONObject(it)
            AdminUser(
                id = o.optString("id"),
                name = o.optString("name"),
                isAdmin = o.optBoolean("isAdmin"),
                createdAt = o.optLong("createdAt"),
                noteCount = o.optInt("noteCount"),
            )
        }
        return AdminData(users, j.optBoolean("registrationOpen"))
    }

    suspend fun setUserAdmin(id: String, admin: Boolean) {
        request("POST", "/api/users/$id/admin", JSONObject().put("admin", admin))
    }

    suspend fun deleteUser(id: String) {
        request("DELETE", "/api/users/$id")
    }

    suspend fun setRegistrationOpen(open: Boolean): Boolean {
        val j = request("POST", "/api/settings/registration", JSONObject().put("open", open))
        return j.optBoolean("registrationOpen")
    }

    companion object {
        /** Add scheme if missing, drop trailing slashes. Empty input → "". */
        fun normalizeBaseUrl(raw: String): String {
            var s = raw.trim()
            if (s.isEmpty()) return ""
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "http://$s"
            while (s.endsWith("/")) s = s.dropLast(1)
            return s
        }

        /** Human-friendly message for thrown exceptions. */
        fun describeError(e: Exception): String = when (e) {
            is ApiException -> e.message ?: "Server error"
            else -> "Can't reach the server — check the address and your network"
        }
    }
}

/**
 * Keeps the notes_session cookie in SharedPreferences so sign-in survives
 * restarts. The cookie is offered to every host the app talks to (the phone
 * may load uploads through the direct server address or the public domain,
 * which are different hosts for cookie matching), but only responses from
 * the configured server may store it.
 */
private class PersistedCookieJar(private val store: Store) : CookieJar {

    private fun serverHost(): String? = try {
        Api.normalizeBaseUrl(store.serverUrl).toHttpUrlOrNull()?.host
    } catch (e: Exception) {
        null
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val saved = store.sessionCookie ?: return emptyList()
        return try {
            // Re-parse against the request URL so it applies to this host too.
            val c = Cookie.parse(url, saved)
            if (c != null && c.expiresAt > System.currentTimeMillis()) listOf(c) else emptyList()
        } catch (e: Exception) {
            emptyList()
        }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val host = serverHost()
        if (host != null && url.host != host) return // ignore third-party cookies
        val session = cookies.firstOrNull { it.name == "notes_session" && it.value.isNotEmpty() }
        if (session != null) {
            store.sessionCookie = "${session.name}=${session.value}"
        }
    }
}
