# Vibe-coding prompt — timeline notes with LLM-assisted date parsing

Paste everything between the `====` markers into your coding agent.

**What this is.** A third note kind: `timeline`. The note body becomes a horizontally scrolling calendar of dates;
each date holds a list of items; opening the note lands on today. Pasting free text with dates in it sends the text
to MiniMax M3, which structures it into `{date, text}` items that the user previews and confirms. The API key lives
in a server-side config file and never reaches the browser.

**Read this first, it is the load-bearing design decision.** For a timeline note, `note.timeline.items` is the
single source of truth, and `note.content` is a **derived markdown mirror** that the **server** regenerates on every
write. That one choice makes search, export, version history, public share links, conflict detection and the trash
keep working with no changes, because they all already consume `content`. Do not invent a parallel storage format,
and do not let a client send a `content` value for a timeline note and have it stored.

====

## Task

Add a `timeline` note kind to the web app and the server: a date-organised note whose default view is today, scrolls
horizontally between dates, holds a list of items per date, supports adding/editing/moving items directly, and can
ingest pasted text that an LLM (MiniMax M3) parses into dated items for the user to confirm.

## Hard constraints

- **Zero npm dependencies, both sides.** Node standard library only (`fetch` is global in Node >= 18). No bundler,
  no TypeScript, no framework on the web.
- **No inline script, no CDN.** CSP is `script-src 'self'; style-src 'self'`. New browser modules go in `public/`.
- **The API key must never reach a client.** It is read from a config file at startup, used only server-side, never
  returned by any endpoint, never logged, and never included in an error message.
- **Do not break the shipped Android app (v1.19 / versionCode 19).** It does not know about `kind` or `timeline`.
  A write that would silently discard or corrupt a timeline must be refused with a clear error, not accepted.
- **`data/notes.json` is validated by a whitelist in `loadDb`** (`server.js:133-195`, the `db = { ... }` rebuild at
  `server.js:156`). Timeline data lives inside existing `notes[]` entries, so no new top-level collection is needed -
  do not add one.
- **Match the existing code style.** Hand-rolled routing in `handleApi` (`server.js:656`), `sendJson`, `HttpError`,
  `readJson`, explicit `saveDb()`. Pure logic in `lib/*.js` (see `lib/qr.js` for the precedent,
  `server.js:27-35`), covered by `node:test`. Browser-shared pure logic in `public/*.js` following
  `public/links.js` (UMD: `window.NotesLinks` + `module.exports`).
- **Every mutation keeps working with `rev`/409 conflict detection.** Do not bypass it.

## 1. Data model

Add two fields to notes. Both default to absent, which must mean `{ kind: 'markdown', no timeline }` so every
existing note and every existing client is unaffected.

```
note.kind     : 'markdown' | 'timeline'      (absent = 'markdown')
note.timeline : { items: [ TimelineItem ] }  (only on kind === 'timeline')
```

```
TimelineItem = {
  id: string,          // server-generated UUID when absent
  date: string,        // 'YYYY-MM-DD', a real calendar date, local to the user
  text: string,        // 1..4000 chars, plain text (no markdown rendering inside items)
  createdAt: number,   // ms epoch
  updatedAt: number    // ms epoch
}
```

Validation rules, applied on every write (`POST /api/notes`, `PUT /api/notes/:id`, history restore):

- `kind` must be `'markdown'` or `'timeline'`; anything else is a 400 `{error, code: 'invalid_kind'}`.
- Items are capped at **5000 per note**; beyond that, 400 `code: 'too_many_items'`.
- `date` must match `/^\d{4}-\d{2}-\d{2}$/` **and** be a real date (`2026-02-30` is invalid); otherwise 400
  `{error, code: 'invalid_item_date', index}`. Do not silently coerce.
- `text` is trimmed, must be non-empty, and is truncated to 4000 characters (truncate, do not reject).
- `id` is taken when it is a UUID-shaped string and unique within the note; otherwise the server assigns one.
- The derived mirror (`note.content`) is capped at **1 MiB**; if the generated markdown exceeds it, 413
  `code: 'timeline_too_large'`.
- `MAX_NOTES_PER_USER` and the rest of the existing limits are unchanged.

## 2. `lib/timeline.js` - server-side pure module

