package site.funshare.notes

import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * Wikilinks, the note-to-note link index, and daily-note date helpers.
 * Pure Kotlin port of the web client's public/links.js — no Android
 * dependencies, so unit tests run on the plain JVM.
 *
 * Wikilink syntax: [[Note title]] and [[Note title|label]]. Links inside
 * fenced code blocks (```…```) or inline code spans (`…`) are literal text.
 * Daily notes are plain notes whose title is exactly YYYY-MM-DD.
 */
object NotesLinks {

    private val WIKILINK_RE = Regex("""\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]""")
    // Mirrors the web renderer's fence tokens: ```lang opens, ``` closes.
    private val FENCE_RE = Regex("""^```[\w+#-]*\s*$""")
    private val DATE_RE = Regex("""^\d{4}-\d{2}-\d{2}$""")

    /** One wikilink occurrence: target (the title) and its display label. */
    data class Wikilink(val target: String, val label: String)

    /** A backlink row: the linking note and a snippet around its link. */
    data class Backlink(val id: String, val title: String, val snippet: String)

    data class LinkIndex(
        val byTitle: Map<String, String> = emptyMap(),
        /** Rename aliases (server-managed previous titles); a real title
         *  always beats an alias, and collisions pick the newest note. */
        val byAlias: Map<String, String> = emptyMap(),
        val outbound: Map<String, List<String>> = emptyMap(),
        val inbound: Map<String, Set<String>> = emptyMap(),
    )

    /** Full citation info: the target's CURRENT title and kind, so a reader
     *  never sees the stale pre-rename name. kind: markdown|timeline|gallery. */
    data class Citation(val id: String, val title: String, val kind: String)

    /** A picker row for the citation dialog. */
    data class Candidate(
        val id: String,
        val title: String,
        val kind: String,
        val updatedAt: Long,
        val matchedBy: String, // "title" | "alias"
    )

    /** The insertable citation for a note — or a blocked reason when the
     *  title contains '[', ']' or '|' (the citation syntax itself). */
    data class CitationText(val text: String, val blocked: Boolean = false, val reason: String? = null)

    /* ------------------------------------------------------- title matching */

    /** Trim, lowercase, collapse internal whitespace — the matching key. */
    fun titleKey(title: String?): String =
        (title ?: "").trim().lowercase(Locale.ROOT).replace(Regex("\\s+"), " ")

    /* -------------------------------------------------------- wikilink scan */

    /**
     * Deduplicated wikilinks in first-occurrence order; targets differing
     * only by case/whitespace are the same link. Fenced code blocks and
     * inline code spans are skipped, mirroring the renderer.
     */
    fun parseWikilinks(text: String?): List<Wikilink> {
        val src = (text ?: "").replace("\r\n", "\n").replace("\r", "\n")
        val seen = mutableSetOf<String>()
        val out = mutableListOf<Wikilink>()
        var inFence = false
        for (line in src.split("\n")) {
            if (FENCE_RE.matches(line)) { inFence = !inFence; continue }
            if (inFence) continue
            // links inside inline code are literal: blank the spans
            val noCode = line.replace(Regex("`[^`\n]*`"), "``")
            for (m in WIKILINK_RE.findAll(noCode)) {
                val target = m.groupValues[1].trim()
                if (target.isEmpty()) continue
                val key = titleKey(target)
                if (!seen.add(key)) continue
                val label = m.groupValues[2].trim().ifEmpty { target }
                out.add(Wikilink(target, label))
            }
        }
        return out
    }

    /* -------------------------------------------------------- link index */

