# Vibe-coding prompt — wikilinks, backlinks, and daily notes (web only)

Paste everything between the `====` markers into your coding agent.

**Scope note for you:** this change touches **only `public/` and `test/`**. No server change, no new endpoint, no
schema change, no Android work. Wikilinks are pure syntax, backlinks are computed from notes already in memory, and
daily notes are ordinary notes whose title is a date.

====

## Task

Add three connected features to the web client only:

1. **Wikilinks** - `[[Note title]]` and `[[Note title|label]]` in note content render as links; clicking opens
   that note, and clicking a link to a note that does not exist offers to create it.
2. **Backlinks** - at the bottom of a note's preview, show every other note that links to it, with a snippet.
3. **Daily notes** - a "Today" button in the sidebar that opens or creates today's note (title `YYYY-MM-DD`), plus
   prev/next day navigation while viewing a daily note.

## Hard constraints - violate none of them

- **Web only.** Do not modify `server.js`, the API, `data/notes.json`, or `android-app/`. Nothing here needs the
  server: every note is already in `state.notes`, and a daily note is created with the existing `POST /api/notes`.
- **Zero npm dependencies and no build step.** Plain browser JS in `public/`, ES2020, no bundler, no TypeScript.
- **No inline script.** CSP is `script-src 'self'` (`server.js:69-75`); add files to `public/` and reference them
  from `public/index.html`.
- **The markdown renderer must stay safe.** `MD` (`public/app.js:48`) escapes all input at `app.js:283` and uses
  `\uE000`/`\uE100` placeholder tokens so code spans and math never get processed by later passes
  (`app.js:260-296`). Your wikilink pass must preserve that property and must never insert un-escaped text.
- **Do not confuse notes with the trash.** `state.notes` holds live notes only; never scan trash for links.
- **Keep the renderer pure.** `MD` is an IIFE with no access to app state. Pass the resolver in through the
  `render()` options (see Phase B) - do not reach out to globals from inside `MD`.

## Phase A - a pure, testable module: `public/links.js`

The repo has no frontend test runner and must not gain one, so put all the logic worth testing in a standalone file
with no DOM access.

Create `public/links.js` as a UMD-style module that sets `window.NotesLinks` and, when `module` exists, also
`module.exports` - so `node --test` can require it directly (`app.js` is an IIFE at `public/app.js:2`, so this
global is how it will be consumed).

Export exactly these pure functions:

- `parseWikilinks(text)` -> deduplicated array of `{ target, label }`, where `target` and `label` are trimmed.
  Supports `[[Title]]` and `[[Title|label]]`. Ignores empty targets. A `[[` with no closing `]]` is not a link.
  Fenced code blocks (```` ``` ````) and inline code spans (`` `...` ``) must be excluded - a wikilink inside code is
  not a link.
- `buildLinkIndex(notes)` -> `{ byTitle, outbound, inbound }`. `byTitle` maps a normalised title to a note id (see
  normalisation below); `outbound` maps a note id to the list of distinct targets it links to; `inbound` maps a note
  id to the set of note ids that link to it. Notes with an empty or whitespace-only title are excluded from
  `byTitle` but may still have outbound links.
- `titleKey(title)` -> the normalisation used for matching: `String(title).trim().toLowerCase()` with internal
  whitespace collapsed to single spaces.
- `resolveTitle(index, target)` -> note id or `null`.
- `inboundFor(index, noteId, notes)` -> array of `{ id, title, snippet }`, newest `updatedAt` first, capped at 50.
  `snippet` is built by `extractSnippet` around the first wikilink that points at `noteId`.
- `extractSnippet(content, targetTitle, maxChars = 90)` -> one line of plain text: find the first `[[...]]` whose
  target matches `targetTitle`, strip markdown syntax (fences, backticks, images, link syntax, `#`/`>`/list markers,
  emphasis, table pipes), collapse whitespace, and return a window around the match with `...` markers.
