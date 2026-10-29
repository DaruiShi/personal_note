package site.funshare.notes

import android.content.Context
import org.json.JSONArray

/**
 * Small persistence layer on top of SharedPreferences: server config, the
 * session cookie, and local caches (notes for instant open, local-only drafts
 * waiting to sync).
 */
class Store(context: Context) {
    private val p = context.getSharedPreferences("funshare_notes", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = p.getString(K_SERVER, DEFAULT_SERVER) ?: DEFAULT_SERVER
        set(v) = p.edit().putString(K_SERVER, v).apply()

    var trustAllCerts: Boolean
        get() = p.getBoolean(K_TRUST, false)
        set(v) = p.edit().putBoolean(K_TRUST, v).apply()

    /** "system" | "light" | "dark" */
    var themeMode: String
        get() = p.getString(K_THEME, "system") ?: "system"
        set(v) = p.edit().putString(K_THEME, v).apply()

    /** Multiplier applied to text sizes in the note preview. */
    var previewFontScale: Float
        get() = p.getFloat(K_FONT_SCALE, 1f)
        set(v) = p.edit().putFloat(K_FONT_SCALE, v).apply()

    /**
     * Public base URL used when building share links (the server address the
     * phone uses may be an IP:port that outsiders can't reach).
     */
    var shareLinkBase: String
        get() {
            val v = p.getString(K_SHARE_BASE, null)?.trim().orEmpty()
            if (v.isEmpty()) return DEFAULT_SHARE_BASE
            // v1.6 shipped with the www default; treat it as the apex default too.
            return if (v.trimEnd('/').equals(LEGACY_SHARE_BASE, true)) DEFAULT_SHARE_BASE else v
        }
        set(v) = p.edit().putString(K_SHARE_BASE, v).apply()

    /** Only the "name=value" pair of the notes_session cookie. */
    var sessionCookie: String?
        get() = p.getString(K_COOKIE, null)
        set(v) { p.edit().putString(K_COOKIE, v).apply() }

    var cachedUser: User?
        get() {
            val s = p.getString(K_USER, null) ?: return null
            return try {
                val o = org.json.JSONObject(s)
                User(o.optString("id"), o.optString("name"), o.optBoolean("isAdmin"), o.optLong("createdAt"))
            } catch (e: Exception) {
                null
            }
        }
        set(v) {
            val ed = p.edit()
            if (v == null) ed.remove(K_USER)
            else ed.putString(K_USER, org.json.JSONObject()
                .put("id", v.id).put("name", v.name)
                .put("isAdmin", v.isAdmin).put("createdAt", v.createdAt).toString())
            ed.apply()
        }

    /** Last synced notes (no local drafts) for instant display on open. */
    var cachedNotes: List<Note>
        get() = notesFromJson(p.getString(K_NOTES, null)).filterNot { it.isLocal }
        set(v) = p.edit().putString(K_NOTES, notesToJson(v.filterNot { it.isLocal })).apply()

    /** Local-only drafts that have never reached the server. */
    var pendingNotes: List<Note>
        get() = notesFromJson(p.getString(K_PENDING, null)).filter { it.isLocal }
        set(v) = p.edit().putString(K_PENDING, notesToJson(v.filter { it.isLocal })).apply()

    fun clearAccountData() {
        p.edit()
            .remove(K_COOKIE).remove(K_USER).remove(K_NOTES).remove(K_PENDING)
            .apply()
    }

    companion object {
        private const val K_SERVER = "server_url"
        private const val K_TRUST = "trust_all_certs"
        private const val K_THEME = "theme_mode"
        private const val K_FONT_SCALE = "preview_font_scale"
        private const val K_SHARE_BASE = "share_link_base"

        const val DEFAULT_SHARE_BASE = "https://funshare.site"
        private const val LEGACY_SHARE_BASE = "https://www.funshare.site"
        private const val K_COOKIE = "session_cookie"
        private const val K_USER = "cached_user"
        private const val K_NOTES = "cached_notes"
        private const val K_PENDING = "pending_notes"

        const val DEFAULT_SERVER = "http://120.76.229.180:3000"

        fun notesToJson(notes: List<Note>): String {
            val a = JSONArray()
            notes.forEach { a.put(it.toJson()) }
            return a.toString()
        }

        fun notesFromJson(s: String?): List<Note> {
            if (s.isNullOrEmpty()) return emptyList()
            return try {
                val a = JSONArray(s)
                List(a.length()) { Note.fromJson(a.optJSONObject(it) ?: return emptyList()) }
            } catch (e: Exception) {
                emptyList()
            }
        }
    }
}
