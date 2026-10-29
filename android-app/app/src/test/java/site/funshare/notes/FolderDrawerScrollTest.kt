package site.funshare.notes

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import site.funshare.notes.ui.FolderDrawerContent

/**
 * Regression test for the drawer that could not be scrolled: with many
 * folders, the rows below the fold must be reachable and the "New folder"
 * footer must stay visible.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class FolderDrawerScrollTest {

    @get:Rule
    val rule = createComposeRule()

    private fun showFolders(folders: List<Folder>) {
        rule.setContent {
            Box(Modifier.fillMaxSize()) {
                FolderDrawerContent(
                    noteCount = 42,
                    unfiledCount = 7,
                    folders = displayOrder(folders),
                    selectedFolderId = null,
                    onSelect = {},
                    onNewFolder = {},
                    onFolderMenu = {},
                )
            }
        }
        rule.waitForIdle()
    }

    @Test
    fun manyFoldersCanBeScrolledIntoView() {
        showFolders(List(40) { i -> Folder(id = "f$i", name = "Folder $i", noteCount = i) })

        // The footer is pinned outside the scrolling area.
        rule.onNodeWithText("New folder").assertIsDisplayed()

        // The last folder starts below the fold and must scroll into view.
        rule.onNode(hasScrollAction()).performScrollToNode(hasText("Folder 39"))
        rule.onNodeWithText("Folder 39").assertIsDisplayed()
    }

    @Test
    fun pinnedFoldersAreListedFirst() {
        showFolders(
            listOf(
                Folder("a", "Alpha", 1),
                Folder("b", "Beta", 2, pinned = true),
                Folder("c", "Gamma", 3),
            ),
        )

        val beta = rule.onNodeWithText("Beta").fetchSemanticsNode().boundsInRoot.top
        val alpha = rule.onNodeWithText("Alpha").fetchSemanticsNode().boundsInRoot.top
        assertTrue("pinned folder should be listed above unpinned ones", beta < alpha)
    }
}