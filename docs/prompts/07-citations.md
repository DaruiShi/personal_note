# Vibe-coding prompt — citations between notes: insertion, rename-safety, preview

Paste everything between the `====` markers into your coding agent.

**Read this before you start, because most of "citation" already exists.** The repo implements wiki-style citations:
`[[Note title]]` and `[[Note title|label]]` render as links in note previews (`public/app.js:296-310`), clicking one
opens the note or offers to create it (`app.js:1986-2028`), a link index is maintained in memory
(`app.js:473-475`, `app.js:712-745`), and a "Linked from" backlinks panel already shows inbound citations
(`app.js:1932`). **Do not rebuild any of that.** This prompt closes the four real gaps:

1. **There is no way to insert a citation** except typing the exact title by hand.
2. **Renaming a note breaks every citation to it** - resolution is by title only (`public/links.js:66-96`), so
   `[[Project A]]` becomes a dead "missing" link the moment the note is renamed.
3. **Citations are silent about their target** - no preview, no "which note is this?" on hover.
4. **Citations only work in markdown notes**, not in timeline items or gallery cards.

====

## Task

Make citations between notes usable: insert one without typing an exact title, keep it working after the target note
is renamed, show what it points at before you click, and (optionally) allow citations inside timeline items and
gallery cards.

The syntax does not change - `[[Title]]` and `[[Title|label]]` stay exactly as they are, and the work is additive:
a server-side alias list, an extended client resolver, an insertion picker, and a hover preview.

## Hard constraints

- **Do not change the citation syntax.** `[[Title]]` and `[[Title|label]]` must keep working exactly as they do, and
  every existing note on disk must be unchanged in meaning. Inventing a new syntax (`@note:uuid`, `((block))`, …)
  would break Obsidian-compatible export and every note already written.
- **No new top-level `db` collection.** `loadDb` (`server.js:166`) rebuilds `db` from a whitelist; unknown keys are
  silently dropped. Aliases live inside each note object, which is already whitelisted as part of `notes[]`.