    /**
     * byTitle resolves duplicate titles to the newest updatedAt; notes with
     * blank titles are excluded from byTitle but keep outbound links.
     * Self-links never create inbound entries.
     */
    fun buildLinkIndex(notes: List<Note>): LinkIndex {
        val byTitle = mutableMapOf<String, String>()
        // ascending order → the newest note is assigned last and wins
        notes.filter { titleKey(it.title).isNotEmpty() }
            .sortedBy { it.updatedAt }
            .forEach { byTitle[titleKey(it.title)] = it.id }
        // aliases: real titles win; a note never aliases its own title
        val byAlias = mutableMapOf<String, String>()
        notes.filter { !it.aliases.isNullOrEmpty() }
            .sortedBy { it.updatedAt }
            .forEach { n ->
                for (a in n.aliases!!) {
                    val key = titleKey(a)
                    if (key.isEmpty() || key == titleKey(n.title)) continue
                    if (byTitle.containsKey(key)) continue
                    byAlias[key] = n.id
                }
            }
        val outbound = mutableMapOf<String, List<String>>()
        val inbound = mutableMapOf<String, MutableSet<String>>()
        for (n in notes) {
            val targets = parseWikilinks(n.content).map { it.target }
            outbound[n.id] = targets
            for (t in targets) {
                val tid = resolveKey(byTitle, byAlias, titleKey(t)) ?: continue
                if (tid == n.id) continue
                inbound.getOrPut(tid) { mutableSetOf() }.add(n.id)
            }
        }
        return LinkIndex(byTitle, byAlias, outbound, inbound as Map<String, Set<String>>)
    }

    private fun resolveKey(
        byTitle: Map<String, String>,
        byAlias: Map<String, String>,
        key: String,
    ): String? = byTitle[key] ?: byAlias[key]

    /**
     * Incremental index update for one saved note (used on autosave so a
     * full rebuild doesn't re-scan every note's content on each save).
     */
    fun updateNote(index: LinkIndex, note: Note): LinkIndex {
        val byTitle = index.byTitle.toMutableMap()
        byTitle.entries.removeAll { it.value == note.id }
        val key = titleKey(note.title)
        if (key.isNotEmpty()) byTitle[key] = note.id // just-saved = newest holder
        val byAlias = index.byAlias.toMutableMap()
        byAlias.entries.removeAll { it.value == note.id }
        for (a in note.aliases.orEmpty()) {
            val ak = titleKey(a)
            if (ak.isEmpty() || ak == key || byTitle.containsKey(ak)) continue
            byAlias[ak] = note.id
        }
        val inbound = index.inbound.mapValues { it.value.toMutableSet() }.toMutableMap()
        inbound.values.forEach { it.remove(note.id) }
        val outbound = index.outbound.toMutableMap()
        val targets = parseWikilinks(note.content).map { it.target }
        outbound[note.id] = targets
        for (t in targets) {
            val tid = resolveKey(byTitle, byAlias, titleKey(t)) ?: continue
            if (tid == note.id) continue
            inbound.getOrPut(tid) { mutableSetOf() }.add(note.id)
        }
        return LinkIndex(byTitle, byAlias, outbound, inbound as Map<String, Set<String>>)
    }

    fun resolveTitle(index: LinkIndex, target: String): String? =
        resolveKey(index.byTitle, index.byAlias, titleKey(target))

    /** Citation info with the target's CURRENT title and kind, or null. */
    fun resolveCitation(index: LinkIndex, notes: List<Note>, target: String): Citation? {
        val id = resolveTitle(index, target) ?: return null
        val note = notes.firstOrNull { it.id == id } ?: return null
        return Citation(id, note.title, note.kind ?: "markdown")
    }

    /**
     * Picker candidates: exact title, title starts-with, title contains,
     * then alias contains; ties by updatedAt descending. Empty query =
     * most recently updated.
     */
    fun citeCandidates(index: LinkIndex, notes: List<Note>, query: String, limit: Int = 8): List<Candidate> {
        val q = titleKey(query)
        data class Scored(val note: Note, val score: Int, val matchedBy: String)
        val scored = mutableListOf<Scored>()
        for (x in notes.filter { titleKey(it.title).isNotEmpty() }) {
            val t = titleKey(x.title)
            var score: Int? = null
            var matchedBy = "title"
            when {
                q.isEmpty() -> score = 4
                t == q -> score = 3
                t.startsWith(q) -> score = 2
                t.contains(q) -> score = 1
                x.aliases.orEmpty().any { titleKey(it).contains(q) } -> { score = 0; matchedBy = "alias" }
            }
            if (score != null) scored.add(Scored(x, score, matchedBy))
        }
        scored.sortWith(compareByDescending<Scored> { it.score }.thenByDescending { it.note.updatedAt })
        return scored.take(limit).map {
            Candidate(it.note.id, it.note.title, it.note.kind ?: "markdown", it.note.updatedAt, it.matchedBy)
        }
    }