Create `lib/timeline.js` (stdlib only, exports for `require`):

- `TIMELINE_KIND`, `MAX_ITEMS = 5000`, `MAX_ITEM_TEXT = 4000`, `MAX_MIRROR_BYTES = 1024 * 1024`.
- `isDateKey(s)` -> boolean, valid `YYYY-MM-DD` real date.
- `normalizeTimeline(raw)` -> `{ items }` or throws `HttpError`-compatible errors carrying `status` and `code`
  (the server uses `HttpError` from `server.js:107`; either import a tiny shared error class or return
  `{ok:false, code, message}` and let `server.js` convert - pick one and be consistent).
- `timelineToMarkdown(items)` -> deterministic markdown mirror: dates ascending, `## YYYY-MM-DD` headings, and one
  `- text` bullet per item ordered by `createdAt`; blank line between dates. Escape nothing except newlines inside
  an item's text (collapse to spaces), so the mirror stays valid markdown. This function's output is the contract -
  unit-test it exactly.
- `itemCount(items)`, `datesOf(items)` -> sorted unique date keys.

## 3. Server changes (`server.js`)

### 3.1 `sanitizeNote` and the write handlers

`sanitizeNote` (`server.js:596-601`) currently returns `{title, content, tags, pinned}`. Extend the note write
paths, not `sanitizeNote`'s return shape blindly:

- `POST /api/notes` (`server.js:908-919`): accept `kind` and `timeline`. If `kind === 'timeline'`, normalise the
  items (default `[]`), set `note.content = timelineToMarkdown(items)`, and ignore any client-supplied `content`.
- `PUT /api/notes/:id` (`server.js:921-951`):
  - Read `note.kind` (missing => `'markdown'`).
  - **If the note is `timeline` and the body has no `timeline` field: refuse.** Return
    `409 {error: 'This timeline note can only be edited in the web app', code: 'timeline'}` **without mutating
    anything** and without writing a history entry. This is the Android-app guard: an old client would otherwise
    replace the mirror text and desync it from the items.
  - If the body has `timeline`: normalise it, assign `note.timeline = { items }`, regenerate
    `note.content = timelineToMarkdown(items)`, ignore any `content` in the body.
  - Keep the existing `rev` check, the `deletedAt`/trash check, the `folderId` "only if present" guard, the
    `rev += 1`, `saveDb()` and `appendHistory` ordering exactly as they are.
  - Allow `kind` to be sent on PUT only to **convert markdown -> timeline** (body must then include `timeline`);
    converting timeline -> markdown requires an explicit `kind: 'markdown'` plus a `timeline: null`, and must be
    refused with `409 code: 'timeline'` if the body still carries items. Conversion is rare - do not build UI for it
    beyond the create path.
- `GET /api/notes` and `GET /api/notes/:id` (add the latter if it does not exist) must include `kind` and
  `timeline` for the caller's own notes.

### 3.2 History must round-trip timelines

`historyEntry` (`server.js:248-262`) snapshots `title/content/tags/pinned/folderId`. Add `kind` and, when present,
`timeline` to the snapshot; include them in `GET /api/notes/:id/history/:rev` and apply them on
`POST /api/notes/:id/history/:rev/restore`. Without this, restoring a timeline note silently converts it to a
markdown note made of the mirror. Also update the `rejected` (conflict) entry path so a losing timeline payload is
preserved faithfully (`server.js:939`).

### 3.3 `/api/session` capabilities

Extend `features` (`server.js:664`) with `timeline: true` and `timelineParse: <llm configured ? true : false>`.
The web client uses the latter to decide whether the parse button says "Parse" (LLM) or "Parse (basic)".

### 3.4 Sharing / trash / export

No code changes required - the mirror makes them work. Verify with a test: share a timeline note and assert the
public page contains the date headings.

## 4. Config file and the MiniMax client

### 4.1 `config.json`

- Location: `CONFIG_FILE` env var, else `./config.json` next to `server.js`. Read once at startup, synchronously or
  before `http.createServer`; never re-read per request.
- Tracked example: `config.example.json`. Ignored: `config.json` (add to `.gitignore`). Document `chmod 600`.
- Shape:

