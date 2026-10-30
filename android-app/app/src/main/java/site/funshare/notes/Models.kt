package site.funshare.notes

import org.json.JSONArray
import org.json.JSONObject

/**
 * One timeline item: plain text on a local YYYY-MM-DD date, an optional
 * HH:MM-HH:MM time range, optionally done. `order` is the per-date
 * sequence (drag writes it; time derives the default). Server-generated
 * UUID ids (client-side drafts use "tmp:" ids).
 */
data class TimelineItem(
    val id: String,
    val date: String,
    val text: String,
    val done: Boolean = false,
    val start: String? = null,
    val end: String? = null,
    val order: Int? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
) {
    /** "14:00–16:00" / "14:00" / "" for the row meta line. */
    val timeLabel: String
        get() = when {
            start != null && end != null -> "$start–$end"
            start != null -> start
            else -> ""
        }

    companion object {
        fun fromJson(o: JSONObject): TimelineItem = TimelineItem(
            id = o.optString("id"),
            date = o.optString("date"),
            text = o.optString("text"),
            done = o.optBoolean("done"),
            start = o.optString("start").ifEmpty { null },
            end = o.optString("end").ifEmpty { null },
            order = if (o.isNull("order")) null else o.optInt("order", -1).takeIf { it >= 0 },
            createdAt = o.optLong("createdAt"),
            updatedAt = o.optLong("updatedAt"),
        )

        fun listFromJson(o: JSONObject?): List<TimelineItem> {
            val a = o?.optJSONArray("items") ?: return emptyList()
            return List(a.length()) { fromJson(a.optJSONObject(it) ?: return emptyList()) }
        }

        fun listToJson(items: List<TimelineItem>): JSONObject {
            val a = JSONArray()
            items.forEach {
                a.put(
                    JSONObject().put("id", it.id).put("date", it.date).put("text", it.text)
                        .put("done", it.done)
                        .put("start", it.start ?: JSONObject.NULL)
                        .put("end", it.end ?: JSONObject.NULL)
                        .put("order", it.order ?: JSONObject.NULL)
                        .put("createdAt", it.createdAt).put("updatedAt", it.updatedAt),
                )
            }
            return JSONObject().put("items", a)
        }
    }
}

data class Note(
    val id: String,
    val title: String,
    val content: String,
    val tags: List<String>,
    val pinned: Boolean,
    val createdAt: Long,
    val updatedAt: Long,
    /** Folder this note lives in (server folder id); null = unfiled. */
    val folderId: String? = null,
    /** Concurrency token: the server rejects saves carrying a stale rev. */
    val rev: Int = 0,
    /** Non-null while the note sits in the server-side trash. */
    val deletedAt: Long? = null,
    /** "timeline" for timeline notes; null = plain markdown note. */
    val kind: String? = null,
    /** Items, present only on kind == "timeline". Content is the derived mirror. */
    val timeline: List<TimelineItem>? = null,
) {
    val isLocal: Boolean get() = id.startsWith("local:")
    val isTimeline: Boolean get() = kind == "timeline"

    fun toJson(): JSONObject {
        val o = JSONObject()
            .put("id", id)
            .put("title", title)
            .put("content", content)
            .put("tags", JSONArray(tags))
            .put("pinned", pinned)
            .put("createdAt", createdAt)
            .put("updatedAt", updatedAt)
            .put("folderId", folderId ?: JSONObject.NULL)
            .put("rev", rev)
        if (kind != null) o.put("kind", kind)
        if (kind == "timeline") o.put("timeline", TimelineItem.listToJson(timeline ?: emptyList()))
        return o
    }

    companion object {
        fun fromJson(o: JSONObject): Note {
            val kind = o.optString("kind").ifEmpty { null }
            return Note(
                id = o.optString("id"),
                title = o.optString("title"),
                content = o.optString("content"),
                tags = run {
                    val a = o.optJSONArray("tags") ?: return@run emptyList()
                    List(a.length()) { a.optString(it) }.filter { it.isNotEmpty() }
                },
                pinned = o.optBoolean("pinned"),
                createdAt = o.optLong("createdAt"),
                updatedAt = o.optLong("updatedAt"),
                folderId = o.optString("folderId").ifEmpty { null },
                rev = o.optInt("rev", 0),
                deletedAt = if (o.has("deletedAt") && !o.isNull("deletedAt")) o.optLong("deletedAt") else null,
                kind = kind,
                timeline = if (kind == "timeline") TimelineItem.listFromJson(o.optJSONObject("timeline")) else null,
            )
        }
    }
}

data class Folder(
    val id: String,
    val name: String,
    val noteCount: Int,
    /** Pinned folders are listed above the unpinned ones in the app. */
    val pinned: Boolean = false,
)

data class User(val id: String, val name: String, val isAdmin: Boolean, val createdAt: Long)

data class SessionInfo(
    val needsSetup: Boolean,
    val authenticated: Boolean,
    val user: User?,
    val registrationOpen: Boolean,
    /** Server has the QR module and serves /share/<token>/qr.svg. */
    val featuresQr: Boolean = false,
    /** Server has an LLM config for timeline "Paste & parse". */
    val featuresTimelineParse: Boolean = false,
    /**
     * Canonical public origin the server wants in share links (its
     * PUBLIC_BASE_URL); null when the server did not advertise one.
     */
    val publicBaseUrl: String? = null,
) {
    companion object {
        fun fromJson(o: JSONObject): SessionInfo = SessionInfo(
            needsSetup = o.optBoolean("needsSetup"),
            authenticated = o.optBoolean("authenticated"),
            user = o.optJSONObject("user")?.let {
                User(
                    id = it.optString("id"),
                    name = it.optString("name"),
                    isAdmin = it.optBoolean("isAdmin"),
                    createdAt = it.optLong("createdAt"),
                )
            },
            registrationOpen = o.optBoolean("registrationOpen"),
            featuresQr = o.optJSONObject("features")?.optBoolean("qr") == true,
            featuresTimelineParse = o.optJSONObject("features")?.optBoolean("timelineParse") == true,
            publicBaseUrl = o.optString("publicBaseUrl").ifEmpty { null },
        )
    }
}

data class AdminUser(
    val id: String,
    val name: String,
    val isAdmin: Boolean,
    val createdAt: Long,
    val noteCount: Int,
)

data class AdminData(val users: List<AdminUser>, val registrationOpen: Boolean)