    /** The insertable '[[Title]]' — blocked (with reason) when the title is
     *  empty or contains the citation syntax characters. Never mangles. */
    fun citationFor(note: Note?): CitationText {
        val title = note?.title?.trim().orEmpty()
        if (title.isEmpty()) return CitationText("", blocked = true, reason = "This note has no title yet")
        if (title.any { it == '[' || it == ']' || it == '|' }) {
            return CitationText("", blocked = true, reason = "Title contains [ ] or |")
        }
        return CitationText("[[$title]]")
    }

    /** Notes linking to [noteId], newest first, capped at 50. */
    fun inboundFor(index: LinkIndex, noteId: String, notes: List<Note>): List<Backlink> {
        val ids = index.inbound[noteId] ?: return emptyList()
        val byId = notes.associateBy { it.id }
        data class Row(val note: Note, val snippet: String)
        val rows = mutableListOf<Row>()
        for (id in ids) {
            if (id == noteId) continue
            val n = byId[id] ?: continue
            var target: String? = null
            for (t in index.outbound[id] ?: emptyList()) {
                val tid = index.byTitle[titleKey(t)]
                val aid = index.byAlias[titleKey(t)]
                if (tid == noteId || aid == noteId) { target = t; break }
            }
            rows.add(Row(n, extractSnippet(n.content, target, 90)))
        }
        return rows.sortedByDescending { it.note.updatedAt }
            .take(50)
            .map { Backlink(it.note.id, it.note.title, it.snippet) }
    }

    /* ----------------------------------------------------------- snippets */

    /** Markdown → one line of plain text. */
    private fun stripMarkdown(s: String): String = s
        .replace(Regex("`([^`]*)`"), "$1")
        .replace(Regex("!\\[([^\\]]*)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[([^\\]]+)\\]\\([^)]*\\)"), "$1")
        .replace(Regex("\\[\\[([^\\[\\]|]+)(?:\\|([^\\[\\]]+))?\\]\\]")) { m ->
            (m.groupValues[2].ifEmpty { m.groupValues[1] }).trim()
        }
        .replace(Regex("(?m)^\\s{0,3}#{1,6}\\s+"), "")
        .replace(Regex("(?m)^\\s{0,3}>\\s?"), "")
        .replace(Regex("(?m)^\\s{0,3}([-*+]|\\d+[.)])\\s+"), "")
        .replace(Regex("(\\*\\*|__)(.*?)\\1"), "$2")
        .replace(Regex("(\\*|_)([^*_]+)\\1"), "$2")
        .replace(Regex("~~([^~]+)~~"), "$1")
        .replace("|", " ")
        .replace(Regex("\\s+"), " ")
        .trim()

    /**
     * One line of plain text around the first [[...]] matching targetTitle,
     * with "..." markers when clipped. Always ≤ [maxChars].
     */
    fun extractSnippet(content: String?, targetTitle: String?, maxChars: Int = 90): String {
        val max = maxOf(20, maxChars)
        val key = titleKey(targetTitle)
        if (key.isEmpty()) return ""
        val src = (content ?: "").replace("\r\n", "\n").replace("\r", "\n")
        var label: String? = null
        var line: String? = null
        var inFence = false
        outer@ for (l in src.split("\n")) {
            if (FENCE_RE.matches(l)) { inFence = !inFence; continue }
            if (inFence) continue
            val noCode = l.replace(Regex("`[^`\n]*`"), "``")
            for (m in WIKILINK_RE.findAll(noCode)) {
                val t = m.groupValues[1].trim()
                if (t.isNotEmpty() && titleKey(t) == key) {
                    label = m.groupValues[2].trim().ifEmpty { t }
                    line = l
                    break@outer
                }
            }
        }
        val lbl = label ?: return ""
        val plain = stripMarkdown(line ?: return "")
        if (plain.isEmpty()) return ""
        if (plain.length <= max) return plain
        val idx = maxOf(0, plain.indexOf(lbl))
        var start = maxOf(0, idx - max / 3)
        if (start + max < plain.length) start = maxOf(0, minOf(start, plain.length - max))
        var win = plain.substring(start, minOf(plain.length, start + max)).trim()
        val head = if (start > 0) "..." else ""
        val tail = if (start + max < plain.length) "..." else ""
        return (head + win + tail).take(max)
    }

