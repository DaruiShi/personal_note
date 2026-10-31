package site.funshare.notes

import java.util.UUID

/**
 * Pure gallery-note logic — Kotlin port of the web client's
 * public/gallery.js (which itself mirrors lib/gallery.js). No Android
 * dependencies; unit tests run on the JVM. The colour palette and
 * fallbackTitle must stay compatible with the server copy so cards and
 * mirrors agree across platforms.
 */
object NotesGallery {

    /** The 12 palette keys, same order as lib/gallery.js and public/gallery.js. */
    val PALETTE = listOf(
        "amber", "rose", "violet", "indigo", "sky", "teal",
        "emerald", "lime", "orange", "fuchsia", "slate", "sand",
    )

    private val PALETTE_SET = PALETTE.toHashSet()

    fun isPaletteKey(k: String?): Boolean = k != null && PALETTE_SET.contains(k)

    /**
     * Deterministic title from content — same behaviour as the server copy:
     * first sentence, first maxWords words (first 24 characters when the
     * sentence has no spaces), an ellipsis only when something was cut,
     * never empty.
     */
    fun fallbackTitle(content: String?, maxWords: Int = 9): String {
        val s = (content ?: "").replace(Regex("\\s+"), " ").trim()
        if (s.isEmpty()) return "Untitled card"
        val sm = Regex("^[^.。!?！？]*[.。!?！？]?").find(s)
        val sentence = sm?.value ?: s
        val cutSentence = sentence.length < s.length
        fun stripTail(t: String) = t.replace(Regex("[.。!?！？…、,，;；:\\s]+$"), "").trim()
        if (' ' !in sentence) {
            // no whitespace: CJK-style, count characters (surrogate-safe:
            // code points, not UTF-16 units)
            val chars = sentence.codePoints().toArray()
            val cut = cutSentence || chars.size > 24
            val t = stripTail(chars.take(24).joinToString("") { String(Character.toChars(it)) })
            if (t.isEmpty()) return "Untitled card"
            return if (cut) "$t…" else t
        }
        val words = sentence.split(" ")
        val cut = cutSentence || words.size > maxWords
        val t = stripTail(words.take(maxWords).joinToString(" "))
        if (t.isEmpty()) return "Untitled card"
        return if (cut) "$t…" else t
    }

    /**
     * One-line preview: whitespace collapsed, cut on a word boundary when
     * one sits in the last ~40% of the budget, ellipsis only when
     * truncated, never inside a surrogate pair (characters, not UTF-16
     * units, are counted).
     */
    fun previewText(content: String?, maxChars: Int = 180): String {
        val s = (content ?: "").replace(Regex("\\s+"), " ").trim()
        if (s.isEmpty()) return ""
        val chars = s.codePoints().toArray()
        if (chars.size <= maxChars) return s
        var cut = chars.take(maxChars).joinToString("") { String(Character.toChars(it)) }
        val lastSpace = cut.lastIndexOf(' ')
        if (lastSpace > maxChars * 0.6) cut = cut.substring(0, lastSpace)
        return cut.replace(Regex("[\\s…]+$"), "") + "…"
    }

    private const val MAX_TAGS = 10
    private const val MAX_TAG_LEN = 32

    /** Array or comma/space/#-separated string -> clean tag array. */
    fun normalizeTags(input: Any?): List<String> {
        val raw: List<String> = when (input) {
            is List<*> -> input.mapNotNull { it as? String }
            is String -> input.split(Regex("[,，#\\s]+"))
            else -> emptyList()
        }
        val seen = HashSet<String>()
        val out = mutableListOf<String>()
        for (t0 in raw) {
            var t = t0.replace(Regex("^#+"), "").trim().take(MAX_TAG_LEN)
            if (t.isEmpty()) continue
            val key = t.lowercase()
            if (!seen.add(key)) continue
            out.add(t)
            if (out.size >= MAX_TAGS) break
        }
        return out
    }

    private var tmpSeq = 0

    /** New card with a temporary id (the server assigns a UUID on save). */
    fun newCard(
        title: String = "",
        content: String = "",
        tags: List<String> = emptyList(),
        color: String? = null,
        now: Long = System.currentTimeMillis(),
        id: String? = null,
    ): GalleryCard {
        tmpSeq += 1
        return GalleryCard(
            id = id ?: "g:$tmpSeq:${UUID.randomUUID()}",
            title = title.trim(),
            content = content.trim(),
            tags = normalizeTags(tags),
            color = if (isPaletteKey(color)) color!! else PALETTE[tmpSeq % PALETTE.size],
            createdAt = now,
            updatedAt = now,
        )
    }

    /** Patch one card (bumping updatedAt); returns a new list. */
    fun updateCard(items: List<GalleryCard>, id: String, patch: Map<String, Any?>, now: Long = System.currentTimeMillis()): List<GalleryCard> =
        items.map {
            if (it.id != id) it
            else it.copy(
                title = (patch["title"] as? String)?.trim() ?: it.title,
                content = (patch["content"] as? String)?.trim() ?: it.content,
                tags = (patch["tags"] as? List<String>)?.let { t -> normalizeTags(t) } ?: it.tags,
                color = (patch["color"] as? String)?.takeIf { c -> isPaletteKey(c) } ?: it.color,
                updatedAt = now,
            )
        }

    fun removeCard(items: List<GalleryCard>, id: String): List<GalleryCard> =
        items.filterNot { it.id == id }

    /** Move one card to an index (clamped); returns a new list. */
    fun reorder(items: List<GalleryCard>, fromId: String, toIndex: Int): List<GalleryCard> {
        val list = items.toMutableList()
        val from = list.indexOfFirst { it.id == fromId }
        if (from < 0) return items
        val card = list.removeAt(from)
        val to = toIndex.coerceIn(0, list.size)
        list.add(to, card)
        return list
    }

    /** Button path: move a card delta positions (clamped). */
    fun moveBy(items: List<GalleryCard>, id: String, delta: Int): List<GalleryCard> {
        val from = items.indexOfFirst { it.id == id }
        if (from < 0 || delta == 0) return items
        return reorder(items, id, from + delta)
    }

    /**
     * Merge an AI suggestion into a card: only fields that were requested
     * and are still empty are filled — a title the user typed is never
     * overwritten.
     */
    fun applySuggestion(items: List<GalleryCard>, id: String, title: String?, tags: List<String>?): List<GalleryCard> =
        items.map { c ->
            if (c.id != id) c
            else {
                val patch = HashMap<String, Any?>()
                if (!title.isNullOrEmpty() && c.title.isBlank()) patch["title"] = title
                if (!tags.isNullOrEmpty() && c.tags.isEmpty()) patch["tags"] = tags
                if (patch.isEmpty()) c
                else updateCard(listOf(c), id, patch).first()
            }
        }

    /** { total, tagCount, colors } for the gallery toolbar. */
    data class Summary(val total: Int, val tagCount: Int, val colors: Int)

    fun summary(items: List<GalleryCard>): Summary {
        val tags = HashSet<String>()
        val colors = HashSet<String>()
        for (c in items) {
            colors.add(c.color)
            tags.addAll(c.tags.map { it.lowercase() })
        }
        return Summary(items.size, tags.size, colors.size)
    }
}