- `localDateKey(date)` -> `YYYY-MM-DD` from the **local** date components (`getFullYear`, `getMonth()+1`,
  `getDate`). Never use `toISOString()`, which shifts to UTC and breaks evening timestamps east of Greenwich.
- `parseDateKey(key)` -> a `Date` at local midnight, or `null` if the key is not exactly `YYYY-MM-DD` or is not a
  real calendar date (`2026-02-30` must be `null`; reject years outside 1970-2999).
- `addDays(key, delta)` -> a canonical date key. Must use `Date#setDate` so month, year and DST boundaries are
  handled by the platform, and must return `null` for an invalid input key.
- `isDateTitle(title)` -> boolean, i.e. `parseDateKey(title) !== null`.
- `formatDayLabel(key)` -> a human label such as `Fri, 30 Oct 2026` via `toLocaleDateString([], {weekday:'short',
  year:'numeric', month:'short', day:'numeric'})`.

For the duplicate-title case, `buildLinkIndex` must resolve a normalised title to the note with the newest
`updatedAt`, so results are deterministic.

Add `test/links.test.js` and `test/daily.test.js` (`node:test` + `node:assert/strict`, requiring
`../public/links.js` - the existing suites in `test/` show the style). Cover: plain and labelled links; multiple
links deduplicated; unresolved targets; exclusion of fenced and inline code; title normalisation (case, padding,
internal whitespace); duplicate titles resolving to the newest; `inbound`/`outbound` round-trip; snippet
containment and length; and for daily: local-date formatting (construct a `Date` from local components, not a UTC
string), month-end, year-end, leap day, the `2026-02-30` rejection, and `addDays` across a DST boundary.

## Phase B - render wikilinks

`MD.render(src)` (`public/app.js:254`) gains an optional second argument. Change the signature to
`render(src, opts = {})` and thread `opts` into `inline`.

Inside `inline` (`app.js:260-296`), insert the wikilink pass **between line 292 (`~~del~~`) and line 293 (code-span
restore)**. That position matters:

- it is after `escapeHtml` (`app.js:283`), so all surrounding text is already escaped - do **not** escape again or
  double-escaping will corrupt the output;
- it is after every other inline replacement, so the generated `<a>` markup cannot be mangled by the link, bold or
  emphasis regexes above it;
- it is before placeholder restoration, so wikilinks inside code spans and math were already replaced by
  `\uE000`/`\uE100` tokens and can never match.

Pattern: `/\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g`.

Behaviour:

- `target` = trimmed capture 1, `label` = trimmed capture 2 or `target`.
- **Without** `opts.resolve` (the default - used by the share page at `app.js:2372` and the history viewer at
  `app.js:2008`): emit `<span class="wikilink-plain">{label}</span>`. Share pages must never contain clickable
  links to notes the visitor cannot open.
- **With** `opts.resolve(target)` returning a note id: emit
  `<a class="wikilink" href="#" data-wikilink="{targetEscaped}">{label}</a>`.
- Resolver returns `null`: emit
  `<a class="wikilink missing" href="#" data-wikilink="{targetEscaped}" title="Create this note">{label}</a>`.

`targetEscaped` is the target as it already appears in the escaped string (quotes have become `&quot;`), so it is
safe inside the attribute; do not re-escape `label` either.

Then in `renderPreview()` (`app.js:1770-1773`) pass the resolver:

```
MD.render(note.content, { resolve: (t) => NotesLinks.resolveTitle(state.linkIndex, t) })
```

### Click handling

Add one delegated listener on `ui.preview` (do not attach a handler per link):

- `const link = e.target.closest('a.wikilink'); if (!link) return; e.preventDefault();`
- Resolved link -> `selectNote(id)` (`app.js:1103`).
- Missing link -> `confirmModal({title: 'Create this note?', text: 'No note titled "X" exists…', confirmText:
  'Create'})` (`confirmModal` is defined at `app.js:561`); on confirm `POST /api/notes` with that title, prepend
  the returned note to `state.notes`, update the link index, `renderList()`, and `selectNote(newId, {edit: true,
  focusTitle: true})` so the user can start writing immediately.