    /* -------------------------------------------- markdown link conversion */

    /** URL schemes marking wikilinks inside preprocessed markdown. */
    const val WIKILINK_SCHEME = "wikilink:"
    const val WIKILINK_MISSING_SCHEME = "wikilinkx:"

    /**
     * Rewrites [[Target|Label]] outside code into markdown links whose URL
     * carries the target percent-encoded: `wikilink:<t>` when [resolve]
     * returns a note id, `wikilinkx:<t>` when it does not (missing). The
     * preview's link resolver routes both schemes back to the app. Inline
     * code is masked with same-length spaces so match indices line up with
     * the original line; fenced blocks are skipped whole.
     */
    /**
     * @param resolve returns the note id for a citable target, or null.
     * @param resolveDisplay returns the CURRENT title to display for an
     * UNLABELLED citation (rename healing); null keeps the typed target.
     */
    fun toMarkdownLinks(
        content: String?,
        resolve: (String) -> String?,
        resolveDisplay: ((String) -> String?)? = null,
    ): String {
        val src = (content ?: "").replace("\r\n", "\n").replace("\r", "\n")
        val out = StringBuilder()
        var inFence = false
        val lines = src.split("\n")
        for ((idx, line) in lines.withIndex()) {
            if (idx > 0) out.append('\n')
            if (FENCE_RE.matches(line)) { inFence = !inFence; out.append(line); continue }
            if (inFence) { out.append(line); continue }
            val masked = line.replace(Regex("`[^`\n]*`")) { " ".repeat(it.value.length) }
            var i = 0
            while (i < line.length) {
                val m = WIKILINK_RE.find(masked, i)
                if (m == null) { out.append(line, i, line.length); break }
                out.append(line, i, m.range.first) // original text before the link
                val target = m.groupValues[1].trim()
                val explicit = m.groupValues[2].trim().isNotEmpty()
                val label = m.groupValues[2].trim().ifEmpty { target }
                if (target.isEmpty()) {
                    out.append(line, m.range.first, m.range.last + 1)
                } else {
                    val scheme = if (resolve(target) != null) WIKILINK_SCHEME else WIKILINK_MISSING_SCHEME
                    // unlabelled citations display the target's current title
                    val shown = if (!explicit) resolveDisplay?.invoke(target) ?: label else label
                    val enc = URLEncoder.encode(target, "UTF-8")
                    out.append("[").append(escapeMdLabel(shown)).append("](").append(scheme).append(enc).append(")")
                }
                i = m.range.last + 1
            }
        }
        return out.toString()
    }

    /** [ ] ( ) in a link label would break the markdown link syntax. */
    private fun escapeMdLabel(label: String): String = label
        .replace("\\", "\\\\")
        .replace("[", "\\[")
        .replace("]", "\\]")

    /** One segment of citeified plain text: either literal text or a
     *  citation carrying the note id it resolves to (null when missing or
     *  unresolvable). */
    data class CitePart(val text: String, val citationId: String?, val target: String)

