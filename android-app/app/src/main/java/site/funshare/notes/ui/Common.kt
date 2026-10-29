package site.funshare.notes.ui

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** "14:32" today, "Yesterday", "Mar 8" this year, "2025-12-30" otherwise. */
fun formatNoteTime(ts: Long): String {
    if (ts <= 0) return ""
    val now = System.currentTimeMillis()
    val day = SimpleDateFormat("D yyyy", Locale.getDefault())
    val note = Date(ts)
    return when {
        day.format(Date(now)) == day.format(note) ->
            SimpleDateFormat("HH:mm", Locale.getDefault()).format(note)
        day.format(Date(now - 86400000L)) == day.format(note) -> "Yesterday"
        SimpleDateFormat("y", Locale.getDefault()).format(Date(now)) ==
            SimpleDateFormat("y", Locale.getDefault()).format(note) ->
            SimpleDateFormat("MMM d", Locale.getDefault()).format(note)
        else -> SimpleDateFormat("yyyy-MM-dd", Locale.getDefault()).format(note)
    }
}

fun formatSaveTime(ts: Long): String =
    SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(ts))

/** One-line preview of the markdown content. */
private val IMAGE_MD = Regex("""!\[[^\]]*\]\([^)]*\)""")

fun noteSnippet(content: String, max: Int = 140): String {
    val s = IMAGE_MD.replace(content, "🖼")
        .replace("#", " ")
        .replace("`", "")
        .replace("*", "")
        .replace(">", "")
        .replace("- [ ] ", "☐ ")
        .replace("- [x] ", "☑ ")
        .replace("- [X] ", "☑ ")
        .replace("  ", " ")
        .trim()
    val oneLine = s.lines().firstOrNull { it.isNotBlank() } ?: ""
    val text = s.replace("\n", " ").replace(Regex("\\s+"), " ").trim()
    return if (text.length <= max) text else text.take(max).trimEnd() + "…"
}

/**
 * Matches a markdown task-list line the same way Markwon's TaskListPlugin
 * does (bullet or ordered marker, `[x]`/`[X]`/`[ ]`, at least one space
 * after the closing bracket). Group 1 captures the checkbox character.
 */
private val TASK_LINE = Regex("""^\s*(?:>\s*)*(?:[-*+]|\d{1,9}[.)])\s+\[([xX ])]\s+""")

/**
 * Flip the checkbox of the [index]-th task (document order, same order the
 * preview renders TaskListSpans in). Returns the updated markdown, or null
 * when there is no such task. Skips fenced code blocks.
 */
fun flipTaskMarker(markdown: String, index: Int): String? {
    val lines = markdown.lines().toMutableList()
    var inFence = false
    var count = 0
    for (i in lines.indices) {
        val line = lines[i]
        val trimmed = line.trimStart()
        if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
            inFence = !inFence
            continue
        }
        if (inFence) continue
        val m = TASK_LINE.find(line) ?: continue
        if (count == index) {
            val checked = m.groupValues[1].equals("x", true)
            val g = m.groups[1]!!.range
            lines[i] = line.substring(0, g.first) +
                (if (checked) " " else "x") +
                line.substring(g.last + 1)
            return lines.joinToString("\n")
        }
        count++
    }
    return null
}
