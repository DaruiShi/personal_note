package site.funshare.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.Date

/**
 * NotesLinks — pure-Kotlin port of the web client's public/links.js tests.
 * Dates are built from LOCAL components so assertions hold in any timezone.
 */
class NotesLinksTest {

    private fun note(
        id: String,
        title: String,
        content: String = "",
        updatedAt: Long = 0,
    ) = Note(id = id, title = title, content = content, tags = emptyList(),
        pinned = false, createdAt = updatedAt, updatedAt = updatedAt)

    /* ------------------------------------------------------ wikilink parse */

    @Test
    fun parsesPlainAndLabelledLinks() {
        val links = NotesLinks.parseWikilinks("See [[ My note ]] and [[Other|the other one]].")
        assertEquals(
            listOf(
                NotesLinks.Wikilink("My note", "My note"),
                NotesLinks.Wikilink("Other", "the other one"),
            ),
            links,
        )
    }

    @Test
    fun duplicatesCollapseToFirstOccurrence() {
        val links = NotesLinks.parseWikilinks("[[Alpha]] then [[alpha|second form]] and [[ ALPHA ]]")
        assertEquals(1, links.size)
        assertEquals("Alpha", links[0].target)
        assertEquals("Alpha", links[0].label)
    }

    @Test
    fun fencedAndInlineCodeAreNotLinks() {
        assertTrue(NotesLinks.parseWikilinks("a\n```\n[[Hidden]] and `[[Also hidden]]`\n```\nb").isEmpty())
        assertTrue(NotesLinks.parseWikilinks("a `[[X]]` b").isEmpty())
        assertEquals(
            listOf(NotesLinks.Wikilink("Real", "Real")),
            NotesLinks.parseWikilinks("```js\n[[X]]\n```\n[[Real]]"),
        )
    }

    @Test
    fun unclosedAndEmptyTargetsAreNotLinks() {
        assertTrue(NotesLinks.parseWikilinks("[[No close").isEmpty())
        assertTrue(NotesLinks.parseWikilinks("[[ ]]").isEmpty())
        assertTrue(NotesLinks.parseWikilinks("[[|label only]]").isEmpty())
        assertTrue(NotesLinks.parseWikilinks("").isEmpty())
    }

    /* ------------------------------------------------------- link index */

    @Test
    fun duplicateTitlesResolveToNewest() {
        val idx = NotesLinks.buildLinkIndex(listOf(note("old", "my   NOTE", updatedAt = 100),
            note("new", "My Note", "x", updatedAt = 200)))
        assertEquals("new", NotesLinks.resolveTitle(idx, "MY note"))
        assertEquals("new", NotesLinks.resolveTitle(idx, "  my note "))
        assertEquals("new", NotesLinks.resolveTitle(idx, "mY  nOtE")) // whitespace collapsed
        assertNull(NotesLinks.resolveTitle(idx, "Nope"))
    }

    @Test
    fun blankTitlesExcludedFromByTitleButKeepOutbound() {
        val idx = NotesLinks.buildLinkIndex(listOf(
            note("a", "   ", "link to [[Target]]"),
            note("t", "Target"),
        ))
        assertEquals("t", NotesLinks.resolveTitle(idx, "Target"))
        assertEquals(listOf("Target"), idx.outbound["a"])
        assertEquals(setOf("a"), idx.inbound["t"])
    }

    @Test
    fun inboundOutboundRoundTrip() {
        val idx = NotesLinks.buildLinkIndex(listOf(
            note("a", "Alpha", "see [[Beta]] here", 10),
            note("b", "Beta", "back to [[Alpha]] and [[Alpha|again]]", 20),
            note("c", "Gamma", "[[Alpha]] + [[Missing]]", 30),
        ))
        assertEquals(listOf("Alpha"), idx.outbound["b"]) // deduplicated
        assertEquals(setOf("b", "c"), idx.inbound["a"])
        assertNull(idx.inbound[NotesLinks.resolveTitle(idx, "Missing")])
    }