```json
{
  "llm": {
    "enabled": true,
    "baseUrl": "https://api.minimax.io/v1",
    "model": "MiniMax-M3",
    "apiKey": "",
    "timeoutMs": 25000,
    "maxInputChars": 20000,
    "maxItemsPerRequest": 200,
    "requestsPerHourPerUser": 30
  }
}
```

- If the file is missing, unparsable, `enabled` is false, or `apiKey` is empty: log one line
  (`LLM parsing disabled - config.json missing or incomplete`) and keep the feature off. **The server must still
  boot.** The timeline itself must still work without the LLM (local fallback parser, see 6.4).
- Never log or return `apiKey`; if you log config for debugging, log `{ enabled, baseUrl, model, hasKey }` only.
- `PUBLIC_BASE_URL`-style env overrides are not needed here; keep it file-based per the requirement.
- Because `deploy/notes.service` runs with `ProtectSystem=strict`, note in `deploy/DEPLOY-ALIYUN.md` that
  `config.json` is read-only to the service and must be copied alongside the app (it lives outside `data/`, so
  `ReadWritePaths` does not need to change).

### 4.2 `lib/llm.js` - the MiniMax client

MiniMax exposes an OpenAI-compatible Chat Completions API. Verified shape (Oct 2026): `POST {baseUrl}/chat/completions`,
`Authorization: Bearer <key>`, body `{model, messages, max_completion_tokens, temperature, thinking}`; response
`{choices: [{message: {content}}], usage, base_resp: {status_code, status_msg}}`. `baseUrl` is
`https://api.minimax.io/v1` internationally; accounts on the mainland platform use the base URL shown in that
platform's console, which is why it is configurable.

Implement:

- `isConfigured()` -> boolean.
- `parseTimelineText({ text, today, weekday })` -> `{ items: [{date, text, guessed}] }`, throwing typed errors
  (`code: 'llm_timeout' | 'llm_failed' | 'llm_unparsable' | 'llm_rate_limited'`).
- Request: `thinking: { type: 'disabled' }` (this is a deterministic extraction task - do not pay for reasoning),
  `temperature: 0.1`, `max_completion_tokens: 2048`, and a hard `AbortController` timeout of `timeoutMs`.
