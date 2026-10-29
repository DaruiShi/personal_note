package site.funshare.notes

import android.text.Spannable
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import io.noties.markwon.ext.tasklist.TaskListSpan
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import site.funshare.notes.ui.MarkdownText
import java.io.File

/**
 * Renders the real note inside the real preview stack (Compose `MarkdownText`
 * inside a scrolling `Column`, hosted by an interop `TextView`) and taps the
 * checkboxes the way a finger does. This is the regression test for the bug
 * where the interop TextView consumed every touch (Markwon makes it clickable
 * through its LinkMovementMethod), so a Compose-level `pointerInput` never
 * received the taps and no checkbox could be checked.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class PreviewTaskTapTest {

    private val md: String by lazy {
        val res = javaClass.classLoader!!.getResource("note-content.txt")!!
        File(res.toURI()).readText()
    }

    private class Mounted(val root: ComposeView, val tv: TextView, val clicked: MutableList<Int>)

    private fun mount(): Mounted {
        val activity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()
        val clicked = mutableListOf<Int>()
        val composeView = ComposeView(activity)
        activity.setContentView(composeView)
        composeView.setContent {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                MarkdownText(
                    markdown = md,
                    onTaskClick = { clicked += it },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        composeView.measure(
            View.MeasureSpec.makeMeasureSpec(1080, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(2400, View.MeasureSpec.EXACTLY),
        )
        composeView.layout(0, 0, 1080, 2400)
        val tv = findTextView(composeView) ?: error("interop TextView not found")
        return Mounted(composeView, tv, clicked)
    }

    private fun findTextView(root: View): TextView? {
        if (root is TextView) return root
        if (root is ViewGroup) {
            for (i in 0 until root.childCount) {
                findTextView(root.getChildAt(i))?.let { return it }
            }
        }
        return null
    }

    private fun tap(view: View, x: Float, y: Float) {
        val down = MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, x, y, 0)
        val up = MotionEvent.obtain(0, 0, MotionEvent.ACTION_UP, x, y, 0)
        view.dispatchTouchEvent(down)
        view.dispatchTouchEvent(up)
        down.recycle()
        up.recycle()
    }

    private fun drag(view: View, x: Float, y: Float) {
        val down = MotionEvent.obtain(0, 0, MotionEvent.ACTION_DOWN, x, y, 0)
        val move = MotionEvent.obtain(0, 10, MotionEvent.ACTION_MOVE, x, y + 120f, 0)
        val up = MotionEvent.obtain(0, 20, MotionEvent.ACTION_UP, x, y + 120f, 0)
        view.dispatchTouchEvent(down)
        view.dispatchTouchEvent(move)
        view.dispatchTouchEvent(up)
        down.recycle()
        move.recycle()
        up.recycle()
    }

    /** Checkbox geometry of the [index]-th task in document order. */
    private fun checkboxCenter(tv: TextView, index: Int): Pair<Float, Float> {
        val sp = tv.text as Spannable
        val layout = tv.layout
        val span = sp.getSpans(0, sp.length, TaskListSpan::class.java)
            .sortedBy { sp.getSpanStart(it) }[index]
        val line = layout.getLineForOffset(sp.getSpanStart(span))
        val x = span.getLeadingMargin(true) / 2f
        val y = (layout.getLineTop(line) + layout.getLineBottom(line)) / 2f
        return x to y
    }

    @Test
    fun tappingACheckboxFlipsThatTask() {
        val m = mount()
        // A few checkboxes across the note (top, middle, bottom) must all work.
        for (index in listOf(0, 3, 15, 29)) {
            val (x, y) = checkboxCenter(m.tv, index)
            m.clicked.clear()
            tap(m.root, x, y)
            assertEquals("tap on task $index checkbox did not fire", listOf(index), m.clicked)
        }
    }

    @Test
    fun tappingTheTextBodyDoesNothing() {
        val m = mount()
        val (x, y) = checkboxCenter(m.tv, 0)
        tap(m.root, x + 200f, y) // inside the task text, well past the checkbox
        assertTrue("body tap must not toggle a task, got ${m.clicked}", m.clicked.isEmpty())
    }

    @Test
    fun draggingAcrossACheckboxDoesNotToggle() {
        val m = mount()
        val (x, y) = checkboxCenter(m.tv, 2)
        drag(m.root, x, y)
        assertTrue("scroll drag must not toggle a task, got ${m.clicked}", m.clicked.isEmpty())
    }
}