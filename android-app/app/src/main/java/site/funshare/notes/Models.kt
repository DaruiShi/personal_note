package site.funshare.notes

import org.json.JSONArray
import org.json.JSONObject

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
) {
    val isLocal: Boolean get() = id.startsWith("local:")

    fun toJson(): JSONObject = JSONObject()
        .put("id", id)
        .put("title", title)
        .put("content", content)
        .put("tags", JSONArray(tags))
        .put("pinned", pinned)
        .put("createdAt", createdAt)
        .put("updatedAt", updatedAt)
        .put("folderId", folderId ?: JSONObject.NULL)
        .put("rev", rev)

    companion object {
        fun fromJson(o: JSONObject): Note = Note(
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
        )
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
)

data class AdminUser(
    val id: String,
    val name: String,
    val isAdmin: Boolean,
    val createdAt: Long,
    val noteCount: Int,
)

data class AdminData(val users: List<AdminUser>, val registrationOpen: Boolean)