- Prompt contract (system message): you are a date extractor; return **only** a JSON object
  `{"items":[{"date":"YYYY-MM-DD","text":"..."}]}`; no prose, no code fences. Pass `today` and its weekday so
  relative expressions resolve correctly. List the expressions to handle, in both languages: `today/yesterday/the
  day before/今天/昨天/前天`, `last Friday/上周五/星期三`, `Oct 20/10月20日/10月20号/2026年10月20日`, `20/10`,
  `next week`, and bare times like `3pm` (attach the time to the enclosing date's text; never make it a date).
  Rules: split multi-date pastes into separate items; one item per discrete thought; keep the author's wording,
  only trimming and joining wrapped lines; if an item has no determinable date use `today` and set
  `"guessed": true`; never invent dates, never drop text.
- Parse the response defensively: take `choices[0].message.content`, strip ``` fences, slice from the first `{` to
  the last `}`, `JSON.parse` in a try/catch, then validate every item (`date` must be a real date within
  +/- 100 years of `today`; `text` string, truncate to 4000). On any failure throw `llm_unparsable`.
- Check `base_resp.status_code !== 0` and treat it as `llm_failed` with `base_resp.status_msg` (message only -
  never the request body, never the key).
- Also honour an upstream HTTP 429 as `llm_rate_limited`.

### 4.3 `POST /api/timeline/parse`

- Auth: session required (the global auth gate already covers it).
- Body limit: `readBody(req, 64 * 1024)`; reject `text` over `maxInputChars` with 413
  `code: 'input_too_large'`.
- Body: `{ text: string, today: 'YYYY-MM-DD' }`. Validate `today` with `isDateKey`; if absent or invalid, use the
  server's local date. Derive the weekday from it.
- Responses: `200 {items, model}`; `503 {code: 'llm_not_configured'}`; `429 {code: 'too_many_requests',
  retryAfter}`; `504 {code: 'llm_timeout'}`; `502 {code: 'llm_failed' | 'llm_unparsable'}`. Map errors with a
  single helper; never echo upstream text verbatim if it could contain the key.
- Per-user rate limit: in-memory sliding window, `requestsPerHourPerUser` (default 30), keyed by user id. Also a
  global in-flight cap of 2; beyond that return 503 `code: 'busy'`. In-memory is fine - state that it resets on
  restart, consistent with the existing login throttles.
- Log one line per call: `user, itemCount, ms, ok` - never the text.

## 5. Browser pure module `public/timeline.js`

UMD like `public/links.js` (sets `window.NotesTimeline`, plus `module.exports` for `node:test`). **Reuse**
`NotesLinks.localDateKey` / `parseDateKey` / `addDays` (already exported by `public/links.js` from the
wikilinks/daily-notes work) instead of duplicating date math; `timeline.js` may be required in tests without the
other module by taking those as arguments - design the signatures accordingly.

Exports:

- `sortItems(items)` -> by `date` ascending, then `createdAt`.
- `groupByDate(items)` -> array of `{ date, items }`, dates ascending.
- `pageDates(items, today, visited)` -> sorted unique union of item dates, `today`, and every date in `visited`.
- `visiblePages(dates, index, radius = 2)` -> `[{date, placeholder: bool}]` over the whole `dates` array, so the
  scroller can keep geometry while rendering only `index ± radius`.
- `makeItem(date, text, now)` -> item with a temporary `id: 'tmp:' + random`, `createdAt/updatedAt = now`.
- `updateItemText(items, id, text)`, `moveItem(items, id, date)`, `removeItem(items, id)` -> new arrays, no mutation.
- `mergeParsed(existing, incoming)` -> appends incoming items, skipping an incoming item when an existing item has
  the same `date` and the same whitespace-normalised text (so a double-confirm or a retry cannot duplicate).
- `parseFallback(text, today, addDays)` -> deterministic local parser used when the LLM is unavailable: one item per
  non-empty line; a leading `YYYY-MM-DD`, `M/D`, `M月D日`, `今天/昨天/前天`, or `星期X`/`周X` selects the date;
  otherwise the current `today`; strips the matched date token from the text. Never returns zero items for
  non-empty input.
- `summarize(items)` -> `{ total, dates, first, last }` for the header.

Add `test/timeline.test.js` covering every exported function, including: an empty paste, a paste with no dates,
a paste mixing Chinese and ISO dates, the same date twice, `mergeParsed` idempotency, `visiblePages` at the first
and last index, and `localDateKey`-style local-date handling (no UTC drift).

## 6. Web UI

### 6.1 Markup (`public/index.html`)

- Load the module before `app.js`: `<script src="/timeline.js" defer></script>` next to the existing
  `/links.js` line (both `defer`, order preserved).
- In the sidebar, next to the existing `#today-btn` (`index.html:47-50`), add a compact
  `<button class="new-note-btn ghost" id="new-timeline-btn">` labelled "Timeline".
- In `.editor-body` (`index.html:127-130`), add a third sibling after `#preview`:

```html
<div id="timeline" class="timeline hidden">
  <div class="tl-bar">
    <button class="icon-btn" id="tl-prev" type="button" aria-label="Previous date"></button>
    <button class="tl-date" id="tl-date" type="button" title="Jump to a date"></button>
    <button class="icon-btn" id="tl-next" type="button" aria-label="Next date"></button>
    <button class="btn sm" id="tl-today" type="button">Today</button>
    <button class="btn sm" id="tl-parse" type="button">Paste &amp; parse</button>
    <input type="date" id="tl-jump" class="tl-jump" aria-label="Jump to date">
  </div>
  <div class="tl-scroller" id="tl-scroller" tabindex="0" aria-label="Timeline dates"></div>
</div>
```

- Add a modal `#tl-parse-modal` following the existing `.modal-backdrop` + `role="dialog"` pattern: a textarea, a
  privacy note ("Your text is sent to MiniMax to extract dates. Nothing else from this note is sent."), a
  "Parse" button, a results list grouped by date with per-item checkboxes and an editable date input, and an
  "Add N items" confirm.

### 6.2 Rendering rules

- `selectNote` (`public/app.js:1159`): if `note.kind === 'timeline'`, hide `#note-content`, `#preview`, the
  Write/Preview segmented control, the font control and the markdown toolbar; show `#timeline`; render it and
  scroll to today. Otherwise restore the current behaviour exactly.
- `saveNote` (`public/app.js:1219`): when the note is a timeline, send `kind` and `timeline` (never rely on
  `content`); on success copy back the server's `note.content` mirror and the normalised `timeline` so ids stay
  stable. Conflict handling stays as it is: a 409 opens the existing conflict modal; after "keep theirs" the
  timeline must re-render from the server note.
- Any item mutation (`add`, `edit`, `delete`, `move`) updates `note.timeline.items` in memory, re-renders the
  affected page, and calls `scheduleSave()` (`app.js:1265`).
- Note list cards get a small "timeline" badge when `kind === 'timeline'` (one `<span class="kind-badge">`).

### 6.3 Horizontal date scroller

- `#tl-scroller`: `display: flex; overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain`.
  Every page is `flex: 0 0 100%; scroll-snap-align: center`.
- Page set from `NotesTimeline.pageDates(items, today, visited)`. Render `index ± 2`; every other page becomes an
  empty spacer `<div class="tl-page tl-placeholder">` with a faint "N items on this date" label (or just the date).
  Render placeholders from `visiblePages`, not by appending everything.
- On open, and on "Today", scroll to today's index with `scrollIntoView({inline: 'center'})` (no smooth scroll on
  first paint, smooth for button navigation).