- Because the links are real `<a href="#">` anchors, keyboard activation works natively; keep `href="#"` and rely on
  `preventDefault`.

## Phase C - backlinks panel

Maintain the index in one place:

- Add `state.linkIndex = { byTitle: new Map(), outbound: new Map(), inbound: new Map() }` to `state`
  (`app.js:437`).
- Rebuild it (`NotesLinks.buildLinkIndex(state.notes)`) in `enterApp` (`app.js:664`) right after
  `state.notes = data.notes`, and after any create, delete, purge, or restore.
- On a successful save (`saveNote` at `app.js:1162`), update incrementally instead of rebuilding: update that
  note's entry in the index. A full rebuild on every autosave would scan every note's full content on each 700 ms
  debounce.

Render it in `renderPreview()`: after setting `ui.preview.innerHTML`, append a `<section class="backlinks">` (skip
when there are none, or when the current note is the only note). Contents:

- `<h3>Linked from <span class="count">N</span></h3>` (omit the count when N is 0).
- A `<ul>` of `<li><button class="backlink-row" type="button">` items, each with the source note title and its
  snippet; `data-id` carries the id; the delegated click handler calls `selectNote(id)`.
- If N > 50, render 50 and a final muted line "and N more".
- Include the outbound direction too: a short line above, `Links to N notes`, listing the resolved outbound titles
  as inline wikilink-style buttons. (Unresolved outbound targets are shown in the "missing" style.)

Backlinks are preview-only; do not build a separate panel in write mode.

## Phase D - daily notes

### Sidebar entry

In `public/index.html`, after the `#new-note-btn` button (`index.html:46`), add:

```html
<button class="new-note-btn ghost" id="today-btn" type="button">
  <span class="ic" id="today-ic"></span><span id="today-label">Today</span>
</button>
```

Set its label text to `Today` and its icon in `initIcons()` (`app.js:2445`) from a new `ICONS.calendar()` entry
(`ICONS` starts at `app.js:21`; the `svg()` helper is at `app.js:15`).

### Open or create

`openDailyNote(key)`:

1. `await flushSave()` first (the existing helper, so a pending edit is not lost).
2. Find `state.notes.find((n) => NotesLinks.titleKey(n.title) === NotesLinks.titleKey(key))`. If found,
   `selectNote(found.id)` and return.
3. Otherwise `POST /api/notes` with `{title: key, content: '', tags: [], folderId: state.folderFilter || null}`,
   prepend it to `state.notes`, update the index, `renderList()`, then `selectNote(note.id, {edit: true,
   focusTitle: false})`.
4. **Duplicate-creation guard:** after the `POST` resolves, re-check for an existing note with the same title. If
   another one appeared while the request was in flight (two tabs, double click), keep the older one, delete the
   note you just created via `DELETE /api/notes/:id`, and select the survivor.

Wire `#today-btn` -> `openDailyNote(NotesLinks.localDateKey(new Date()))`.

### Prev / next day

In `public/index.html`, inside `.editor-header` (`index.html:89-115`), insert a bar between `.editor-top`
(`index.html:90-108`) and `.tag-editor` (`index.html:109`):

```html
<div class="day-nav hidden" id="day-nav">
  <button class="icon-btn" id="day-prev" type="button" aria-label="Previous day"></button>
  <span class="day-label" id="day-label"></span>
  <button class="icon-btn" id="day-next" type="button" aria-label="Next day"></button>
  <button class="btn sm" id="day-today" type="button">Today</button>
</div>
```

In `app.js`:

- `updateDayNav()`: called from `selectNote` (after the note is applied) and from `renderPreview`. If
  `NotesLinks.isDateTitle(current()?.title)` is false, add `hidden` and return; otherwise show the bar, set the
  label with `formatDayLabel`, and store the current key.
