package site.funshare.notes

import android.content.Context
import android.text.Spannable
import android.text.style.LeadingMarginSpan
import android.view.View
import android.widget.TextView
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.ext.tasklist.TaskListSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import site.funshare.notes.ui.TaskTap
import site.funshare.notes.ui.flipTaskMarker
import java.io.File

/**
 * Renders the real note "2026/10/13—21" with the app's Markwon setup on a
 * real Android TextView (Robolectric runs actual framework code) and
 * verifies checkbox tap hit-testing plus marker flipping end to end.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class TaskTapTest {

    private lateinit var context: Context
    private lateinit var md: String

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        val res = javaClass.classLoader!!.getResource("note-content.txt")!!
        md = File(res.toURI()).readText()
    }

    private fun renderNote(): TextView {
        val mw = Markwon.builder(context)
            .usePlugin(TablePlugin.create(context))
            .usePlugin(TaskListPlugin.create(context))
            .build()
        val tv = TextView(context)
        tv.textSize = 15.5f
        tv.setLineSpacing(0f, 1.15f)
        mw.setMarkdown(tv, md)
        tv.measure(
            View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
        )
        tv.layout(0, 0, tv.measuredWidth, tv.measuredHeight)
        return tv
    }

    /** Dump the real geometry so hit zones can be validated against it. */
    @Test
    fun dumpGeometry() {
        val tv = renderNote()
        val sp = tv.text as Spannable
        val layout = tv.layout
        val tasks = sp.getSpans(0, sp.length, TaskListSpan::class.java)
        assertTrue("expected 30 tasks, got ${tasks.size}", tasks.size == 30)
        for (i in tasks.indices) {
            val s = tasks[i]
            val start = sp.getSpanStart(s)
            val line = layout.getLineForOffset(start)
            val margins = sp.getSpans(
                layout.getLineStart(line), layout.getLineEnd(line),
                LeadingMarginSpan::class.java,
            ).sortedBy { sp.getSpanStart(it) }
            val marginDesc = margins.joinToString("+") {
                (if (it is TaskListSpan) "T" else "L") + it.getLeadingMargin(true)
            }
            println(
                "task $i line=$line start=$start primaryH=${fmt(layout.getPrimaryHorizontal(start))} " +
                    "lineLeft=${fmt(layout.getLineLeft(line))} margins=$marginDesc " +
                    "top=${layout.getLineTop(line)} bottom=${layout.getLineBottom(line)}",
            )
        }
        // the relationships these assertions check:
        // 1) primaryHorizontal includes the leading margin (text starts after it)
        // 2) lineLeft is the line's left edge including margin
        val s = tasks[0]
        val start = sp.getSpanStart(s)
        val line = layout.getLineForOffset(start)
        val margin = s.getLeadingMargin(true)
        val primary = layout.getPrimaryHorizontal(start)
        val lineLeft = layout.getLineLeft(line)
        println("margin=$margin primary=$primary lineLeft=$lineLeft")
        assertTrue(
            "getPrimaryHorizontal should start at/after the leading margin " +
                "(primary=$primary margin=$margin lineLeft=$lineLeft)",
            primary >= margin - 0.5f,
        )
    }

    private fun fmt(f: Float) = "%.1f".format(f)

    /** Tap the center of every rendered checkbox → must return that task's index. */
    @Test
    fun tapEveryCheckbox() {
        val tv = renderNote()
        val sp = tv.text as Spannable
        val layout = tv.layout
        val tasks = documentOrderedTasks(tv)
        assertEquals(30, tasks.size)
        for (i in tasks.indices) {
            val s = tasks[i]
            val start = sp.getSpanStart(s)
            val line = layout.getLineForOffset(start)
            val margin = s.getLeadingMargin(true).toFloat()
            // checkbox is drawn centered inside the span's leading-margin zone
            val checkboxX = margin / 2f
            val y = (layout.getLineTop(line) + layout.getLineBottom(line)) / 2f
            val hit = TaskTap.taskIndexAt(tv, checkboxX, y)
            assertEquals("tap on checkbox of task $i (x=$checkboxX y=$y) failed", i, hit)
        }
    }

    private fun documentOrderedTasks(tv: TextView): Array<TaskListSpan> {
        val sp = tv.text as Spannable
        return sp.getSpans(0, sp.length, TaskListSpan::class.java)
            .sortedBy { sp.getSpanStart(it) }
            .toTypedArray()
    }

    /**
     * The linchpin: the document-ordered task spans must correspond 1:1, in
     * order, to the `- [ ]` markers in the markdown source — the text under
     * span i must be the text of markdown task i. (Spannable.getSpans returns
     * reverse document order; a raw indexOf would flip a marker in a
     * different part of the note.)
     */
    @Test
    fun spanOrderMatchesMarkdownOrder() {
        val tv = renderNote()
        val sp = tv.text as Spannable
        val tasks = documentOrderedTasks(tv)
        // markdown emphasis/code markers disappear when rendered — strip them
        // so the character streams are comparable
        val mdTaskTexts = Regex("""[-*+]\s+\[[ xX]]\s*(.*)""")
            .findAll(md)
            .map { m -> m.groupValues[1].trim().replace("*", "").replace("`", "") }
            .toList()
        assertEquals(30, mdTaskTexts.size)
        for (i in tasks.indices) {
            val span = tasks[i]
            val spanText = sp.subSequence(sp.getSpanStart(span), sp.getSpanEnd(span))
                .toString().trim().replace("*", "").replace("`", "")
            assertEquals(
                "rendered task $i does not match markdown task $i — " +
                    "span order is not document order",
                mdTaskTexts[i], spanText,
            )
        }
    }

    /** Taps on the text body must not hit any checkbox. */
    @Test
    fun tapTextBodyDoesNothing() {
        val tv = renderNote()
        val sp = tv.text as Spannable
        val layout = tv.layout
        val tasks = sp.getSpans(0, sp.length, TaskListSpan::class.java)
        val s = tasks[0]
        val start = sp.getSpanStart(s)
        val line = layout.getLineForOffset(start)
        val margin = s.getLeadingMargin(true).toFloat()
        val y = (layout.getLineTop(line) + layout.getLineBottom(line)) / 2f
        val bodyX = margin + 40f // clearly inside the text
        assertEquals(-1, TaskTap.taskIndexAt(tv, bodyX, y))
    }

    /** Every tap index must flip exactly that marker in the markdown source. */
    @Test
    fun flipMatchesIndices() {
        val markers = Regex("""\[( |x|X)]""").findAll(md).map { it.value }.toList()
        assertEquals(30, markers.size)
        for (i in markers.indices) {
            val flipped = flipTaskMarker(md, i)!!
            val after = Regex("""\[( |x|X)]""").findAll(flipped).map { it.value }.toList()
            assertEquals(30, after.size)
            for (j in markers.indices) {
                if (j == i) {
                    assertTrue(
                        "marker $i should have flipped (${markers[i]} → ${after[j]})",
                        markers[j] != after[j],
                    )
                } else {
                    assertEquals("marker $j must not change", markers[j], after[j])
                }
            }
        }
    }
}