- **Aliases are server-managed.** A client must never be able to invent one (that would let a note hijack another
  note's citations).
- **Zero npm dependencies, no inline script, no bundler.** CSP is `script-src 'self'`.
- **Do not rewrite other notes' content when a note is renamed.** Aliases fix resolution without touching user text;
  bulk-editing other notes on rename is out of scope and too dangerous for autosave/conflict semantics.
- **Do not break the Android app or the existing test suites.** `node --test` must pass unchanged, plus the new tests.
- **Share pages keep citations inert.** `MD.render` without a resolver already renders them as plain text
  (`app.js:310`); an anonymous reader must not be able to navigate into notes.

## Phase A - rename-proof citations (server)

### A1. `note.aliases`

Add an optional `aliases: string[]` field to notes:

- Values are trimmed titles the note was **previously** called; max **50**, deduped case-insensitively
  (`titleKey` semantics: trim, lowercase, collapse internal whitespace), empty strings dropped.
- Never exposed as writable. `sanitizeNote` (`server.js:654-660`) must not read `body.aliases`; because the PUT path
  applies changes with `Object.assign(note, sanitizeNote(body), …)` (`server.js:1066`), aliases are preserved and
  cannot be injected. Add a test that proves a PUT carrying `aliases` has no effect.
- Returned in `GET /api/notes` and `GET /api/notes/:id` automatically (whole note objects), and included in the JSON
  backup export for free.

### A2. Record an alias on rename

Create `lib/alias.js` (pure, `node:test`-covered, `{ok}`-free - just helpers):

```
MAX_ALIASES = 50
addAlias(aliases, oldTitle, newTitle) -> string[]   // pure, returns a new array
normalizeAliases(raw) -> string[]                  // used by loadDb
```

`addAlias` rules: do nothing when `titleKey(oldTitle) === titleKey(newTitle)` or `titleKey(oldTitle) === ''`;
otherwise append `oldTitle.trim()`, remove any alias equal to the new title, dedupe case-insensitively keeping the
most recent spelling, and trim to the last `MAX_ALIASES`.

Wire it into the PUT handler at the point where the title is applied (`server.js:1065-1066`):

```
const prevTitle = note.title;
Object.assign(note, sanitizeNote(body), { updatedAt: Date.now() });
if (note.title !== prevTitle) note.aliases = addAlias(note.aliases, prevTitle, note.title);
```

Do this **after** the rev/conflict check and before `saveDb()`, so a rejected write records nothing. Leave
`POST /api/notes` alone (a new note has no previous title).

### A3. Normalise on load

In the `for (const n of db.notes)` normalisation loop (`server.js:216-218`) add:
`n.aliases = normalizeAliases(n.aliases);` and delete the key when the result is empty, so a hand-edited
`notes.json` with junk aliases cannot poison resolution.

### A4. History

`historyEntry` (`server.js:284-302`) snapshots the note before each edit. Include `aliases` when present
(`e.aliases = [...]`), and make history restore apply them, exactly as it already does for `timeline`/`gallery`
items. Without this, restoring an old revision silently drops the rename history and re-breaks citations.

## Phase B - resolution and candidates (pure, client)

Edit `public/links.js` (216 lines, UMD; `buildLinkIndex`/`resolveTitle` at lines 66-96).

### B1. Index aliases

`buildLinkIndex(notes)` returns `{ byTitle, outbound, inbound }`. Add `byAlias: Map<titleKey, noteId>`:

- Build `byTitle` first with the existing rule (newest `updatedAt` wins on duplicate titles).
- Then build `byAlias` from each note's `aliases`, **skipping any key already present in `byTitle`** and skipping a
  note's own current title. On collisions between two notes' aliases, the newest `updatedAt` wins, matching the
  title rule.
- `inbound` must be computed through the same two-step lookup (`byTitle` then `byAlias`), so a citation written
  before a rename still produces a backlink.

### B2. `resolveTitle` -> `resolveCitation`

Keep `resolveTitle` (title, then alias) for compatibility, and add:

```
resolveCitation(index, notes, target) -> { id, title, kind } | null
```

`title` is the **target note's current title** (this is what makes renaming invisible to the reader), `kind` is
`'markdown' | 'timeline' | 'gallery'`. Add to the exported API.

### B3. Candidates for the picker

```
citeCandidates(index, notes, query, limit = 8)
  -> [{ id, title, kind, updatedAt, matchedBy: 'title' | 'alias' }]
```

Ranking: exact title match, then title starts with the query, then title contains, then alias contains; ties broken
by `updatedAt` descending. Case-insensitive, whitespace-collapsed. An empty query returns the most recently updated
notes. Exclude nothing else - the app filters trash out of `state.notes` already.

### B4. Safe citation text

```
citationFor(note) -> string     // '[[Title]]' ready to insert
```

Note titles are free-form, so they may contain `[`, `]` or `|` - which would corrupt the citation syntax if wrapped
naively. The rule is simple and must not be "fixed" by a clever label trick: the **target** inside `[[…]]` has to be
the note's real title (resolution matches it verbatim), so a title containing any of those characters cannot be
cited. Return a result object rather than a bare string:

```
citationFor(note) -> { text: '[[Real Title]]' } | { text: '', blocked: true, reason: 'Title contains [ ] or |' }
```

Return `text: '[[Real Title]]'` when the title is non-empty and contains none of `[`, `]`, `|`; otherwise
`blocked: true`. Never silently mangle the title, because the mangled target would resolve to nothing. The picker and
the Copy action both surface `reason` to the user instead of inserting a broken link. Keep this function pure and
test it.

### B5. Tests (`test/links.test.js`)

Extend with: alias resolution; title beats alias; alias-vs-alias collision picks the newest; `inbound` works through
an alias; `citeCandidates` ranking and limits; `citationFor` rejecting `[`/`]`/`|` titles; and a regression case
proving old title-only citations still resolve.

## Phase C - insertion UI (web)

### C1. Inline autocomplete on `[[`

In the markdown textarea (`ui.content`, `app.js:513`) add a suggestion popover:

- On `input` (and on `keydown` for the arrow keys), inspect the text between the caret and up to 60 characters back.
  If the last `[[` is unterminated and contains no `]]`, extract the query after it (stop at a newline).
- Render `#cite-suggest`, a fixed-position popover anchored under the textarea (not at the caret - caret
  coordinates in a textarea require a mirrored element and are not worth the fragility). Full width of the editor at
  ≤ 900 px, max 8 rows, each row: title, a kind badge for timeline/gallery, and a muted "also known as …" line when
  the match came from an alias.
- Keyboard: `ArrowDown`/`ArrowUp` move, `Enter` or `Tab` insert, `Escape` closes. Mouse click inserts.
- Insert: replace from the `[[` to the caret with `[[Title]]`, place the caret after it, and trigger autosave through
  the same helper the formatting toolbar uses to replace a selection (`initToolbar`, `app.js:1783-1794`). Do not
  leave a half-typed `[[` behind.
- If the query matches nothing, the popover shows "Create 'query'…" as the last row, which inserts
  `[[query]]` (the existing missing-link click flow then offers creation).
- Because `[[…]]` must not be created inside a code fence, skip the popover when the caret's line is inside an open
  fence: count fences above the caret and bail when the count is odd. Cheap and good enough.

### C2. Citation picker from the toolbar

Add a `Cite note` button to the markdown toolbar (`TOOLBAR`, `app.js:1767`) using a quote glyph icon from `ICONS`
(`app.js:21`). It opens `#cite-modal` (new, following the existing `.modal-backdrop` + `role="dialog"` pattern):

- A search input (autofocused) and the same candidate list, wired to `citeCandidates`.
- Up/down/Enter/Escape; clicking a row inserts the citation at the textarea's caret (or appends when the textarea is
  not focused).