- `‹` / `›` move one calendar day via `addDays` (a day with no items becomes an empty page you can add to); the
  date input jumps. Keyboard: Left/Right when the scroller has focus; `t` for Today.
- Page contents: a header (weekday + date, item count), then the items as `<article class="tl-item">` rows, each
  with the text, a relative time, and Edit / Move / Delete actions. At the bottom, a compact add field:
  textarea + Add button; Enter adds, Shift+Enter inserts a newline; the new item inherits the page's date.
- Editing an item swaps the row for a textarea with Save/Cancel; Escape cancels.
- Empty timeline: centred hint "No items yet — use Paste & parse, or add one below." with today's page ready.

### 6.4 Paste & parse flow

- `#tl-parse` opens the modal. If `state.features.timelineParse` is false, change the button label to
  "Paste & parse (basic)" and, on Parse, call `NotesTimeline.parseFallback(text, today, ...)` locally - no network.
  Also fall back to it when the request returns `502/503/504`, with a one-line notice in the modal
  ("Couldn't reach the AI service — used basic parsing"). Never lose the pasted text: keep it in the textarea on
  failure.
- On success, render the parsed items grouped by date, all checked, with an editable date per row; confirming calls
  `mergeParsed` into the note's items and saves. Show the count on the confirm button.
- On `429`, show "Too many parses this hour — try again later." and keep the modal open.

### 6.5 Styling and accessibility

Add a coherent block to `public/style.css` using the existing CSS custom properties (`:root` at
`public/style.css:3-25` plus the dark-theme block): `.timeline`, `.tl-bar`, `.tl-date`, `.tl-scroller`, `.tl-page`,
`.tl-placeholder`, `.tl-item`, `.tl-item-actions`, `.tl-add`, `.tl-jump`, `.kind-badge`, and the parse modal's
result rows. Pages must be readable at 360 px wide: the bar wraps, items are full width, actions are icon buttons
with `aria-label`s and 44 px touch targets. Keep focus rings; the scroller is keyboard-scrollable and its pages are
not focus traps.

## 7. Android

Do not build the timeline UI. Do only this:

- In the note list, do not crash or misrender a note whose `kind` is `timeline` - it will simply show the derived
  markdown `content` (that is the intended, readable fallback).
