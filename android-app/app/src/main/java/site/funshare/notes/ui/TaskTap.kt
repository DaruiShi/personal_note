package site.funshare.notes.ui

import android.text.Spannable
import android.text.style.LeadingMarginSpan
import android.widget.TextView
import io.noties.markwon.ext.tasklist.TaskListSpan

/**
 * Hit-testing for the tappable task checkboxes in the preview. Pure view
 * geometry — kept free of Compose so it can be unit-tested with Robolectric
 * against a really-rendered Markwon TextView, and driven from the TextView's
 * own touch listener (see MarkdownText in EditScreen.kt).
 */
object TaskTap {

    /**
     * Document index of the task whose checkbox covers view-local coordinates
     * ([x], [y]), or -1 when the point is not on a checkbox. The index counts
     * tasks in document order, matching the `- [ ]` markers in the markdown
     * source (what [flipTaskMarker] expects).
     */
    fun taskIndexAt(tv: TextView, x: Float, y: Float): Int {
        val spannable = tv.text as? Spannable ?: return -1
        val layout = tv.layout ?: return -1
        val tapX = x - tv.totalPaddingLeft + tv.scrollX
        val tapY = y - tv.totalPaddingTop + tv.scrollY
        val line = layout.getLineForVertical(Math.round(tapY))

        val lineStart = layout.getLineStart(line)
        val lineEnd = layout.getLineEnd(line)

        // Every leading-margin span on this line, in text order. Markwon's
        // TaskListSpan draws its checkbox inside the leading-margin zone;
        // ancestor spans (bullets, nesting) shift that zone to the right.
        val lineSpans = spannable.getSpans(lineStart, lineEnd, LeadingMarginSpan::class.java)
            .sortedBy { spannable.getSpanStart(it) }

        var left = 0f
        for (span in lineSpans) {
            val margin = span.getLeadingMargin(true).toFloat()
            if (span is TaskListSpan) {
                // the checkbox is drawn only on the task's first line
                val spanStart = spannable.getSpanStart(span)
                if (layout.getLineForOffset(spanStart) != line) return -1
                // generous hit zone: the span's whole margin strip, with a few
                // px of slack on each side for fingertips
                if (tapX >= left - SLACK && tapX < left + margin + SLACK) {
                    return documentOrderIndex(spannable, span)
                }
            }
            left += margin
        }
        return -1
    }

    /**
     * Position of [span] among all TaskListSpans in document order.
     *
     * Spannable.getSpans does NOT return spans in document order (it yields
     * them by descending start offset), so the raw array index is wrong —
     * it points at a different task in the markdown source. Sorting by span
     * start restores the order of `- [ ]` markers in the source.
     */
    private fun documentOrderIndex(spannable: Spannable, span: TaskListSpan): Int {
        val start = spannable.getSpanStart(span)
        return spannable.getSpans(0, spannable.length, TaskListSpan::class.java)
            .count { spannable.getSpanStart(it) < start }
    }

    private const val SLACK = 12f // px
}