    /**
     * Split plain text (timeline items, gallery cards) into literal text
     * and citation segments — the Compose counterpart of the web's
     * citeify(). Fenced/inline code is skipped, mirroring the renderer.
     * Unlabelled citations carry the target's CURRENT title as text when
     * resolvable, so renames heal here too.
     */
    fun citeifiedParts(
        text: String?,
        resolve: (String) -> String?,
        resolveDisplay: ((String) -> String?)? = null,
    ): List<CitePart> {
        val src = (text ?: "").replace("\r\n", "\n").replace("\r", "\n")
        val out = mutableListOf<CitePart>()
        val plain = StringBuilder()
        var inFence = false
        for (line in src.split("\n")) {
            if (FENCE_RE.matches(line)) { inFence = !inFence; plain.append(line).append(' '); continue }
            if (inFence) { plain.append(line).append(' '); continue }
            val masked = line.replace(Regex("`[^`\n]*`")) { " ".repeat(it.value.length) }
            var i = 0
            var consumed = 0
            while (i < line.length) {
                val m = WIKILINK_RE.find(masked, i) ?: break
                val target = m.groupValues[1].trim()
                if (target.isEmpty()) { i = m.range.last + 1; continue }
                if (m.range.first > consumed) plain.append(line, consumed, m.range.first)
                if (plain.isNotEmpty()) { out.add(CitePart(plain.toString(), null, "")); plain.clear() }
                val explicit = m.groupValues[2].trim().isNotEmpty()
                val label = m.groupValues[2].trim().ifEmpty { target }
                val id = resolve(target)
                val shown = if (!explicit && id != null) resolveDisplay?.invoke(target) ?: label else label
                out.add(CitePart(shown, id, target))
                consumed = m.range.last + 1
                i = m.range.last + 1
            }
            if (consumed < line.length) plain.append(line, consumed, line.length)
            plain.append(' ')
        }
        var pending = plain.toString()
        if (pending.isNotEmpty() && pending.endsWith(" ")) pending = pending.dropLast(1)
        if (pending.isNotEmpty()) out.add(CitePart(pending, null, ""))
        return out
    }
    /** True when [link] is a wikilink URL produced by [toMarkdownLinks]. */
    fun isWikilinkUrl(link: String): Boolean =
        link.startsWith(WIKILINK_SCHEME) || link.startsWith(WIKILINK_MISSING_SCHEME)

    /** Decoded target of a wikilink URL (null when not a wikilink URL). */
    fun wikilinkTarget(link: String): String? = when {
        link.startsWith(WIKILINK_SCHEME) ->
            URLDecoder.decode(link.removePrefix(WIKILINK_SCHEME), "UTF-8")
        link.startsWith(WIKILINK_MISSING_SCHEME) ->
            URLDecoder.decode(link.removePrefix(WIKILINK_MISSING_SCHEME), "UTF-8")
        else -> null
    }

    /* ------------------------------------------------------- daily dates */

    /** YYYY-MM-DD from LOCAL date components (never UTC-shifted). */
    fun localDateKey(date: Date): String {
        val c = Calendar.getInstance()
        c.time = date
        return "%04d-%02d-%02d".format(
            c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
        )
    }

    /**
     * A Date at local midnight for exactly-YYYY-MM-DD keys that are real
     * calendar dates (2026-02-30 → null; years outside 1970-2999 → null).
     */
    fun parseDateKey(key: String?): Date? {
        if (key == null || !DATE_RE.matches(key)) return null
        val parts = key.split("-").map { it.toInt() }
        val (y, m, d) = Triple(parts[0], parts[1], parts[2])
        if (y < 1970 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null
        val c = Calendar.getInstance()
        c.clear()
        c.set(y, m - 1, d)
        if (c.get(Calendar.YEAR) != y || c.get(Calendar.MONTH) != m - 1 || c.get(Calendar.DAY_OF_MONTH) != d) return null
        return c.time
    }

    /** Calendar math via calendar add, so month/year/DST edges are the platform's. */
    fun addDays(key: String?, delta: Int): String? {
        val d = parseDateKey(key) ?: return null
        val c = Calendar.getInstance()
        c.time = d
        c.add(Calendar.DAY_OF_MONTH, delta)
        return localDateKey(c.time)
    }

    fun isDateTitle(title: String?): Boolean = parseDateKey(title?.trim()) != null

    fun formatDayLabel(key: String?): String {
        val d = parseDateKey(key) ?: return key.orEmpty()
        val c = Calendar.getInstance()
        c.time = d
        return "%s, %d %s %d".format(
            c.getDisplayName(Calendar.DAY_OF_WEEK, Calendar.SHORT, Locale.getDefault()),
            c.get(Calendar.DAY_OF_MONTH),
            c.getDisplayName(Calendar.MONTH, Calendar.SHORT, Locale.getDefault()),
            c.get(Calendar.YEAR),
        )
    }
}
