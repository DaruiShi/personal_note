package site.funshare.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse

import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * NotesGallery — pure-Kotlin port of public/gallery.js, plus parity checks
 * against the same sample table the web tests use (Robolectric provides a
 * real org.json on the JVM for the card round-trip).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotesGalleryTest {

    /* ------------------------------------------------------ palette */

    @Test
    fun paletteHasTwelveKeysAndMatchesTheServerOrder() {
        assertEquals(12, NotesGallery.PALETTE.size)
        // the exact order lib/gallery.js ships — cards and mirrors agree
        assertEquals(
            listOf("amber", "rose", "violet", "indigo", "sky", "teal",
                "emerald", "lime", "orange", "fuchsia", "slate", "sand"),
            NotesGallery.PALETTE,
        )
        assertTrue(NotesGallery.isPaletteKey("teal"))
        assertFalse(NotesGallery.isPaletteKey("#ff0000"))
        assertFalse(NotesGallery.isPaletteKey(null))
    }

    /* ------------------------------------------------- fallbackTitle */

    @Test
    fun fallbackTitleMatchesTheWebSampleTable() {
        // (input, expected) — same expectations as test/gallery.test.js
        val cases = listOf(
            "Simple ASCII sentence. And another one that follows it." to "Simple ASCII sentence…",
            "One sentence with no terminator at all" to "One sentence with no terminator at all",
            "" to "Untitled card",
        )
        for ((input, expected) in cases) {
            assertEquals(expected, NotesGallery.fallbackTitle(input))
        }

    }

    @Test
    fun fallbackTitleCjkTwentyFourCharsAndEllipsis() {
        val long = "第".repeat(60)
        val t = NotesGallery.fallbackTitle(long)
        assertEquals("第".repeat(24) + "…", t)
    }

    @Test
    fun fallbackTitleWordCap() {
        val words = (1..12).joinToString(" ") { "w$it" }
        val t = NotesGallery.fallbackTitle(words, maxWords = 9)
        assertEquals((1..9).joinToString(" ") { "w$it" } + "…", t)
    }

    /* ---------------------------------------------------- previewText */

    @Test
    fun previewTextTruncatesOnWordBoundariesAndKeepsSurrogatePairs() {
        assertEquals("short", NotesGallery.previewText("short"))
        val words = (1..60).joinToString(" ") { "word$it" }
        val p = NotesGallery.previewText(words, maxChars = 40)
        assertTrue(p.endsWith("…"))
        assertFalse(p.dropLast(1).endsWith(" "))
        // CJK character budget
        val cp = NotesGallery.previewText("字".repeat(300), maxChars = 50)
        assertEquals(51, cp.toList().size)
        // emoji never split
        val ep = NotesGallery.previewText("🎉".repeat(90), maxChars = 40)
        assertEquals("🎉".repeat(40) + "…", ep)
    }

    /* ---------------------------------------------------- normalizeTags */

    @Test
    fun normalizeTagsStripsHashDedupesCapsAndCapsCount() {
        assertEquals(listOf("Work", "ideas"), NotesGallery.normalizeTags("#Work, ideas,, work"))
        assertEquals(listOf("a", "b"), NotesGallery.normalizeTags("a b a B"))
        assertEquals(listOf("唯一", "标签"), NotesGallery.normalizeTags("唯一，标签，唯一"))
        assertEquals(10, NotesGallery.normalizeTags((1..20).joinToString(",") { "t$it" }).size)
        assertEquals(32, NotesGallery.normalizeTags(listOf("x".repeat(50)))[0].length)
        assertEquals(emptyList<String>(), NotesGallery.normalizeTags("   "))
    }

    /* ------------------------------------------------------ card ops */

    @Test
    fun newCardNormalizesAndGuardsThePalette() {
        val c = NotesGallery.newCard(title = "  T  ", content = " body ", tags = listOf("#a", "b"), color = "nope")
        assertEquals("T", c.title)
        assertEquals("body", c.content)
        assertEquals(listOf("a", "b"), c.tags)
        assertTrue(NotesGallery.isPaletteKey(c.color))
    }

    @Test
    fun updateRemoveReorderAndMoveByAreImmutablAndClamped() {
        val items = listOf(
            NotesGallery.newCard(title = "a", id = "a"),
            NotesGallery.newCard(title = "b", id = "b"),
            NotesGallery.newCard(title = "c", id = "c"),
        )
        val ids = { l: List<GalleryCard> -> l.map { it.id } }

        assertEquals(listOf("a", "b", "c"), ids(items)) // original untouched below
        assertEquals(listOf("c", "a", "b"), ids(NotesGallery.reorder(items, "c", 0)))
        assertEquals(listOf("b", "c", "a"), ids(NotesGallery.reorder(items, "a", 99))) // clamped
        assertEquals(listOf("b", "a", "c"), ids(NotesGallery.moveBy(items, "a", 1)))
        assertEquals(items, NotesGallery.moveBy(items, "a", 0))
        assertEquals(listOf("b", "c"), ids(NotesGallery.removeCard(items, "a")))

        val updated = NotesGallery.updateCard(items, "a", mapOf("title" to "A!", "color" to "teal"))
        assertEquals("A!", updated[0].title)
        assertEquals("teal", updated[0].color)
        assertEquals("a", items[0].title) // immutable
    }

    @Test
    fun applySuggestionFillsOnlyEmptyFields() {
        val typed = NotesGallery.newCard(title = "User typed", content = "x", id = "c1")
        val empty = NotesGallery.newCard(content = "x", id = "c2")
        var items = listOf(typed, empty)
        items = NotesGallery.applySuggestion(items, "c1", "AI title", listOf("ai"))
        assertEquals("User typed", items[0].title) // never overwritten
        assertEquals(listOf("ai"), items[0].tags)  // tags were empty
        items = NotesGallery.applySuggestion(items, "c2", "AI title", listOf("ai"))
        assertEquals("AI title", items[1].title)
    }

    /* -------------------------------------------------------- summary */

    @Test
    fun summaryCountsDistinctTagsAndColours() {
        val s = NotesGallery.summary(listOf(
            NotesGallery.newCard(title = "a", tags = listOf("x", "y"), color = "amber"),
            NotesGallery.newCard(title = "b", tags = listOf("X", "z"), color = "amber"),
            NotesGallery.newCard(title = "c", color = "teal"),
        ))
        assertEquals(NotesGallery.Summary(3, 3, 2), s)
        assertEquals(NotesGallery.Summary(0, 0, 0), NotesGallery.summary(emptyList()))
    }

    /* ------------------------------------------------- card JSON round-trip */

    @Test
    fun cardJsonRoundTripsThroughNote() {
        val note = Note(
            id = "n1", title = "Trip", content = "## mirror", tags = listOf("a"),
            pinned = false, createdAt = 1, updatedAt = 2, rev = 3,
            kind = "gallery",
            gallery = listOf(
                GalleryCard("uuid-1", "Card one", "Body", listOf("t1", "t2"), "sky", 10, 11),
                GalleryCard("uuid-2", "Card two", "Body two", emptyList(), "rose", 12, 13),
            ),
        )
        val back = Note.fromJson(JSONObject(note.toJson().toString()))
        assertTrue(back.isGallery)
        assertEquals(2, back.gallery?.size)
        assertEquals(listOf("t1", "t2"), back.gallery!![0].tags)
        assertEquals("sky", back.gallery!![0].color)
        assertFalse(back.isTimeline)
        // markdown notes carry no gallery keys
        val plain = Note("n2", "t", "c", emptyList(), false, 1, 1)
        val json = plain.toJson()
        assertFalse(json.has("gallery"))
    }
}
