package site.funshare.notes

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeRight
import androidx.activity.compose.setContent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import site.funshare.notes.ui.FunshareTheme
import site.funshare.notes.ui.GalleryEditor
import site.funshare.notes.ui.TimelineEditor

/**
 * Progress bars end to end: dragging the track commits a value (with the
 * timeline done-coupling), and the % label opens exact-number entry.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [34], qualifiers = "w411dp-h891dp-440dpi")
class ProgressInteractionTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private fun today(): String {
        val c = java.util.Calendar.getInstance()
        return "%04d-%02d-%02d".format(
            c.get(java.util.Calendar.YEAR),
            c.get(java.util.Calendar.MONTH) + 1,
            c.get(java.util.Calendar.DAY_OF_MONTH),
        )
    }

    private fun timelineVm(progress: Int?, done: Boolean = false): AppViewModel {
        val vm = AppViewModel(rule.activity.application as NotesApp)
        vm.editIsTimeline = true
        vm.editTitle = "Progress test"
        vm.editTimeline = listOf(
            TimelineItem(id = "a", date = today(), text = "写完Evaluation部分", done = done, progress = progress),
        )
        rule.runOnUiThread {
            rule.activity.setContent {
                FunshareTheme(ThemeMode.LIGHT) {
                    TimelineEditor(vm, Modifier.fillMaxSize())
                }
            }
        }
        rule.waitForIdle()
        return vm
    }

    @Test
    fun draggingTheTimelineBarCommitsAndCompletes() {
        val vm = timelineVm(progress = 40)
        // drag the track to the far right: 40 -> 100, which marks the item done
        rule.onNodeWithContentDescription("Item progress", useUnmergedTree = true)
            .performTouchInput { swipeRight() }
        rule.waitForIdle()
        val item = vm.editTimeline.first { it.id == "a" }
        assertEquals(100, item.progress)
        assertTrue(item.done)
    }

    @Test
    fun thePercentLabelOpensExactEntry() {
        val vm = timelineVm(progress = 40)
        rule.onNodeWithText("40%").performClick()
        rule.waitForIdle()
        // the label swaps for a number field; every entry commits live
        rule.onNodeWithText("40").performTextReplacement("20")
        rule.waitForIdle()
        val item = vm.editTimeline.first { it.id == "a" }
        assertEquals(20, item.progress)
    }

    @Test
    fun clearingTheFieldRemovesTheBar() {
        val vm = timelineVm(progress = 40)
        rule.onNodeWithText("40%").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("40").performTextReplacement("")
        rule.waitForIdle()
        val item = vm.editTimeline.first { it.id == "a" }
        assertNull(item.progress)
    }

    @Test
    fun draggingTheGalleryBarSetsProgress() {
        val vm = AppViewModel(rule.activity.application as NotesApp)
        vm.editIsGallery = true
        vm.editTitle = "Gallery progress test"
        vm.editGallery = listOf(
            GalleryCard(id = "c1", title = "访谈提纲", content = "半结构化访谈设计。", progress = 30),
        )
        rule.runOnUiThread {
            rule.activity.setContent {
                FunshareTheme(ThemeMode.LIGHT) {
                    GalleryEditor(vm, Modifier.fillMaxSize())
                }
            }
        }
        rule.waitForIdle()
        // the card merges descendant semantics; query the unmerged track
        rule.onNodeWithContentDescription("Item progress", useUnmergedTree = true)
            .performTouchInput { swipeRight() }
        rule.waitForIdle()
        assertEquals(100, vm.editGallery.first().progress)
    }
}