    @Test
    fun inboundForNewestFirstWithSnippetAndNoSelfLinks() {
        val notes = listOf(
            note("a", "Alpha", "see [[Beta]] here", 10),
            note("b", "Beta", "back to [[Alpha]]", 20),
            note("c", "Gamma", "[[Alpha]] mentioned", 30),
            note("s", "Alpha self", "[[Alpha self]]", 5),
        )
        val idx = NotesLinks.buildLinkIndex(notes)
        val back = NotesLinks.inboundFor(idx, "a", notes)
        assertEquals(2, back.size)
        assertEquals("c", back[0].id) // newest first
        assertTrue(back[0].snippet.contains("Alpha"))
        // self-link never surfaces as a backlink
        val selfIdx = NotesLinks.buildLinkIndex(listOf(note("x", "X", "[[X]] self")))
        assertTrue(NotesLinks.inboundFor(selfIdx, "x", listOf(note("x", "X", "[[X]] self"))).isEmpty())
    }

    @Test
    fun updateNoteReplacesOutboundAndTitleEntry() {
        val notes = listOf(
            note("a", "Alpha", "see [[Beta]]", 10),
            note("b", "Beta", "hello [[Alpha]]", 20),
        )
        val idx = NotesLinks.buildLinkIndex(notes)
        assertEquals(setOf("a"), idx.inbound["b"])

        // a saves: retitles and drops its outbound link
        val updated = notes[0].copy(title = "Renamed", content = "no links now", updatedAt = 99)
        val idx2 = NotesLinks.updateNote(idx, updated)
        assertEquals(emptySet<String>(), idx2.inbound["b"])
        assertEquals("a", idx2.byTitle["renamed"]) // new title claimed
        assertNull(idx2.byTitle["alpha"]) // old title freed
        assertEquals(emptyList<String>(), idx2.outbound["a"])
    }

    /* --------------------------------------------------------- snippets */

    @Test
    fun extractSnippetStripsMarkdownAndClips() {
        val line = "Some **bold** intro text before the link [[Target|the place]] " +
            "and quite a lot of trailing text to force a clip of this longer line"
        val snip = NotesLinks.extractSnippet(line, "target", 60)
        assertTrue(snip.length <= 60)
        assertTrue(snip.contains("the place"))
        assertTrue(snip.startsWith("...") || snip.endsWith("..."))
        assertFalse(snip.contains("**"))
    }

    @Test
    fun extractSnippetSkipsFencedHitsAndHandlesMissing() {
        assertEquals("plain Target line",
            NotesLinks.extractSnippet("para\n```\n[[Target]]\n```\nplain [[Target]] line", "Target"))
        assertEquals("", NotesLinks.extractSnippet("nothing here", "Target"))
    }

    /* ---------------------------------------------- markdown conversion */

    @Test
    fun toMarkdownLinksEncodesTargetsAndMarksMissing() {
        val idx = NotesLinks.buildLinkIndex(listOf(note("t", "Target Note")))
        val md = NotesLinks.toMarkdownLinks("See [[Target Note|hint]] and [[Nope]].", resolve = { NotesLinks.resolveTitle(idx, it) })
        assertEquals("See [hint](wikilink:Target+Note) and [Nope](wikilinkx:Nope).", md)
        // round-trip: the scheme URLs decode back to the targets
        assertEquals("Target Note", NotesLinks.wikilinkTarget("wikilink:Target+Note"))
        assertEquals("Nope", NotesLinks.wikilinkTarget("wikilinkx:Nope"))
        assertTrue(NotesLinks.isWikilinkUrl("wikilink:x"))
        assertTrue(NotesLinks.isWikilinkUrl("wikilinkx:x"))
        assertFalse(NotesLinks.isWikilinkUrl("https://x"))
    }

    @Test
    fun toMarkdownLinksLeavesCodeAlone() {
        val md = NotesLinks.toMarkdownLinks("a `[[X]]` b\n```\n[[Y]]\n```", resolve = { null })
        assertTrue(md.contains("`[[X]]`"))
        assertTrue(md.contains("[[Y]]"))
        assertFalse(md.contains("wikilink"))
    }

