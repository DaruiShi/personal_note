package site.funshare.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Rules behind the drawer's folder ordering: pinned folders are displayed
 * first, [AppViewModel.moveFolder] only swaps neighbours of the same pin
 * group, and the stored order stays a complete, stable list.
 */
class FolderOrderTest {

    private fun f(id: String, pinned: Boolean = false) = Folder(id, id, 0, pinned)

    @Test
    fun pinnedFoldersComeFirstInStoredOrder() {
        val stored = listOf(f("a"), f("b", true), f("c"), f("d", true))
        assertEquals(
            listOf("b", "d", "a", "c"),
            displayOrder(stored).map { it.id },
        )
    }

    @Test
    fun pinnedFolderCannotMoveIntoTheUnpinnedSection() {
        val shown = displayOrder(listOf(f("a"), f("b", true), f("c", true)))
        // shown = [b, c, a]
        assertEquals(1, folderNeighbourIndex(shown, 0, 1)) // b -> c (same group)
        assertEquals(-1, folderNeighbourIndex(shown, 1, 1)) // c -> a is another group
    }

    @Test
    fun unpinnedFolderCannotMoveAboveThePinnedSection() {
        val shown = displayOrder(listOf(f("a", true), f("b"), f("c")))
        // shown = [a, b, c]
        assertEquals(-1, folderNeighbourIndex(shown, 1, -1)) // b -> a is another group
        assertEquals(2, folderNeighbourIndex(shown, 1, 1)) // b -> c
    }

    @Test
    fun movingUpSwapsTheStoredOrder() {
        val stored = listOf(f("a", true), f("b", true), f("c"))
        val shown = displayOrder(stored)
        val moving = shown[1] // b
        val neighbour = shown[folderNeighbourIndex(shown, 1, -1)] // a
        val reordered = swapFolderOrder(stored, moving.id, neighbour.id)
        assertEquals(listOf("b", "a", "c"), reordered.map { it.id })
        assertEquals(listOf("b", "a", "c"), displayOrder(reordered).map { it.id })
    }

    @Test
    fun movingUnpinnedFolderUpStaysBelowPinnedOnes() {
        val stored = listOf(f("a", true), f("b"), f("c"), f("d"))
        val shown = displayOrder(stored) // [a, b, c, d]
        val index = shown.indexOfFirst { it.id == "c" }
        val neighbourIndex = folderNeighbourIndex(shown, index, -1)
        assertEquals(1, neighbourIndex) // b, not the pinned a
        val reordered = swapFolderOrder(stored, "c", shown[neighbourIndex].id)
        assertEquals(listOf("a", "c", "b", "d"), reordered.map { it.id })
        assertEquals(listOf("a", "c", "b", "d"), displayOrder(reordered).map { it.id })
    }

    @Test
    fun edgesHaveNoNeighbour() {
        val shown = displayOrder(listOf(f("a"), f("b")))
        assertEquals(-1, folderNeighbourIndex(shown, 0, -1))
        assertEquals(-1, folderNeighbourIndex(shown, shown.lastIndex, 1))
        assertEquals(-1, folderNeighbourIndex(shown, -1, 1))
        assertEquals(-1, folderNeighbourIndex(shown, 0, 0))
    }

    @Test
    fun swapKeepsEveryFolderExactlyOnce() {
        val stored = listOf(f("a"), f("b", true), f("c"))
        val after = swapFolderOrder(stored, "a", "c")
        assertEquals(stored.size, after.size)
        assertEquals(stored.map { it.id }.toSet(), after.map { it.id }.toSet())
        assertEquals(listOf("c", "b", "a"), after.map { it.id })
        assertTrue(stored[0].id == "a") // input list untouched
    }

    @Test
    fun unknownIdsAreIgnored() {
        val stored = listOf(f("a"), f("b"))
        assertEquals(stored, swapFolderOrder(stored, "a", "nope"))
        assertNull(displayOrder(stored).firstOrNull { it.id == "nope" })
    }
}