- Make a failed write to a timeline note show the server's message instead of a generic error: the server returns
  `409 {code: 'timeline'}`; ensure the existing error path surfaces `ApiException.message` (it already prefers the
  server's `error` string - verify, and if the message is swallowed, surface it).
- Do not bump `versionCode` for this; leave the Android build alone otherwise.

## 8. Tests

**Server** (`node --test`, extend `test/helpers.js` usage; the harness already spawns a server against a temp
`DATA_DIR`):

1. Create a timeline note with two items across two dates; assert the response echo has ids, sorted dates, and that
   `content` equals the exact markdown mirror (assert the string, do not just `includes`).
2. `PUT` with a stale `rev` -> 409 conflict, and the timeline is unchanged.
3. `PUT` a timeline note **without** `timeline` -> `409 code: 'timeline'`, and `note.content` unchanged (this is the
   Android-app protection).
4. Invalid date (`2026-02-30`), non-string text, > 5000 items -> the documented 400 codes.
5. History: after two timeline edits, the history entry carries `kind` and `timeline`; restoring an older revision
   restores the items, not just the mirror.
6. Trash + restore a timeline note; share it and assert `GET /api/share/:token` content contains the date heading.
7. `/api/session` advertises `timeline: true` and `timelineParse` matching config presence.
8. Parse endpoint: with no config -> 503. With a config whose `baseUrl` points at a **local mock HTTP server**
   started inside the test, returning canned MiniMax-shaped JSON -> 200 with the expected items. Malformed content
   -> 502 `llm_unparsable`. Mock that sleeps past `timeoutMs` -> 504. Oversized `text` -> 413. Exceeding
   `requestsPerHourPerUser` -> 429.
9. `lib/timeline.js` unit tests for `isDateKey`, `normalizeTimeline`, `timelineToMarkdown` determinism.

**Browser pure module**: `test/timeline.test.js` as specified in section 5.

Run `node --test` - all existing suites (`compat`, `conflicts`, `daily`, `history`, `links`, `qr`, `retention`,
`share-head`, `trash`) must still pass.

## 9. Docs

- `README.md`: add "Timeline notes" to Features (one short paragraph: horizontal dates, defaults to today, paste to
  parse); add a "Note types" subsection; add a `config.json` section with the example, the `chmod 600` note, and an
  explicit privacy sentence: *when you use Paste & parse, the pasted text is sent to MiniMax; nothing else from the
  note is sent*; document the per-hour limit and that the feature degrades to basic parsing without a key.
- `config.example.json` committed; `config.json` added to `.gitignore`; `.gitignore` also picks up
  `config.*.json` local variants.
- `deploy/DEPLOY-ALIYUN.md`: one sentence in the deploy steps about copying `config.json` and keeping it `0600`.
- `server.js` header comment: add `CONFIG_FILE` to the environment-variable list at the top.

## Definition of done

- `node --test` passes, including the two new test files and all nine existing suites.
- Manual: create a timeline note; it opens on today; scroll left/right between dates; add an item to today; jump to
  another date and add one there; edit and delete an item; kill and reopen the page and everything persists;
  a second browser tab editing the same note produces the existing conflict dialog.
- Manual: paste five lines mixing `2026-10-24`, `昨天`, `10月20日` and a dateless line; confirm the parsed items land
  on the right dates and the dateless one is flagged as guessed; confirm nothing was dropped.
- Manual: with `config.json` removed, the server still starts, the timeline works, and the parse button falls back to
  basic parsing with a notice.
- Manual: the public share link for a timeline note renders readable date sections.
- Manual: the Android app opens the timeline note read-only-ish and, if it tries to save, shows the server's
  "can only be edited in the web app" message rather than corrupting it.
- No dependency added; no inline script; the API key appears in no response, log line, or client bundle.

## Do not

- Do not store timeline data in `note.content` as JSON. `content` is a derived mirror only.
- Do not add a new top-level `db` collection (it would be dropped by `loadDb`'s whitelist).
- Do not let a client-supplied `content` overwrite the mirror of a timeline note.
- Do not silently accept a timeline write from a client that does not send `timeline`.
- Do not log, return, or embed the API key anywhere; do not put it in a query string.
- Do not call the LLM on every keystroke or autosave - only from the explicit parse endpoint, behind the rate limit.
- Do not send the note's existing content or any other note to the LLM - only the pasted text.
- Do not block the event loop: no `execSync`, no synchronous HTTP; use `fetch` with `AbortController`.
- Do not add `upgrade-insecure-requests`, a bundler, a framework, or any dependency.
- Do not change the existing markdown editor, the wikilinks/daily-notes behaviour, or the sharing path.
- Do not refactor unrelated code. Keep the diff in `server.js`, `lib/`, `public/`, `test/`, `config.example.json`,
  `deploy/DEPLOY-ALIYUN.md`, `README.md`, `.gitignore`.

====