    /* ------------------------------------------------------ daily dates */

    private fun localDate(y: Int, m: Int, d: Int, hour: Int = 12, min: Int = 0): Date {
        val c = Calendar.getInstance()
        c.clear()
        c.set(y, m - 1, d, hour, min)
        return c.time
    }

    @Test
    fun localDateKeyUsesLocalComponents() {
        // 00:30 local on Oct 31 is still Oct 30 in UTC — must stay Oct 31
        assertEquals("2026-10-31", NotesLinks.localDateKey(localDate(2026, 10, 31, 0, 30)))
        assertEquals("2026-10-30", NotesLinks.localDateKey(localDate(2026, 10, 30, 23, 59)))
        assertEquals("2026-03-05", NotesLinks.localDateKey(localDate(2026, 3, 5))) // zero-padded
    }

    @Test
    fun parseDateKeyValidatesCalendarDates() {
        val d = NotesLinks.parseDateKey("2026-10-30")
        val c = Calendar.getInstance().apply { time = d }
        assertEquals(2026, c.get(Calendar.YEAR))
        assertEquals(9, c.get(Calendar.MONTH))
        assertEquals(30, c.get(Calendar.DAY_OF_MONTH))
        assertEquals(0, c.get(Calendar.HOUR_OF_DAY)) // local midnight

        assertNull(NotesLinks.parseDateKey("2026-02-30")) // not a real date
        assertNull(NotesLinks.parseDateKey("2026-13-01"))
        assertNull(NotesLinks.parseDateKey("26-10-30"))
        assertNull(NotesLinks.parseDateKey("2026-1-30"))
        assertNull(NotesLinks.parseDateKey("1066-10-30")) // before 1970
        assertNull(NotesLinks.parseDateKey("3026-10-30")) // after 2999
        assertNull(NotesLinks.parseDateKey(""))
    }

    @Test
    fun parseDateKeyLeapYears() {
        assertEquals("2024-02-29",
            NotesLinks.localDateKey(NotesLinks.parseDateKey("2024-02-29")!!))
        assertNull(NotesLinks.parseDateKey("2026-02-29"))
    }

    @Test
    fun addDaysAcrossMonthYearAndLeapBoundaries() {
        assertEquals("2026-02-01", NotesLinks.addDays("2026-01-31", 1))
        assertEquals("2027-01-01", NotesLinks.addDays("2026-12-31", 1))
        assertEquals("2025-12-31", NotesLinks.addDays("2026-01-01", -1))
        assertEquals("2024-02-29", NotesLinks.addDays("2024-02-28", 1))
        assertEquals("2026-03-01", NotesLinks.addDays("2026-02-28", 1))
        assertEquals("2026-02-28", NotesLinks.addDays("2026-03-01", -1))
        assertNull(NotesLinks.addDays("not-a-date", 1))
    }

    @Test
    fun isDateTitleOnlyExactKeys() {
        assertTrue(NotesLinks.isDateTitle("2026-10-30"))
        assertTrue(NotesLinks.isDateTitle(" 2026-10-30 "))
        assertFalse(NotesLinks.isDateTitle("2026-02-30"))
        assertFalse(NotesLinks.isDateTitle("2026-10-3"))
        assertFalse(NotesLinks.isDateTitle("Today"))
        assertFalse(NotesLinks.isDateTitle(""))
    }

    @Test
    fun formatDayLabelCarriesTheYear() {
        val label = NotesLinks.formatDayLabel("2026-10-30")
        assertTrue(label.contains("2026"))
        assertTrue(label.isNotEmpty())
        assertEquals("nope", NotesLinks.formatDayLabel("nope"))
    }

    @Test
    fun dateKeyRoundTrip() {
        for (key in listOf("2026-10-30", "2024-02-29", "1999-12-31", "2999-01-01")) {
            assertEquals(key, NotesLinks.localDateKey(NotesLinks.parseDateKey(key)!!))
        }
    }
}
