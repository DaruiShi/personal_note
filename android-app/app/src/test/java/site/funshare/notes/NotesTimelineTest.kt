package site.funshare.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * NotesTimeline — pure-Kotlin port of the web client's public/timeline.js
 * tests, plus Note JSON round-trips for timeline fields (Robolectric
 * provides a real org.json on the JVM).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class NotesTimelineTest {

    private fun item(date: String, text: String, createdAt: Long = 0, done: Boolean = false) =
        TimelineItem(id = "id-$date-$createdAt-$text.take(3)", date = date, text = text, done = done, createdAt = createdAt, updatedAt = createdAt)

    private val addDays = { key: String, d: Int -> NotesLinks.addDays(key, d) }

    /* --------------------------------------------------------- ordering */

    @Test
    fun timePresetsAreFourValidOrderedRanges() {
        val hhmm = Regex("^([01]\\d|2[0-3]):[0-5]\\d$")
        assertEquals(4, NotesTimeline.TIME_PRESETS.size)
        for (p in NotesTimeline.TIME_PRESETS) {
            assertTrue(hhmm.matches(p.start))
            assertTrue(hhmm.matches(p.end))
            assertTrue("${p.label}: end after start", p.end > p.start)
        }
        val starts = NotesTimeline.TIME_PRESETS.map { it.start }
        assertEquals(starts.sorted(), starts)
        for (i in 1 until NotesTimeline.TIME_PRESETS.size) {
            assertTrue("adjacent presets do not overlap",
                NotesTimeline.TIME_PRESETS[i].start >= NotesTimeline.TIME_PRESETS[i - 1].end)
        }
    }

    @Test
    fun sortAndGroupByDate() {
        val sorted = NotesTimeline.sortItems(listOf(
            item("2026-10-30", "late", 9),
            item("2026-10-29", "second", 5),
            item("2026-10-29", "first", 2),
        ))
        assertEquals(listOf("first", "second", "late"), sorted.map { it.text })
        val groups = NotesTimeline.groupByDate(listOf(
            item("2026-10-30", "b", 2), item("2026-10-29", "x", 1), item("2026-10-30", "a", 1),
        ))
        assertEquals(listOf("2026-10-29", "2026-10-30"), groups.map { it.first })
        assertEquals(listOf("a", "b"), groups[1].second.map { it.text })
    }

    @Test
    fun withinDateOrderWinsThenTimeThenUntimedLast() {
        fun at(text: String, start: String?, createdAt: Long, order: Int? = null) =
            item("2026-10-30", text, createdAt).copy(start = start, order = order)
        val sorted = NotesTimeline.sortItems(listOf(
            at("untimed", null, 1),
            at("afternoon", "14:00", 2),
            at("morning", "07:30", 3),
            at("dragged up", "16:00", 4, 0),
        ))
        assertEquals(listOf("dragged up", "morning", "afternoon", "untimed"), sorted.map { it.text })
    }

    @Test
    fun insertItemSlotsByTimeAndRenumber() {
        var items = listOf(
            item("2026-10-30", "morning", 1).copy(start = "09:00"),
            item("2026-10-30", "evening", 2).copy(start = "18:00"),
        )
        items = NotesTimeline.insertItem(items, NotesTimeline.makeItem("2026-10-30", "noon", start = "12:00"))
        assertEquals(listOf("morning", "noon", "evening"), NotesTimeline.sortItems(items).map { it.text })
        assertEquals(listOf(0, 1, 2), NotesTimeline.sortItems(items).map { it.order })
        items = NotesTimeline.insertItem(items, NotesTimeline.makeItem("2026-10-30", "whenever"))
        assertEquals("whenever", NotesTimeline.sortItems(items).last().text) // untimed appends
    }

    @Test
    fun moveWithinDateReordersAndRenumbers() {
        var items = listOf(
            item("2026-10-30", "a", 1).copy(order = 0),
            item("2026-10-30", "b", 2).copy(order = 1),
            item("2026-10-30", "c", 3).copy(order = 2),
        )
        val idA = items[0].id
        val idB = items[1].id
        items = NotesTimeline.moveWithinDate(items, idA, null) // drag to the end
        assertEquals(listOf("b", "c", "a"), NotesTimeline.sortItems(items).map { it.text })
        items = NotesTimeline.moveWithinDate(items, idA, idB) // and back before b
        assertEquals(listOf("a", "b", "c"), NotesTimeline.sortItems(items).map { it.text })
        assertEquals(listOf(0, 1, 2), NotesTimeline.sortItems(items).map { it.order })
    }

    @Test
    fun updateItemTimeReslotsByNewTime() {
        var items = listOf(
            item("2026-10-30", "morning", 1).copy(start = "09:00", order = 0),
            item("2026-10-30", "evening", 2).copy(start = "18:00", order = 1),
        )
        val morningId = items[0].id
        items = NotesTimeline.updateItemTime(items, morningId, "20:00", null)
        assertEquals(listOf("evening", "morning"), NotesTimeline.sortItems(items).map { it.text })
        items = NotesTimeline.updateItemTime(items, morningId, null, null)
        assertEquals(null, NotesTimeline.sortItems(items).last().start) // untimed last
    }

    @Test
    fun parseFallbackExtractsTimeRanges() {
        val out = NotesTimeline.parseFallback(
            listOf(
                "2026-10-24 14:00-16:00 standup",
                "昨天 9:30am jog",
                "3pm call",
                "9am-11am deep work",
                "no time line",
                "2 people came",
                "14:00 plain clock",
            ).joinToString("\n"),
            "2026-10-30", addDays,
        )
        assertEquals(
            listOf(
                Triple("2026-10-24", "14:00", "16:00"),
                Triple("2026-10-29", "09:30", null),
                Triple("2026-10-30", "15:00", null),
                Triple("2026-10-30", "09:00", "11:00"),
                Triple("2026-10-30", null, null),
                Triple("2026-10-30", null, null), // "2 people" is not a clock
                Triple("2026-10-30", "14:00", null),
            ),
            out.map { Triple(it.date, it.start, it.end) },
        )
        assertEquals(
            listOf("standup", "jog", "call", "deep work", "no time line", "2 people came", "plain clock"),
            out.map { it.text },
        )
    }

    @Test
    fun pageDatesUnionsItemsTodayAndVisited() {
        val dates = NotesTimeline.pageDates(
            listOf(item("2026-10-20", "a"), item("2026-10-22", "b")),
            today = "2026-10-30",
            visited = setOf("2026-11-01", "2026-10-30", "not-a-date"),
        )
        assertEquals(listOf("2026-10-20", "2026-10-22", "2026-10-30", "2026-11-01"), dates)
    }

    /* ----------------------------------------------------- item editing */

    @Test
    fun makeItemStartsNotDoneWithTempId() {
        val m = NotesTimeline.makeItem("2026-10-30", "  hello  ", 1234)
        assertTrue(m.id.startsWith("tmp:"))
        assertEquals("hello", m.text)
        assertFalse(m.done)
    }

    @Test
    fun mutationsAreImmutableAndBumpUpdatedAt() {
        val a = item("2026-10-30", "one", 1)
        val b = item("2026-10-30", "two", 2)
        val items = listOf(a, b)
        val edited = NotesTimeline.updateText(items, a.id, "one!", now = 99)
        assertEquals("one!", edited[0].text)
        assertEquals("one", items[0].text) // original untouched
        assertEquals(99L, edited[0].updatedAt)

        val moved = NotesTimeline.move(items, b.id, "2026-11-02", now = 99)
        assertEquals("2026-11-02", moved[1].date)
        assertEquals("2026-10-30", items[1].date)

        val gone = NotesTimeline.remove(items, a.id)
        assertEquals(listOf(b.id), gone.map { it.id })

        val flipped = NotesTimeline.toggleDone(items, a.id, now = 99)
        assertTrue(flipped[0].done)
        assertFalse(items[0].done)
        assertFalse(NotesTimeline.toggleDone(flipped, a.id, now = 99)[0].done)
    }

    @Test
    fun mergeParsedSkipsDuplicatesAndIsIdempotent() {
        val existing = listOf(item("2026-10-30", "Buy milk", 1))
        val incoming = listOf(
            NotesTimeline.Parsed("2026-10-30", "Buy   milk"), // same after normalising
            NotesTimeline.Parsed("2026-10-31", "Buy milk"),   // other date: keep
            NotesTimeline.Parsed("2026-10-30", "Buy bread"),
        )
        val merged = NotesTimeline.mergeParsed(existing, incoming)
        assertEquals(3, merged.size)
        assertEquals(3, NotesTimeline.mergeParsed(merged, incoming).size)
    }

    /* -------------------------------------------------- fallback parser */

    @Test
    fun parseFallbackEmptyAndBlank() {
        assertTrue(NotesTimeline.parseFallback("", "2026-10-30", addDays).isEmpty())
        assertTrue(NotesTimeline.parseFallback("  \n \n", "2026-10-30", addDays).isEmpty())
    }

    @Test
    fun parseFallbackDatelessLinesLandOnTodayFlaggedGuessed() {
        val out = NotesTimeline.parseFallback("just a thought\nanother", "2026-10-30", addDays)
        assertEquals(listOf("2026-10-30", "2026-10-30"), out.map { it.date })
        assertEquals(listOf(true, true), out.map { it.guessed })
    }

    @Test
    fun parseFallbackRecognisesAllTokenKinds() {
        val out = NotesTimeline.parseFallback(
            listOf(
                "2026-10-24 ISO item",
                "10/20 slash item",
                "10月18日 chinese item",
                "10月16号 other chinese",
                "今天：morning run",
                "昨天 - bought shoes",
                "前天 early start",
                "星期一 gym", // 2026-10-30 is a Friday -> Monday = 10-26
                "plain tail line",
            ).joinToString("\n"),
            "2026-10-30", addDays,
        )
        assertEquals(
            listOf("2026-10-24", "2026-10-20", "2026-10-18", "2026-10-16",
                "2026-10-30", "2026-10-29", "2026-10-28", "2026-10-26", "2026-10-30"),
            out.map { it.date },
        )
        assertEquals(
            listOf("ISO item", "slash item", "chinese item", "other chinese",
                "morning run", "bought shoes", "early start", "gym", "plain tail line"),
            out.map { it.text },
        )
        assertEquals(listOf(false, false, false, false, false, false, false, false, true), out.map { it.guessed })
    }

    @Test
    fun parseFallbackKeepsSameDateTwice() {
        val out = NotesTimeline.parseFallback("2026-10-30 first\n2026-10-30 second", "2026-10-30", addDays)
        assertEquals(listOf("first", "second"), out.map { it.text })
    }

    /* -------------------------------------------------- model round-trip */

    @Test
    fun noteJsonRoundTripsTimelineFields() {
        val note = Note(
            id = "n1", title = "Trip", content = "## mirror", tags = listOf("a"),
            pinned = true, createdAt = 1, updatedAt = 2, rev = 3,
            kind = "timeline",
            timeline = listOf(
                TimelineItem("uuid-1", "2026-10-30", "wash dishes", true, "09:00", "10:30", 0, 10, 11),
                TimelineItem("uuid-2", "2026-10-29", "buy milk", false, null, null, null, 12, 13),
            ),
        )
        val back = Note.fromJson(JSONObject(note.toJson().toString()))
        assertTrue(back.isTimeline)
        assertEquals(2, back.timeline?.size)
        assertEquals(true, back.timeline!![0].done)
        assertEquals("09:00", back.timeline!![0].start)
        assertEquals("10:30", back.timeline!![0].end)
        assertEquals(0, back.timeline!![0].order)
        assertEquals("wash dishes", back.timeline!![0].text)
        assertEquals("uuid-1", back.timeline!![0].id)

        // markdown notes carry no kind/timeline keys
        val plain = Note("n2", "t", "c", emptyList(), false, 1, 1)
        val json = plain.toJson()
        assertFalse(json.has("kind"))
        assertFalse(json.has("timeline"))
        assertFalse(Note.fromJson(json).isTimeline)
    }

    @Test
    fun summarizeCountsDatesAndRange() {
        val s = NotesTimeline.summarize(listOf(
            item("2026-10-30", "a", 1), item("2026-10-28", "b", 2), item("2026-10-30", "c", 3),
        ))
        assertEquals(3, s.total)
        assertEquals(2, s.dates)
        assertEquals("2026-10-28", s.first)
        assertEquals("2026-10-30", s.last)
        val empty = NotesTimeline.summarize(emptyList())
        assertEquals(0, empty.total)
        assertNull(empty.first)
    }
}
