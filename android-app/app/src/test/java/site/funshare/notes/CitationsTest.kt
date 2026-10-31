package site.funshare.notes

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Citation aliases and the citation API — Kotlin counterparts of the web
 * tests in test/links.test.js (Robolectric for the org.json round-trip).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CitationsTest {

    private fun note(
        id: String,
        title: String,
        content: String = "",
        updatedAt: Long = 0,
        aliases: List<String>? = null,
        kind: String? = null,
    ) = Note(
        id = id, title = title, content = content, tags = emptyList(),
        pinned = false, createdAt = updatedAt, updatedAt = updatedAt,
        kind = kind, aliases = aliases,
    )

    @Test
    fun aliasResolutionKeepsPreRenameCitationsWorking() {
        val notes = listOf(
            note("a", "New Name", "", 10, aliases = listOf("Old Name", "Middle")),
            note("b", "Citer", "see [[Old Name]]", 5),
        )
        val idx = NotesLinks.buildLinkIndex(notes)
        assertEquals("a", NotesLinks.resolveTitle(idx, "Old Name"))
        assertEquals("a", NotesLinks.resolveTitle(idx, "middle")) // case-insensitive
        assertEquals("a", NotesLinks.resolveTitle(idx, "New Name"))
        // citation info carries the CURRENT title
        assertEquals(
            NotesLinks.Citation("a", "New Name", "markdown"),
            NotesLinks.resolveCitation(idx, notes, "Old Name"),
        )
        assertNull(NotesLinks.resolveCitation(idx, notes, "Nope"))
    }

    @Test
    fun realTitleBeatsAliasAndAliasCollisionsPickTheNewest() {
        val idx = NotesLinks.buildLinkIndex(listOf(
            note("real", "Shared", "", 1),
            note("other", "Other", "", 99, aliases = listOf("Shared")),
        ))
        assertFalse(idx.byAlias.containsKey("shared"))
        assertEquals("real", NotesLinks.resolveTitle(idx, "Shared"))

        val coll = NotesLinks.buildLinkIndex(listOf(
            note("old", "A", "", 1, aliases = listOf("Ghost")),
            note("new", "B", "", 50, aliases = listOf("Ghost")),
        ))
        assertEquals("new", coll.byAlias["ghost"])
    }

    @Test
    fun noteNeverAliasesItsOwnTitle() {
        val idx = NotesLinks.buildLinkIndex(listOf(
            note("n", "Title", "", 1, aliases = listOf("Title", "title")),
        ))
        assertTrue(idx.byAlias.isEmpty())
    }

    @Test
    fun inboundBacklinksFlowThroughAnAlias() {
        val notes = listOf(
            note("a", "New", "", 10, aliases = listOf("Old")),
            note("b", "Citer", "x [[Old]] y", 5),
        )
        val idx = NotesLinks.buildLinkIndex(notes)
        assertEquals(setOf("b"), idx.inbound["a"])
        val rows = NotesLinks.inboundFor(idx, "a", notes)
        assertEquals(1, rows.size)
        assertEquals("x Old y", rows[0].snippet)
    }

    @Test
    fun updateNoteRefreshesAliasClaims() {
        var idx = NotesLinks.buildLinkIndex(listOf(
            note("a", "Second", "", 1),
        ))
        // rename a -> Third records alias Second
        idx = NotesLinks.updateNote(idx, note("a", "Third", "", 2, aliases = listOf("Second")))
        assertEquals("a", idx.byAlias["second"])
        assertEquals("a", NotesLinks.resolveTitle(idx, "Second"))
        assertEquals("a", NotesLinks.resolveTitle(idx, "Third"))
    }

    @Test
    fun citeCandidatesRankingAndLimits() {
        val notes = listOf(
            note("1", "Alpha", "", 1),
            note("2", "Beta alpha", "", 2),
            note("3", "Gamma", "", 3, aliases = listOf("alpha draft")),
            note("4", "Not a match", "", 9),
        )
        val idx = NotesLinks.buildLinkIndex(notes)
        val rows = NotesLinks.citeCandidates(idx, notes, "alpha")
        assertEquals(listOf("1", "2", "3"), rows.map { it.id }) // exact > starts > alias
        assertEquals("alias", rows[2].matchedBy)
        assertEquals(4, NotesLinks.citeCandidates(idx, notes, "").size)
        assertEquals(2, NotesLinks.citeCandidates(idx, notes, "", 2).size)
        val recent = NotesLinks.citeCandidates(idx, notes, "")
        assertEquals(listOf(9L, 3L, 2L, 1L), recent.map { it.updatedAt })
        // kind badge data flows through
        val kinds = NotesLinks.citeCandidates(
            NotesLinks.buildLinkIndex(listOf(note("t", "Trip", "", 1, kind = "timeline"))),
            listOf(note("t", "Trip", "", 1, kind = "timeline")),
            "trip",
        )
        assertEquals("timeline", kinds[0].kind)
    }

    @Test
    fun citationForRejectsBracketTitlesAndNeverMangles() {
        assertEquals(NotesLinks.CitationText("[[Fine Title]]"), NotesLinks.citationFor(note("n", "Fine Title")))
        for (bad in listOf("Brack[et]", "Close]", "Pipe|", "", "   ")) {
            val r = NotesLinks.citationFor(note("n", bad))
            assertTrue(r.blocked)
            assertTrue(r.text.isEmpty())
            assertTrue(r.reason != null)
        }
        assertTrue(NotesLinks.citationFor(null).blocked)
    }

    @Test
    fun toMarkdownLinksHealsUnlabelledCitationsToTheCurrentTitle() {
        val notes = listOf(
            note("a", "New Name", "", 10, aliases = listOf("Old Name")),
        )
        val idx = NotesLinks.buildLinkIndex(notes)
        val md = NotesLinks.toMarkdownLinks(
            "see [[Old Name]] and [[Old Name|kept label]]",
            resolve = { NotesLinks.resolveTitle(idx, it) },
            resolveDisplay = { NotesLinks.resolveCitation(idx, notes, it)?.title },
        )
        // unlabelled healed to the current title; explicit label kept
        assertTrue(md.contains("[New Name](wikilink:"))
        assertTrue(md.contains("[kept label](wikilink:"))
        assertFalse(md.contains("[Old Name]"))
    }

    @Test
    fun aliasesRoundTripThroughNoteJson() {
        val note = note("n1", "T", "c", 1, aliases = listOf("Old One", "Old Two"))
        val back = Note.fromJson(JSONObject(note.toJson().toString()))
        assertEquals(listOf("Old One", "Old Two"), back.aliases)
        // markdown notes with no aliases carry no key
        val plain = note("n2", "P", "c", 1)
        assertFalse(plain.toJson().has("aliases"))
        assertNull(Note.fromJson(JSONObject(plain.toJson().toString())).aliases)
    }

    @Test
    fun citeifiedPartsSplitsTextAndCitationsAndHealsTitles() {
        val notes = listOf(
            note("a", "New Name", "", 10, aliases = listOf("Old Name")),
        )
        val idx = NotesLinks.buildLinkIndex(notes)
        val parts = NotesLinks.citeifiedParts(
            "see [[Old Name]] and [[Missing|x]] plain",
            resolve = { NotesLinks.resolveTitle(idx, it) },
            resolveDisplay = { NotesLinks.resolveCitation(idx, notes, it)?.title },
        )
        assertEquals("see ", parts[0].text)
        assertNull(parts[0].citationId)
        // healed to the target's current title; annotation keeps typed target
        assertEquals("New Name", parts[1].text)
        assertEquals("a", parts[1].citationId)
        assertEquals("Old Name", parts[1].target)
        assertEquals(" and ", parts[2].text)
        // missing target keeps the explicit label with a null id
        val miss = parts.first { it.text == "x" }
        assertNull(miss.citationId)
        assertEquals(" plain", parts.last().text)
    }

    @Test
    fun citeifiedPartsSkipsCodeAndKeepsUnresolvedAsNull() {
        val parts = NotesLinks.citeifiedParts("a [[X]] b", resolve = { null })
        assertEquals(3, parts.size)
        assertEquals("a ", parts[0].text)
        assertEquals("X", parts[1].text)
        assertNull(parts[1].citationId)
        assertEquals(" b", parts[2].text)
        // fenced code is untouched: one literal part
        val fenced = NotesLinks.citeifiedParts(
            "```\n[[X]]\n```",
            resolve = { "id" },
        )
        assertEquals(1, fenced.size)
        assertNull(fenced[0].citationId)
        assertTrue(fenced[0].text.contains("[[X]]"))
    }
}