- An "Insert as plain text" fallback is not needed - the sanitisation rule in B4 covers it.

### C3. Copy citation

In the note detail area (next to the existing share/history actions, or the note's overflow menu if one exists), add
**Copy citation**, which writes `citationFor(current())` to the clipboard with the existing `copyText()` helper and
shows `toast('Citation copied')`. If the title is uncitable (B4), toast the reason instead.

### C4. Display healing (no content edits)

`renderPreview` passes the resolver at `app.js:1890`:
`MD.render(note.content, { resolve: (t) => NotesLinks.resolveTitle(state.linkIndex, t) })`.

Change the renderer contract (`app.js:296-310`) so `opts.resolve` returns `{ id, title } | null`, and:

- when the citation has **no explicit label**, display the **resolved note's current title** (so an old `[[Old Name]]`
  renders as the renamed note's real name);
- when the citation has an explicit label (`[[Old|short name]]`), keep the author's label;
- when unresolved, keep today's behaviour exactly (`wikilink missing` with the typed target).
- `parseWikilinks` in `public/links.js` must therefore also report whether a label was explicit (additive field; keep
  the existing fields and update its tests).

This is how renaming becomes invisible to readers without rewriting anyone's note text.

### C5. Hover / focus preview

On `#preview` and on the structured-note item containers, use one delegated `mouseover`/`focusin` listener:

- When the target is `a.wikilink[data-wikilink]`, after a 250 ms delay show `#cite-preview`: the resolved note's
  title, kind badge, relative updated time, and the first ~140 characters of its content with markdown stripped
  (reuse the existing snippet/`extractSnippet` machinery in `public/links.js`).
- Hide on `mouseout`/`focusout`/`Escape`/scroll; never intercept the click.
- For a missing target show "No note titled X yet - click to create it."
- Position near the anchor with clamping to the viewport; pure CSS `position: fixed` + a single measurement is enough.
- Must be keyboard-reachable: focusing the anchor (`Tab`) shows it. Anchors already have `href="#"` so they are
  focusable; add `aria-describedby` pointing at the popover when it is visible.

## Phase D - citations in timeline items and gallery cards (optional, do last)

Timeline items and gallery card bodies are plain text today. Supporting citations there is contained:

- Add `citeify(text)` to `public/links.js`: HTML-escape the whole string, then replace `[[…]]` with the same anchor
  markup the renderer emits (`wikilink` / `wikilink missing`), leaving everything else escaped. This is the only
  new place that builds link HTML, so test it against `<script>`, `[[a]]<img onerror=x>`, and an unterminated `[[`.
- Use it wherever timeline items and gallery card content render as read-only text (the overview preview may stay
  plain text; the detail views and timeline item rows should be citeified).
- Extend the existing delegated click handler (`app.js:2015-2028`) to cover those containers.
- Editing still shows the raw `[[Title]]` text in the textarea - do not build a rich text editor.

If anything in this phase fights back, ship A-C and leave D out; the core citation experience is complete without it.

## Tests

`node --test` must pass: all existing suites plus the additions.

- `test/links.test.js` (extended, per B5).
- `test/alias.test.js` (new): `addAlias` pure behaviour - no-op on identical titles, no-op on empty old title, cap at
  50 keeping the newest, dedupe case-insensitively, removes the new title from aliases, `normalizeAliases` on junk
  input.
- `test/citations.test.js` (new, HTTP): rename a note and assert `aliases` appears on it; rename twice and assert both
  old titles are present; a PUT that sends `aliases` in the body is ignored; `GET /api/notes` returns `aliases`;
  history restore brings `aliases` back; a client-supplied junk `aliases` in `notes.json` is normalised on load.
- Manual verification:
  1. Type `[[` in a note, pick a result with the keyboard, and confirm the link is inserted and autosaves.
  2. Click the citation in preview -> the target note opens.
  3. Rename the target note, reopen the citing note -> the citation still navigates **and** now displays the new
     title; the "Linked from" panel on the renamed note still lists the citing note.
  4. Hover (and Tab-focus) a citation -> the preview popover shows the right title, kind and snippet; Escape hides it.
  5. Copy citation -> pasting into another note creates a working citation.
  6. A note with no matching target still offers to create it.
  7. Share a note containing citations -> the public page shows plain text, and clicking does nothing.
  8. Timeline and gallery detail views (if Phase D) show clickable citations.

## Definition of done

- Existing citations keep working with zero edits to note content, and renaming no longer breaks them.
- Aliases are server-managed and cannot be set by a client.
- The picker and the inline autocomplete both insert citations without leaving stray brackets.
- `node --test` green, including the three new/extended suites.
- `README.md`: one short paragraph under Features describing citations (`[[Note]]`, `[[Note|label]]`), that renaming
  keeps citations working, and the citation picker; no config changes.

## Do not

- Do not invent a new citation syntax or migrate existing `[[…]]` text.
- Do not let a client write `aliases`; do not trust them from the request body.
- Do not rewrite other notes' content when a note is renamed.
- Do not add a top-level `db` collection (the `loadDb` whitelist would drop it).
- Do not make share pages navigate or resolve citations to real notes.
- Do not build a caret-position popover with mirrored measurement - anchor it to the textarea.
- Do not replace the existing backlinks panel, `openWikilink`, or the create-on-click flow; extend around them.
- Do not touch `android-app/`; if Android's markdown renderer shows `[[…]]` literally, that is acceptable and out of
  scope.
- Do not refactor unrelated code. Keep the diff in `server.js`, `lib/alias.js`, `public/links.js`, `public/app.js`,
  `public/style.css`, `public/index.html`, `test/`, and `README.md`.

====