- `#day-prev` / `#day-next` -> `openDailyNote(NotesLinks.addDays(currKey, -1 | +1))`.
- `#day-today` -> `openDailyNote(localDateKey(new Date()))`.
- Icons for the arrows from `ICONS` (a chevron already exists - reuse or add `chevronLeft`/`chevronRight`).
- Renaming a daily note's title away from a date must hide the bar on the next `selectNote`; renaming it to a date
  must show it. Drive it only from the current title, never from a stored flag.

### Optional (do last, only if everything above is green)

**"On this day"**: when a daily note is open, above the preview content render a small card listing notes from
earlier years whose `createdAt` or `updatedAt` falls on the same month and day. Use local date components, cap at
5, skip the current note, and render nothing when empty. This is throwaway-easy and skippable - do not let it delay
the rest.

## Styling and accessibility

Add to `public/style.css`:

- `.wikilink` - an underlined, accent-coloured link; `.wikilink.missing` - dashed underline, muted colour,
  `cursor: pointer`; `.wikilink-plain` - inherits the surrounding text style (no link affordance).
- `.backlinks` - separated by a top border, muted heading, scrolls with the preview.
- `.backlink-row`, `.backlinks .count`.
- `.day-nav` - a compact horizontal bar; `.day-label` uses a tabular-nums monospace-ish weight.
- `.new-note-btn.ghost` - reuses the new-note button styles with a quieter treatment.
- Respect both themes: use the existing CSS custom properties (`:root` at `public/style.css:3-25`, with the dark
  theme block immediately after), never hard-coded colours.
- Links must not use `outline: none`; keep visible focus rings.

Accessibility: `#day-prev`/`#day-next` have `aria-label`s; `#today-btn` has an `aria-label`; `.backlink-row` is a
real `<button>`, so it is keyboard-reachable without extra work.

## Manual verification (this is the real acceptance test)

1. Type `See [[My first note]] and [[Nope|a missing one]].` in a note, switch to Preview: the first is a normal
   link, the second is styled as missing. Click the first -> that note opens. Click the second -> the create
   prompt appears, and confirming creates an empty note with that title and opens it in write mode.
2. Open "My first note" -> its preview now shows a "Linked from" section listing the source note with a snippet;
   clicking the row navigates.
3. Put a wikilink inside a fenced code block and inside backticks -> both stay literal, no link.
4. Put `[[X]]` inside `$math$` -> untouched.
5. Click "Today" -> a note titled today's local date opens, editable, and autosaves. Click "Today" again -> the
   same note opens, no duplicate is created.
6. In a daily note day-nav, step back across a month boundary and forward again; the labels and titles are correct.
7. Rename a daily note to something else -> the day-nav bar disappears. Rename it back -> it returns.
8. Open a public share link containing a wikilink -> it renders as plain text, not a dead link.
9. History viewer (`#history-modal`) renders wikilinks as plain text too.
10. `node --test` passes, including all six existing suites.

## Definition of done

- `node --test` passes with the two new files and the six existing ones.
- The ten manual checks above pass.
- `server.js`, `android-app/`, `package.json` and `data/` are untouched (`git diff --stat` should show only
  `public/` and `test/`).
- No dependency added; no inline script; `public/links.js` is loaded from `index.html` **before** `app.js` (both
  `defer`, so order is preserved).
- README updated: a short "Wikilinks and daily notes" section under Features documenting the two syntaxes, the
  missing-link behaviour, and the `YYYY-MM-DD` convention for daily notes.

## Do not

- Do not touch `server.js` or add an endpoint - if you feel you need one, stop and report why.
- Do not escape text that has already been escaped at `app.js:283`; double-escaping corrupts existing notes.
- Do not move the wikilink pass anywhere except between `app.js:292` and `app.js:293`.
- Do not render wikilinks inside code spans, math, or the share page.
- Do not rebuild the whole link index on every autosave.
- Do not change note titles automatically, add tags automatically, or create a "Daily" folder - daily notes are
  plain notes with a date title, nothing else.
- Do not use `toISOString()` for date keys, and do not use string arithmetic for date math.
- Do not refactor unrelated code or reformat untouched functions. Keep the diff inside `public/`, `test/`, and the
  README.

====