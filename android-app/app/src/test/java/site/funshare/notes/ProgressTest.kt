package site.funshare.notes

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import site.funshare.notes.ui.parseProgressInput

/**
 * Item/card progress: the done/progress coupling, clamping rules and JSON
 * round-trips — the Android port of the web client's setProgress /
 * toggleDone / readProgressInput contracts (Robolectric provides a real
 * org.json on the JVM).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ProgressTest {

    private fun item(id: String, progress: Int? = null, done: Boolean = false) =
        TimelineItem(id = id, date = "2026-10-30", text = "t", done = done, progress = progress)

    /* ------------------------------------------------------ clamping */

    @Test
    fun clampProgressKeepsWholePercentOrNull() {
        for (v in listOf(0, 1, 50, 99, 100)) assertEquals(v, NotesTimeline.clampProgress(v))
        for (v in listOf(-1, 101, Int.MIN_VALUE, Int.MAX_VALUE)) assertNull(NotesTimeline.clampProgress(v))
        assertNull(NotesTimeline.clampProgress(null))
        assertEquals(40, NotesGallery.clampProgress(40))
        assertNull(NotesGallery.clampProgress(101))
    }

    @Test
    fun parseProgressInputMatchesTheWebContract() {
        assertNull(parseProgressInput(""))
        assertNull(parseProgressInput("   "))
        assertNull(parseProgressInput("abc"))
        assertEquals(50, parseProgressInput("50"))
        assertEquals(42, parseProgressInput(" 42 "))
        assertEquals(100, parseProgressInput("150")) // clamped
        assertEquals(0, parseProgressInput("-5")) // clamped
        assertEquals(2, parseProgressInput("1.5")) // rounded
    }

    /* ------------------------------------------- timeline done coupling */

    @Test
    fun checkingDoneFillsATrackedBar() {
        val done = NotesTimeline.toggleDone(listOf(item("a", progress = 40)), "a", now = 9)
        assertTrue(done[0].done)
        assertEquals(100, done[0].progress)
    }

    @Test
    fun uncheckingDropsAFullBar() {
        val opened = NotesTimeline.toggleDone(listOf(item("a", progress = 100, done = true)), "a", now = 9)
        assertFalse(opened[0].done)
        assertNull(opened[0].progress)
    }

    @Test
    fun uncheckingAPartialBarKeepsIt() {
        val opened = NotesTimeline.toggleDone(listOf(item("a", progress = 40, done = true)), "a", now = 9)
        assertFalse(opened[0].done)
        assertEquals(40, opened[0].progress)
    }

    @Test
    fun untrackedItemsJustFlip() {
        val checked = NotesTimeline.toggleDone(listOf(item("a")), "a", now = 9)
        assertTrue(checked[0].done)
        assertNull(checked[0].progress)
    }

    /* ------------------------------------------- timeline setProgress */

    @Test
    fun fullProgressMarksTheItemDone() {
        val out = NotesTimeline.setProgress(listOf(item("a", progress = 40)), "a", 100, now = 9)
        assertEquals(100, out[0].progress)
        assertTrue(out[0].done)
    }

    @Test
    fun partialProgressReopensTheItem() {
        val out = NotesTimeline.setProgress(listOf(item("a", progress = 100, done = true)), "a", 50, now = 9)
        assertEquals(50, out[0].progress)
        assertFalse(out[0].done)
    }

    @Test
    fun clearingLeavesDoneAlone() {
        val out = NotesTimeline.setProgress(listOf(item("a", progress = 100, done = true)), "a", null, now = 9)
        assertNull(out[0].progress)
        assertTrue(out[0].done)
    }

    @Test
    fun makeItemTakesProgress() {
        assertEquals(30, NotesTimeline.makeItem("2026-10-30", "t", progress = 30).progress)
        assertNull(NotesTimeline.makeItem("2026-10-30", "t").progress)
        assertNull(NotesTimeline.makeItem("2026-10-30", "t", progress = 150).progress)
    }

    /* ------------------------------------------------------ gallery */

    @Test
    fun gallerySetProgressSetsAndClears() {
        val c = NotesGallery.newCard(title = "a", content = "x", id = "c1", progress = 20)
        assertEquals(20, c.progress)
        val items = listOf(c)
        assertEquals(55, NotesGallery.setProgress(items, "c1", 55)[0].progress)
        assertNull(NotesGallery.setProgress(items, "c1", null)[0].progress)
        assertNull(NotesGallery.newCard(title = "b", content = "y", id = "c2", progress = 101).progress)
    }

    @Test
    fun galleryPatchDistinguishesAbsentFromNullProgress() {
        val items = listOf(NotesGallery.newCard(title = "a", content = "x", id = "c1", progress = 20))
        // absent key: untouched
        assertEquals(20, NotesGallery.updateCard(items, "c1", mapOf("title" to "A"))[0].progress)
        // present key with a value: set
        assertEquals(60, NotesGallery.updateCard(items, "c1", mapOf("progress" to 60))[0].progress)
        // present key with null: cleared
        assertNull(NotesGallery.updateCard(items, "c1", mapOf("progress" to null))[0].progress)
    }

    /* -------------------------------------------------- JSON round-trip */

    @Test
    fun timelineProgressSurvivesJson() {
        val items = listOf(
            item("a", progress = 40),
            item("b"),
            item("c", progress = 100, done = true),
        )
        val back = TimelineItem.listFromJson(TimelineItem.listToJson(items))
        assertEquals(40, back[0].progress)
        assertNull(back[1].progress)
        assertEquals(100, back[2].progress)
    }

    @Test
    fun galleryProgressSurvivesJson() {
        val items = listOf(
            NotesGallery.newCard(title = "a", content = "x", id = "c1", progress = 65),
            NotesGallery.newCard(title = "b", content = "y", id = "c2"),
        )
        val back = GalleryCard.listFromJson(GalleryCard.listToJson(items))
        assertEquals(65, back[0].progress)
        assertNull(back[1].progress)
    }

    @Test
    fun missingOrOddProgressParsesAsNull() {
        assertNull(TimelineItem.fromJson(JSONObject("""{"id":"a","date":"2026-10-30","text":"t"}""")).progress)
        assertNull(TimelineItem.fromJson(JSONObject("""{"id":"a","date":"2026-10-30","text":"t","progress":null}""")).progress)
        assertNull(TimelineItem.fromJson(JSONObject("""{"id":"a","date":"2026-10-30","text":"t","progress":150}""")).progress)
        assertEquals(0, TimelineItem.fromJson(JSONObject("""{"id":"a","date":"2026-10-30","text":"t","progress":0}""")).progress)
    }
}
