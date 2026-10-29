# Web UI analysis — `public/` front end

- **Task**: task-2 (web-UI analyst, brainstorming team)
- **Scope**: the browser client only: `public/index.html` (217 lines), `public/app.js` (2074 lines / 82.7 KB), `public/style.css` (903 lines / 26.7 KB), `public/manifest.webmanifest` (12 lines).
- **Method**: all four files read end-to-end; the server was consulted (`server.js`) only to verify what the UI's API calls actually store/return, and `README.md` was read to separate claimed features from shipped features. Every claim below carries a `file:line` reference. No existing file was modified.
- **Citation convention**: `public/app.js:1128` = line 1128 of that file; ranges are inclusive. "No such code" claims are backed by a named negative check (grep/list of files).

Effort legend used in §4/§5: **S** ≈ ≤1 day of one developer's focused work inside the existing files; **M** ≈ 2–4 days; **L** ≈ 1–2+ weeks or requires server/data-model changes. "Risk" = chance of regressions or architectural damage, not difficulty.

---

## 1. Feature inventory (what is actually implemented)

### 1.1 Shell, navigation, layout

- Two-pane desktop layout: sidebar (brand, theme toggle, sign-out, **New note**, search box, folder list, tag/folder filter bars, note list, account chip, **Export backup**) at `public/index.html:37-75`; main area with empty state and editor at `public/index.html:78-124`. Layout is CSS flex with a fixed 320 px sidebar: `public/style.css:80-91`.
- Mobile: below 900 px the sidebar becomes an off-canvas drawer with backdrop; a `#menu-btn` is shown only on mobile: `public/style.css:877-899`, `public/index.html:76`, `public/index.html:89`. Drawer open/close is JS class toggling only: `public/app.js:1638-1647`; it auto-closes when a note is selected: `public/app.js:1069`.
- Toast notifications (`public/index.html:215`; `public/app.js:513-519`), generic confirm modal (`public/index.html:204-213`; `public/app.js:521-537`), Escape-to-close for modals (`public/app.js:2014-2019`).

### 1.2 Authentication, accounts, administration

- Combined login / first-run setup / registration view: `public/index.html:18-33`; mode switching and copy: `public/app.js:552-574`; client-side validation: `public/app.js:580-603`; first-run detection via `/api/session`: `public/app.js:2062-2069`.
- 401 handling centralised in the `api()` helper, which drops back to the login screen: `public/app.js:496-509`.
- Account modal: change password (`public/index.html:132-139`; `public/app.js:1718-1737`), sign out everywhere (`public/app.js:1741-1751`), delete own account with password confirmation (`public/index.html:143-153`; `public/app.js:1755-1777`).
- Admin panel: user list with make/remove admin and delete user, plus a "allow new registrations" toggle: `public/index.html:163-173`; `public/app.js:1781-1854`.
- Signed-out public share page route `/share/<32-hex token>`: `public/app.js:2048-2053` and `public/app.js:1949-1981`.

### 1.3 Editor

- Title input (`maxlength=500`, matching the server's 500-char limit) at `public/index.html:90` / `server.js:389`; content `<textarea>` at `public/index.html:115`.
- Write/Preview as two mutually exclusive tabs, not a split view: `public/index.html:93-96`; `public/app.js:1564-1573`.
- Formatting toolbar with 13 buttons (bold, italic, heading, bullet, numbered, task, quote, inline code, code fence, image, attach file, link, table): `public/app.js:1475-1504`, icons at `public/app.js:1270-1284`.
- Tag chips + free-text tag input: `public/index.html:106-110`; add/remove logic: `public/app.js:1219-1266`.
- Folder dropdown inside the editor: `public/index.html:107`; options/assignment: `public/app.js:897-921`.
- Status bar with save state and word/char count: `public/index.html:119-122`; `public/app.js:1073-1082`, `public/app.js:1144-1149`.
- Images and documents upload via toolbar or clipboard paste; images insert `![name](url)`, documents insert `[name](url)`: `public/app.js:1385-1473`; accepted image types `public/app.js:1438`; accepted document extensions `public/app.js:1451`; server cap 25 MB per file: `server.js:39`.
- Preview-only font size control (−/%/+, 12–24 px, persisted): `public/index.html:97-101`; `public/app.js:1985-1998`; persisted value read at `public/app.js:449-452`.
- Interactive task checkboxes in preview: clicking a rendered checkbox rewrites the matching source line, skipping lines inside fenced code: `public/app.js:1583-1627`. This is a real strength worth preserving.
- Smart list continuation on Enter and two-space Tab in the textarea: `public/app.js:1183-1215`.

### 1.4 Markdown renderer

Hand-written renderer, no library: `public/app.js:39-431` (feature contract in the comment at `public/app.js:39-44`).

Implemented: ATX headings h1–h6, bold/italic/strikethrough, inline code, fenced code with optional language class, nested ordered/unordered lists, task list items, blockquotes (recursive), pipe tables, inline links/images, horizontal rules, document-attachment chips, and LaTeX math. Block dispatch order and exact code: display math `public/app.js:322-352`, fences `public/app.js:354-363`, headings `public/app.js:365-371`, rules `public/app.js:373`, blockquotes `public/app.js:375-383`, tables `public/app.js:385-401`, lists `public/app.js:403-414`, paragraph fallback `public/app.js:416-425`. Inline pipeline: `public/app.js:258-294`.

Safety: all text is HTML-escaped before insertion (`public/app.js:47-48`, applied at `public/app.js:281`); math output escapes itself (`public/app.js:113-114`); link/image URLs pass a `safeUrl()` allow-list (`public/app.js:56-61`); raw HTML is therefore not supported by design.

### 1.5 Math engine

Custom LaTeX-subset renderer, not KaTeX/MathJax: `public/app.js:63-247`. Delimiters: `\(…\)` and `$…$` inline, `$$…$$` and `\[…\]` display: `public/app.js:265-280`, `public/app.js:322-352`. Symbol table `public/app.js:70-97`; functions `public/app.js:99-103`; fractions/roots/styles/accents `public/app.js:152-195`; unknown commands are rendered upright instead of dropped (`public/app.js:213`). Styling uses system math fonts, with no vendored font: `public/style.css:562-596`.

### 1.6 Organization: folders, pins, tags

- **Folders are first-class server objects**, not note fields: `db.folders` with `id`, `userId`, `name`, `createdAt`, optional `pinned`: `server.js:631`, `server.js:660`. Stored display order is *array order*, changed by `POST /api/folders/reorder`: `server.js:637-652`; the client reorders optimistically then persists: `public/app.js:664-672`. Pinned folders are sorted first client-side: `public/app.js:659-662`; pin/unpin API `public/app.js:762-774` / `server.js:654-663`. Folder delete never deletes notes — notes are moved to "No folder": `public/app.js:779-801`; `server.js:679-686`. Folder nesting does **not** exist (flat list, no `parentId`).
- **Note pinning is a boolean on the note** (`pinned`), sent on every save: `public/app.js:1108`; toggled at `public/app.js:1508-1515`; the list sorts pinned first then `updatedAt` desc and groups under "Pinned"/"Notes": `public/app.js:931`, `public/app.js:966-975`.
- **Tags are a free-form string array on the note** (`tags`), max 32 chars per tag client-side: `public/app.js:1238`; sanitised server-side by `sanitizeTags`: `server.js:391`. There is no tag registry/rename/merge, and filtering supports exactly one tag at a time: `public/app.js:928`, `public/app.js:1024-1041`.
- Filtering is combined: folder filter then tag filter, then query, all client-side: `public/app.js:925-932`.

### 1.7 Search

Client-side only. The whole note corpus (full content) is fetched once on login (`GET /api/notes` returns every note: `server.js:691-695`; stored in `state.notes` at `public/app.js:626-628`), and filtering is a case-insensitive substring test over `title + content + tags`: `public/app.js:925-932`. Search input is debounced 120 ms: `public/app.js:1015-1022`. There is **no server search endpoint** (`server.js` route list has no search route) and no index.

### 1.8 Autosave & themes

- Debounced autosave (700 ms) with explicit save states: `public/app.js:1122-1129`, `public/app.js:1073-1082`. Manual flush on Ctrl/Cmd+S, note switch, and before delete: `public/app.js:2005-2007`, `public/app.js:1046`, `public/app.js:1520`.
- Theme: light/dark via `data-theme`, localStorage, defaulting to `prefers-color-scheme`: `public/style.css:27-42`, `public/app.js:453-454`, `public/app.js:541-548`, toggle at `public/app.js:1634-1636`; browser chrome color updated at `public/app.js:547`.
- Export: JSON snapshot of the signed-in account's folders + notes, generated client-side: `public/app.js:1649-1658`.

### 1.9 Sharing

Create/rotate and revoke a 128-bit token capability link (`public/index.html:186-201`; `public/app.js:1890-1945`); public read-only page rendered with the same markdown renderer (`public/app.js:1962`), with image/attachment URLs rewritten to carry the share token (`public/app.js:1963-1972`); server side: `server.js:460-466`, `server.js:734-748`.

### 1.10 PWA / offline: manifest only, **no service worker**

- A manifest is declared and linked: `public/manifest.webmanifest:1-12`, `public/index.html:10`. It has `display: standalone` and a single SVG "any" icon (`public/manifest.webmanifest:6`, `:9-11`).
- **There is no service worker.** `public/` contains exactly five files — `app.js`, `icon.svg`, `index.html`, `manifest.webmanifest`, `style.css` (directory listing) — there is no `sw.js`; `index.html:9-12` loads only stylesheet and app script; the string `serviceWorker` appears nowhere in `public/app.js` or `public/index.html` (grep, zero matches). Nothing is cached and nothing works offline.
- Consequently the README claim "Installable as a PWA (add to home screen)" (`README.md:41`) is not backed by the code: without a service worker the browser install/offline path is at best partial, and the manifest declares no 192/512 px PNG icon.

### 1.11 Explicitly absent (verified negative inventory)

No command palette (only Ctrl+K focusing search: `public/app.js:2008-2012`); no app-level undo/redo or revision history; no trash/soft delete (delete is permanent and says so: `public/app.js:1523`, `server.js:725-730`); no import of any kind; no print stylesheet (`public/style.css` has only media queries at `:862`, `:881`, `:901`); no split-pane preview; no outline/TOC; no backlinks/wikilinks/graph; no kanban/board or table view; no bulk selection; no drag reordering of notes (drag exists only for folders: `public/app.js:723-760`); no offline support; no i18n (all strings hardcoded in English, e.g. `public/index.html:21`); no note-level conflict/version metadata.

---

## 2. Editor / interaction model in detail

### 2.1 Runtime architecture

One deferred, self-executing vanilla-JS file, no modules, no build step, no dependencies: `public/app.js:1-2`, `public/index.html:12`. Global mutable `state` (`public/app.js:435-455`) plus a cached DOM map `ui` built by `getElementById` (`public/app.js:457-490`). Renders are imperative `innerHTML = ''` + `append` rebuilds (e.g. note list `public/app.js:958-975`, folders `public/app.js:674-804`). API calls go through `api()` (`public/app.js:496-509`). Init flow: theme first, share-route check, icon/toolbar/upload init, session probe, then `enterApp()` (`public/app.js:2045-2073`).

### 2.2 Autosave model

Effort to describe precisely because several later ideas touch it:

- **Trigger**: every `input`/`change` on title or content, tag changes, pin toggles, folder assignment calls `scheduleSave()` (`public/app.js:1159-1164`, `public/app.js:1174-1180`, `public/app.js:1122-1129`, tag add/remove at `public/app.js:1244`/`:1254`, pin at `public/app.js:1508-1515`, folder at `public/app.js:912-921`).
- **Debounce**: trailing 700 ms timer; each keystroke resets it: `public/app.js:1122-1129`.
- **Save**: `PUT /api/notes/:id` with the *entire* note (title, content, tags, pinned, folderId) — no patch/diff — `public/app.js:1102-1120`; server replaces the whole record and bumps `updatedAt`: `server.js:715-723`.
- **Concurrency**: no request serialisation. `state.saving` is a boolean, not a queue; a save fired while another is in flight can overlap (two PUTs, last response wins). `flushSave()` only flushes the pending timer, not an in-flight request: `public/app.js:1088-1094`; `pendingSave()` does notice `saving` (`public/app.js:1084-1086`), but `selectNote()` awaits only `flushSave()` before it may prune/switch: `public/app.js:1045-1047`.
- **Status UI**: five states driven by one function: `idle` / `pending` ("Unsaved changes") / `saving` ("Saving…") / `saved` ("Saved HH:MM") / `error` ("Save failed — will retry on next edit"): `public/app.js:1073-1082`; dot colors in `public/style.css:610-615`.
- **Failure handling**: a failed save sets the error state and shows a toast, then stops. There is no retry, no backoff, no queue, no `navigator.onLine`/`online` handling (grep: no `visibilitychange`, `pagehide`, `navigator.onLine`, `online` handlers in `public/app.js`): `public/app.js:1115-1119`.
- **Unload protection**: `beforeunload` warns only when `pendingSave()` is true — i.e. a running timer or an in-flight save; if the save has already failed (error state, timer cleared), the guard is silent: `public/app.js:2022-2027` vs `public/app.js:1084-1086`.
- **Empty-note pruning**: leaving a note that has empty title + content + tags silently DELETEs it: `public/app.js:1132-1142`; called on note switch and on new-note creation: `public/app.js:1047`, `public/app.js:1545`.

### 2.3 Save-status states (summary)

| State | Set by | User-visible text | Dot |
|---|---|---|---|
| idle | init (`public/app.js:2061`) | (empty) | grey |
| pending | any edit (`public/app.js:1123`) | "Unsaved changes" | grey |
| saving | start of PUT (`public/app.js:1104`) | "Saving…" | amber |
| saved | PUT success (`public/app.js:1111-1113`) | "Saved 14:32" | green |
| error | PUT failure (`public/app.js:1115-1119`) | "Save failed — will retry on next edit" | red |

### 2.4 Keyboard shortcuts & text-editing behaviors

Implemented globally or locally (all of `public/app.js:2002-2020` unless noted):

| Key | Action | Evidence |
|---|---|---|
| Ctrl/Cmd+S | flush pending save | `public/app.js:2005-2007` |
| Ctrl/Cmd+K | focus + select the search box | `public/app.js:2008-2012` |
| Escape | close confirm/users/account/share modal (in that order) | `public/app.js:2014-2019` |
| Enter (title field) | move focus to content at end | `public/app.js:1166-1172` |
| Tab (content) | insert two spaces | `public/app.js:1188-1194` |
| Enter (content, non-empty list item) | continue list / increment ordered marker | `public/app.js:1196-1214` |
| Enter / comma (tag input) | commit tag; Backspace removes last tag | `public/app.js:1257-1266` |
| Enter / Escape / blur (folder editor) | commit / cancel / commit rename | `public/app.js:833-838` |

Notably absent: Ctrl+B/Ctrl+I formatting, Ctrl+N new note, Ctrl+P quick switch, list up/down navigation, app-level undo/redo (the textarea's native undo is all there is), and any shortcut help overlay. Escape also does not close the mobile sidebar drawer (`public/app.js:2014-2019` has no drawer branch).

### 2.5 Write/Preview mode model

Tabs swap a hidden textarea and a hidden preview div; there is no side-by-side mode: `public/app.js:1564-1573`. Preview HTML is generated only when entering preview mode (`public/app.js:1572`) and after an interactive checkbox toggle (`public/app.js:1625`) — **it is not live while typing** in write mode (no input handler calls `renderPreview`; `public/app.js:1174-1180` only schedules a save). Opening an existing note deliberately lands in **preview**, so editing an existing note always costs one extra click: `public/app.js:1066-1067`; only a brand-new note opens in write mode with the title focused (`public/app.js:1553`).

### 2.6 Responsiveness approach

Single breakpoint at 900 px: drawer sidebar + backdrop, mobile menu button, wrapped editor header, reduced paddings: `public/style.css:881-899`; `.mobile-only` default `display:none` at `public/style.css:879`. Toolbar scrolls horizontally on narrow screens (`public/style.css:457-464`). A second small breakpoint at 700 px only affects the share card (`public/style.css:862-865`). There are no touch gesture handlers anywhere (no swipe/long-press/pull-to-refresh; grep for gesture/`touchstart` yields none).

### 2.7 Markdown renderer architecture and extension points

Two-stage string pipeline, which is why several ideas in §4/§5 are cheap:

1. `render(src)` is a line-oriented dispatcher (`public/app.js:252-428`). First-match wins in this order: display math, code fence, heading, hr, blockquote (recursive `render`), table, list, paragraph. That order is a natural insertion point for new block constructs (callouts, footnotes section, collapsible wrappers).
2. `inline(text)` extracts code spans and math into private-use-area placeholder tokens first (`public/app.js:261-280`), escapes the remaining text once (`public/app.js:281`), then applies images → attachments → links → bold → italic → strike (`public/app.js:282-290`) and finally restores the placeholder tokens (`public/app.js:291-292`) — a clean slot for new inline syntax (wikilinks, hashtags) that must not fight escaping or math.
3. `MD` returns only `{ render }` (`public/app.js:430`); it is state-free and knows nothing about notes — any note-aware syntax (wikilinks) needs either a second argument/context or a post-render DOM pass.

Because everything is escaped first, new syntax handlers must inject only trusted markup, not note text.

### 2.8 Markdown: supported vs unsupported syntax (verified)

Supported: ATX headings `public/app.js:365-371`; bold/italic/strike/code `public/app.js:288-290`; fenced code with language class `public/app.js:354-363`; nested lists and task items `public/app.js:296-315`, `public/app.js:403-414`; blockquotes `public/app.js:375-383`; pipe tables `public/app.js:385-401`; links/images `public/app.js:282-287`; attachment chips for 32-hex `/uploads/` names `public/app.js:53-54`, `public/app.js:284-285`; horizontal rules `public/app.js:373`; math (`public/app.js:265-280`, `:322-352`).

Not supported (each checkable in code):

| Syntax | Why it does not work | Evidence |
|---|---|---|
| Setext headings (`Title` + `===`/`---`) | only ATX headings matched; `---` becomes `<hr>` | `public/app.js:365`, `:373` |
| Raw inline/block HTML (`<kbd>`, `<details>`, `<u>`) | whole text escaped; no HTML pass-through | `public/app.js:281` |
| Reference-style links `[t][id]`, autolinks `<https://…>`, bare-URL linkification | only inline `[t](url)` and `![alt](url)` patterns exist | `public/app.js:282-287` |
| Footnotes `[^1]` | no reference collection pass exists in `render` | `public/app.js:252-428` |
| Callouts/admonitions (`> [!NOTE]`) | blockquote renders inner text literally, no marker handling | `public/app.js:375-383` |
| Wikilinks `[[Note]]` | no such pattern in inline pipeline | `public/app.js:258-294` |
| `#hashtags` in body text | `#` is only special at block start for headings | `public/app.js:365` |
| Frontmatter / YAML block | leading `---` is consumed as a horizontal rule | `public/app.js:373` |
| Table column alignment | separator regex validates `:-:` but alignment is never emitted | `public/app.js:385-398` |
| Escaped pipe inside table cells | rows are split naively on `|` | `public/app.js:387` |
| Image title / sizing attributes | regex captures alt and URL only | `public/app.js:282` |
| Multi-line list-item continuation | list collection takes one line per item; continuation falls out to a paragraph | `public/app.js:403-414`, `:416-425` |
| Ordered list start number (e.g. `5.`) | always emits bare `<ol>` with no `start` attribute | `public/app.js:298` |
| Syntax highlighting inside fences | only a `language-*` class is emitted; stylesheet has no token colors | `public/app.js:361`, `public/style.css:517-525` |
| Mermaid diagrams | fences render as plain code | `public/app.js:354-363` |
| Definition lists | no handler | `public/app.js:252-428` |

These are suitable extension points, not bugs: the renderer is intentionally a safe subset.

### 2.9 Math engine limits

Delimited math works (`public/app.js:265-280`, `:322-352`), but the engine is a token walker, not a TeX engine: `\begin`/`\end` groups are discarded (`public/app.js:196`), `&` becomes a space (`public/app.js:227`), which means aligned/matrix/cases environments have no layout; `\color`, `\tag`, `\label`, `\ref` are skipped (`public/app.js:197-200`); no `\over`, `\ce`, `\cancel`, or macro definitions; unknown commands degrade to upright text (`public/app.js:213`). Rendering relies on Cambria Math/STIX being installed (`public/style.css:563`), so Linux/Android visitors may get fallback serif glyphs.

### 2.10 Search implementation

Already covered in §1.7; the interaction detail that matters: search is applied *after* folder and tag filters (`public/app.js:927-930`), so it is scoped; the query is reset whenever the app is (re-)entered (`public/app.js:630-633`); results render as the same note cards, with no match highlighting and no result count (`public/app.js:958-1005`); an empty result shows "No notes match." (`public/app.js:961-964`). Because the full corpus including content is in memory (`public/app.js:626-628`), search *can* be instant but also means login payload and memory grow linearly with the server's 5,000-note / 1 MB-per-note limits (`server.js:44`, `server.js:390`).

### 2.11 Organization storage model (folders / pins / tags)

| Concept | Where stored | Shape | Client behaviour | Evidence |
|---|---|---|---|---|
| Folder | server `db.folders[]` + per-account fetch | `{id,userId,name,createdAt,pinned?}`; array order = display order | fetched once at login, optimistic reorder/pin | `server.js:613-687`, `public/app.js:626-628`, `public/app.js:654-921` |
| Folder delete | server | notes' `folderId` set to null | client mirrors by nulling `folderId` | `server.js:679-686`, `public/app.js:788-796` |
| Note pin | field on note | `pinned: boolean` | toggled in header, sent on save | `public/app.js:1508-1515`, `public/app.js:1108` |
| Tags | field on note | `tags: string[]`, free-form, 32 chars client cap | chips + autosave | `public/app.js:1235-1254`, `server.js:391` |
| Note sort | derived, not stored | pinned desc, then `updatedAt` desc | no user control | `public/app.js:931`, `server.js:694` |

There is no `order` column for notes and no `deletedAt`/`archived` flag — which is precisely why drag-reordering notes, trash, and revisions are expensive (§4).

### 2.12 Share rendering path

`/share/<token>` is matched client-side before any auth call (`public/app.js:2048-2053`); the page fetches `GET /api/share/:token` which returns only `title`, `content`, `updatedAt` (`server.js:460-466`), renders with `MD.render` (`public/app.js:1962`), and appends `?s=<token>` to upload URLs so the public visitor can load them (`public/app.js:1963-1972`). No theme toggle, print action, copy button, or "open in app" affordance exists on that page.

### 2.13 Theme and typography

CSS custom properties for light/dark (`public/style.css:3-42`); theme persisted in `localStorage` and defaults to system preference (`public/app.js:453-454`); the `theme-color` meta is updated on toggle (`public/app.js:547`). `--font` is a pure system stack including CJK fallbacks (`public/style.css:23-24`); preview body is 15.5 px/1.75 and the textarea is the same (`public/style.css:483-486`, `public/style.css:494-496`); preview font is user-scalable but editor font is not (`public/app.js:1985-1998`). Theme is applied only when the deferred script runs (`public/app.js:2046`), so a dark-theme visitor can see a light flash before JS executes — there is no pre-paint inline theme script, and CSP would forbid one without a hash (`server.js:69-70`).

---

## 3. Verified UX gaps and frictions

Ranked roughly by user pain per unit of fix. Each is traceable to code.

**F1 — No offline support at all, and the PWA claim is hollow.** No service worker, no cache, no online/offline awareness (`public/` file list; zero `serviceWorker` matches; no `online`/`pagehide` handlers in `public/app.js`). Losing connectivity turns every save into the error state with no retry (F2), yet `README.md:41` advertises installability. This is the single biggest credibility/robustness gap.

**F2 — Save failure is a dead end.** Error text promises "will retry on next edit" but nothing retries automatically (`public/app.js:1115-1119`); there is no queue, backoff, or manual retry button. If the user stops typing and closes the tab, `beforeunload` stays silent because `pendingSave()` only checks timer/`saving`, not the error state (`public/app.js:2022-2027`, `public/app.js:1084-1086`). Unsaved work can be lost quietly.

**F3 — No undo, no trash, no versions.** Delete is immediate and explicitly irreversible (`public/app.js:1523`, `public/app.js:1517-1539`, `server.js:725-730`); there is no undo buffer beyond the textarea's native Ctrl+Z, no deleted-notes view, and no revision endpoint (`server.js` has no such routes). A mis-click (delete is a one-tap icon next to pin/share, `public/index.html:103`) is permanent.

**F4 — Save/prompt race on note switching.** `selectNote()` awaits `flushSave()` (only the debounce timer) but not an in-flight save, then calls `pruneIfEmpty()` which can issue a DELETE while a PUT is still in flight (`public/app.js:1045-1047`, `public/app.js:1088-1094`, `public/app.js:1132-1142`). Results range from a spurious "Save failed" toast to a pruned note reappearing/vanishing depending on response order.

**F5 — Opening an existing note always costs a click.** Existing notes open in read-only preview (`public/app.js:1066-1067`); only new notes start in write mode (`public/app.js:1553`). For an edit-heavy diary use case this is a constant tax, and there is no preference to change the default.

**F6 — Search is unscoped, unhighlighted, and does not scale.** Substring match only (`public/app.js:925-932`), no match highlighting, no result count, no operators, and no server-side search — the entire corpus (content included) must be downloaded and held in memory (`public/app.js:626-628`, `server.js:691-695`). At the server's own 5,000-note cap this becomes a slow first paint and heavy memory use, with a full list rebuild on every search keystroke (`public/app.js:958-975`).

**F7 — Tag management is minimal.** One tag filter at a time (`public/app.js:928`), no global tag list or counts, no autocomplete while adding tags (free text, `public/app.js:1235-1246`), no rename/merge/delete of a tag across notes, and tag chips only exist inside the editor — there is no sidebar tag section (the filter bar is hidden until a tag is active, `public/app.js:1030-1041`).

**F8 — No control over note ordering or views.** The list is always pinned-first then last-updated (`public/app.js:931`); no A–Z, created-date, folder grouping, or manual drag. Dragging exists only for folders (`public/app.js:723-760`), and there is no table/compact view, so the sidebar is weak at more than a few hundred notes.

**F9 — No bulk operations.** Note cards select one note on click (`public/app.js:977-1005`); there are no checkboxes, no multi-select, no batch move/tag/delete. Cleaning up a folder is one-note-at-a-time work.

**F10 — Keyboard coverage is thin and unconventional.** Only Ctrl+S, Ctrl+K, Escape (`public/app.js:2002-2020`). No Ctrl+B/I despite a formatting toolbar, no new-note or quick-switch shortcut, no arrow-key navigation of the note list, and Ctrl+K opens a plain search box rather than a command palette (F11 of §4).

**F11 — Mobile drawer has no Escape/gesture affordance.** The 900 px drawer opens via the menu button and closes only via the backdrop or selecting a note (`public/app.js:1638-1647`, `public/app.js:1069`); Escape handling has no drawer branch (`public/app.js:2014-2019`), there are no swipe gestures, and the toolbar relies on horizontal scroll (`public/style.css:457-464`).

**F12 — Accessibility gaps in the two most-used lists.** Note cards and folder rows are `<div>`s with click handlers and no `tabindex`/`role`/keydown support (`public/app.js:682-719`, `public/app.js:977-1005`; zero `tabindex` matches across `public/index.html` + `public/app.js`), so keyboard and screen-reader users cannot select notes or folders. Modals declare `role="dialog" aria-modal="true"` (`public/index.html:129`, `:164`, `:188`, `:205`) but have no focus trap, no `aria-labelledby`, and no focus restore (focus is only pushed to the confirm button, `public/app.js:527`). The save status has no `aria-live` (`public/index.html:119-122`; zero `aria-live` matches). Muted text tokens used at 11–13 px (`public/style.css:11`, `:172-178`, `:265-274`, `:350-361`) compute to roughly 2.4:1 contrast on the light background (`#a1a1aa` on `#f6f6f7`), below WCAG AA for normal text.

**F13 — Upload flow lacks drag-and-drop and feedback.** Files can only arrive through the toolbar pickers or clipboard paste (`public/app.js:1435-1473`); dropping a file on the editor does nothing (no dragover/drop handler around `public/app.js:1435-1473`, only folder drag code exists at `public/app.js:723-760`). There is no upload progress beyond a toast (`public/app.js:1406`), no client-side size/type pre-check (server rejects at `server.js:591-601`), and no way to browse/reuse previously uploaded files even though the server records their metadata (`server.js:605`).

**F14 — You can get data in only by typing; export is JSON only.** Export is a client-generated JSON snapshot (`public/app.js:1649-1658`); there is no import path at all, and no per-note Markdown download, so moving content in from Obsidian/Notion/ENEX or out to a Markdown-based tool is manual work.

**F15 — No print / PDF / save-as-document affordance.** The stylesheet has no `@media print` rules (`public/style.css` media queries only at `:862`, `:881`, `:901`), and the editor chrome (sidebar, toolbar, status bar) is always present, so printing a note prints the whole application UI.

**F16 — Small silent-deletion and double-tab hazards.** Empty notes are pruned without asking on switch (`public/app.js:1132-1142`); opening the same account in two tabs gives two independent `state.notes` copies that overwrite each other on save with no conflict indication (`public/app.js:1102-1120`; no `BroadcastChannel`/storage event exists in `public/app.js`).

---

## 4. Web feature opportunities (20)

These are ranked by value-to-effort for the existing architecture. "Approach" is deliberately specific to a single-file vanilla-JS SPA with no build step, a strict same-origin CSP (`server.js:69-70`: `script-src 'self'; style-src 'self'` — **no CDN scripts, no inline scripts**, vendored files only), a state-free markdown renderer (`public/app.js:46-431`), and a server with no versions/trash/order fields (`server.js:691-748`).

### W1. Command palette + quick note switcher
- **Value**: one keystroke to jump to any note or run any action (new note, toggle theme, export, share, move to folder); the single highest-leverage keyboard feature for a notes app and the natural home for future shortcuts.
- **Approach**: a hidden modal in `index.html` next to the existing confirm modal; reuse the in-memory `state.notes` to fuzzy-match titles/tags; results call existing functions (`selectNote`, `newNote`, `applyTheme`, `setFolderFilter`). Bind Ctrl/Cmd+K — currently "focus search" at `public/app.js:2008-2012` — to open it, and keep a `/`-style focus of the search box inside the palette. Pure DOM work, no server changes.
- **Effort**: M. **Risk**: low (isolated overlay; watch focus handling and Escape ordering against `public/app.js:2014-2019`).

### W2. Wikilinks `[[Note]]` + backlinks panel
- **Value**: turns a flat collection into a connected personal wiki — the most requested feature in this genre, and it enables later graph/outline ideas.
- **Approach**: add one replace step in `inline()` after link handling (`public/app.js:286-287`): match escaped `[[Title]]` / `[[Title|label]]`, emit `<a class="wikilink" data-title="…">` (escape text, keep the href `#` to satisfy `safeUrl`); a delegated click handler resolves the title against `state.notes` (case-insensitive) and selects it or offers "Create note". For backlinks, compute inbound counts by scanning `state.notes` content once on note select and render a "Linked from" section above/below preview in `setMode` (`public/app.js:1564-1573`). No server change.
- **Effort**: S. **Risk**: low-medium (title collisions; must not break math/escaped text; create-note-while-previewing flow needs care).

### W3. Outline / table of contents with heading anchors
- **Value**: long notes (and future daily/journal notes) become navigable; deep links to a section become possible.
- **Approach**: generate slug ids when emitting headings in `render` (`public/app.js:365-371`) and collect a heading list per render; render a collapsible TOC in a thin rail or popover in preview mode, scrolling with `scrollIntoView` in `#preview`. Optionally highlight the current section with an IntersectionObserver (a few lines of native JS) and append the active section to the URL hash on click.
- **Effort**: S. **Risk**: low (renderer-compatible; uniqueness of slugs and re-render on task-toggle need care at `public/app.js:1625`).

### W4. Callouts/admonitions + collapsible sections
- **Value**: readable notes: `> [!NOTE]`, `> [!WARNING]`, `> [!TIP]` style blocks, plus foldable `##`/`###` sections for long documents.
- **Approach**: in the blockquote handler (`public/app.js:375-383`), inspect the first stripped line for `[!TYPE]` before recursion; emit `<div class="callout callout-note">…</div>` and add ~20 lines of CSS. Collapsible sections can be done purely as a preview enhancement: after `MD.render`, wrap heading ranges in `<details>` DOM (not renderer HTML) so the source markdown stays clean; remember to re-apply after interactive-task re-render.
- **Effort**: S (callouts) / M (collapsible). **Risk**: low; callouts are renderer-only, collapsible needs careful DOM bookkeeping.

### W5. Focus mode + typewriter scrolling
- **Value**: distraction-free long-form writing; hides the sidebar, folder/tag chrome, and status bar; optionally keeps the caret line vertically centred.
- **Approach**: a CSS class on `#app` toggled by a button/shortcut that hides `.sidebar` and `.editor-header` extras (CSS-only, `public/style.css:80-91`, `public/style.css:365-384`), persisted in `localStorage`; typewriter scrolling is a `scrollTop` adjustment on the textarea's `input`/selection events (native JS, no dependency).
- **Effort**: S. **Risk**: low (purely presentational; ensure mobile drawer interaction is not broken).

### W6. Split-pane live preview
- **Value**: removes the mode-switch tax described in F5 and makes preview update as you type — the expected default in modern markdown editors.
- **Approach**: CSS grid on `.editor-body` (`public/style.css:474-496`) with textarea and preview side by side and a resize handle; call a debounced `renderPreview()` (~150–250 ms) on the existing content input handler (`public/app.js:1174-1180`) and scroll-sync by percentage (both panes already scroll independently). Keep the tabs as a fallback at ≤900 px, where the panes should collapse to the current behaviour (`public/style.css:881-899`). Guard performance for long notes: the renderer re-parses the entire document each call (`public/app.js:252-428`) and math tokenisation is the expensive part (`public/app.js:109-247`).
- **Effort**: M. **Risk**: medium (long-note typing latency; scroll sync jitter; must not break interactive task checkboxes at `public/app.js:1610-1627`).

### W7. Daily notes / journal
- **Value**: a "Today" entry point makes this a daily driver: one click to open/create the note for today, with date navigation and an optional calendar strip.
- **Approach**: no schema change needed — create through existing `POST /api/notes` (`public/app.js:1547`) with title `YYYY-MM-DD`, optionally `folderId` = a chosen "Journal" folder and an automatic `daily` tag; add a sidebar entry above Folders, a Today button, and prev/next-day buttons. A calendar heatmap can be built from `createdAt`/`updatedAt` already returned by `GET /api/notes`.
- **Effort**: S–M. **Risk**: low (naming collision with user-created notes; timezone handling).

### W8. Templates + slash commands
- **Value**: reusable note skeletons (meeting notes, weekly review, recipe) and in-editor invocation without leaving the keyboard; templates are a common "power user" retention feature.
- **Approach**: store templates as ordinary notes tagged `_template` (zero schema change) or as a `settings.templates` array server-side; the New-note button gains a dropdown listing templates, and creation seeds content before the first save (`public/app.js:1543-1557`). Slash commands: a floating menu rendered from a static command table when the caret is at line start and the user types `/` in the textarea (`public/app.js:1174-1215` currently handles keydown for Enter/Tab); selecting a command runs existing toolbar actions or inserts blocks from `public/app.js:1475-1489`.
- **Effort**: M. **Risk**: medium (caret/menu positioning across mobile, undo interaction with programmatic edits — `applyEdit` at `public/app.js:1287-1296`).

### W9. Table view + sorting + bulk actions
- **Value**: the note list is a fixed-height card stack today (`public/app.js:958-1005`); a sortable table (title, folder, tags, updated, words) with column sorting and multi-select checkboxes makes large vaults manageable and enables batch move/tag/delete.
- **Approach**: a second renderer over `visibleNotes()` (`public/app.js:925-932`) producing a `<table>`; sort state in `state`; bulk actions iterate the existing endpoints per note (delete `public/app.js:1527`, save via `public/app.js:1102-1120`, folder assignment `public/app.js:912-921`) with an `await` loop and a summary toast. Multi-select state is a `Set` in `state`, cleared on filter changes.
- **Effort**: M. **Risk**: medium (no batch endpoint → partial failures; keep delete confirmation and the F3 gap in mind).

### W10. Manual note ordering / drag reordering
- **Value**: lets users curate "top of folder" notes rather than being forced into updated-at order (F8); folder drag already proves the interaction pattern (`public/app.js:723-760`).
- **Approach**: add a numeric `order` field to notes server-side (default `updatedAt`) and sort by it in `GET /api/notes` (`server.js:694`) and `visibleNotes()` (`public/app.js:931`); add a `POST /api/notes/reorder` mirroring the folder endpoint (`server.js:637-652`), then reuse the folder drag code for note cards. This is the smallest server change among the "structural" ideas.
- **Effort**: L (server + client + migration of existing notes). **Risk**: medium (order semantics vs pinned sorting; concurrent edits).

### W11. Kanban board view
- **Value**: a different mental model for tasks/ideas (Backlog / Doing / Done), attractive for project notes; a natural companion to task lists that already render interactively (`public/app.js:1583-1627`).
- **Approach**: add an explicit `status` field (or a reserved tag convention such as `#doing`) and a third view mode that groups `visibleNotes()` into columns; drag-and-drop between columns updates the field and saves via the existing PUT (`public/app.js:1102-1120`). Without a schema field, tag conventions keep it client-only but are hard to rename and confusing in the markdown body.
- **Effort**: L. **Risk**: high (new view + drag semantics + mobile usability; without `status` it is a hack).

### W12. Trash / restore
- **Value**: directly fixes F3's worst consequence — one-tap permanent deletion of a note (`public/index.html:103`, `public/app.js:1517-1539`).
- **Approach**: server must add `deletedAt` to notes, filter them out of `GET /api/notes`, add `POST /api/notes/:id/restore` and an empty-trash endpoint, and keep a retention policy; the UI adds a "Trash" item to the sidebar, a trash list, restore/delete-forever actions, and adjusts delete copy. Client changes are small; the server/data-model work dominates.
- **Effort**: L. **Risk**: medium (data migration of `notes.json`, queries touching `db.notes` at `server.js:691-748`, storage growth).

### W13. Revision history + diff view
- **Value**: recover from accidental overwrites and multi-device races (F4/F16); audit what changed in a note.
- **Approach**: store snapshots server-side on save when content changed, capped (e.g. last 20 revisions / dedupe by hash) and pruned; expose `GET /api/notes/:id/revisions` and `GET …/revisions/:rev`; the editor adds a history drawer listing timestamps with a line-diff render (a compact LCS diff is ~50 lines of vanilla JS) and a restore action that saves the old content as a new revision. `data/notes.json` grows, so cap aggressively.
- **Effort**: L. **Risk**: high (storage growth in the single JSON file, concurrent writes, more API surface).

### W14. Interop: Markdown/ENEX/Obsidian import, Markdown/PDF/print export, web clipper
- **Value**: escape hatch in and out of the tool — the main adoption blocker for a self-hosted notes app (F14/F15).
- **Approach**: import runs entirely client-side and creates notes through the existing `POST /api/notes` loop (`public/app.js:1547`) — `.md` files via `<input type=file multiple>` (S), ENEX XML via `DOMParser` (M), Obsidian vault `.zip` needs a vendored unzip (M/L, CSP-compatible if stored under `public/`); attachments remain the hard part. Markdown export: per-note "Download .md" and an all-notes `.zip` using a small vendored zip writer or plain `.md` + JSON bundle (S). Print/PDF: an `@media print` stylesheet hiding app chrome and showing only `#preview` (S, browser "Save as PDF"); server-side PDF is L. Web clipper: a bookmarklet that opens `…/?clip=<url>` and a tiny client route that fetches/copies the title+URL into a new note (M; CSP and SameSite cookies make direct cross-origin posting awkward, so the navigate-then-create pattern is safer).
- **Effort**: M–L (as split above). **Risk**: medium (import edge cases, large files, attachment references).

### W15. Syntax highlighting for code fences
- **Value**: code notes (the fence renderer already accepts a language tag, `public/app.js:354-363`) become readable.
- **Approach**: fence output already emits `class="language-xx"` (`public/app.js:361`); vendor a small highlighter (or a ~100-line custom tokenizer for common languages) as a separate `public/highlight.js` loaded with a `<script>` tag (CSP `script-src 'self'` allows same-origin files only, `server.js:69-70`) and add token CSS. Must escape note content before highlighting to preserve the current XSS-safe property (`public/app.js:281`). Lazy-load on first note with a fence to keep the initial payload small.
- **Effort**: M. **Risk**: low-medium (bundle size, security of any third-party highlighter, must not regress escaped output).

### W16. Mermaid diagrams
- **Value**: flowcharts/sequence diagrams in notes without leaving the app; high perceived value for technical users.
- **Approach**: vendor Mermaid under `public/` (CDN is impossible under CSP `script-src 'self'`), lazy-load it when a ` ```mermaid ` fence exists, render in a sandboxed container with a strict config (`securityLevel: 'strict'`), and keep the raw code visible as fallback. Costs a large vendored asset (~1 MB) and needs care with the interactive task-selector re-render (`public/app.js:1610-1627`).
- **Effort**: M. **Risk**: medium (bundle size, diagram render security/perf, offline caching interplay with W17).

### W17. Offline-first PWA: service worker + draft queue + self-hosted assets/fonts
- **Value**: closes F1 — the app keeps working (read + write) on flaky mobile networks and is genuinely installable; self-hosted fonts remove dependence on system Cambria Math for formula rendering (`public/style.css:563`).
- **Approach**: add `public/sw.js` (cache-first for the five static assets, network-first for `/api/*` with a cache fallback for notes), register it from `index.html`/`app.js` only on a secure context; add an offline draft store in `localStorage`/IndexedDB written on every debounced save, replayed on `online`; and because the current save path has no retry (F2, `public/app.js:1115-1119`), wire the replay into `saveNote`. Vendor a WOFF2 math font under `public/fonts/` (CSP `default-src 'self'` is compatible) for consistent math; also add proper 192/512 PNG icons + `apple-touch-icon` to make `manifest.webmanifest:9-11` installable.
- **Effort**: L. **Risk**: high (cache invalidation/versioning, offline write conflict semantics, storage quota; naive caching can serve stale app JS after deploys).

### W18. Mobile gestures + drawer/nav polish
- **Value**: fixes F11 — phones are a stated target (`README.md:39`) but navigation is backdrop-only.
- **Approach**: add swipe-left/right on the drawer and editor edge (touchstart/touchmove, no library), Escape/back-button (`popstate`) closes the drawer, sticky quick actions for New note, and a bottom action bar for pin/share/delete on narrow screens; add `overscroll-behavior` and `-webkit-tap-highlight-color` polish. Keep the 900 px breakpoint (`public/style.css:881`).
- **Effort**: M. **Risk**: low-medium (gesture conflicts with text selection; iOS Safari quirks).

### W19. Accessibility + keyboard navigation pass
- **Value**: fixes F12 — keyboard and screen-reader users currently cannot operate the note list, and modals are not focus-managed.
- **Approach**: convert note cards/folder rows into `<button>`/`role="button" tabindex="0"` with Enter/Space handlers and `aria-current` for the active note (`public/app.js:977-1005`, `public/app.js:682-719`); add a focus trap + focus restore + `aria-labelledby` to the four modal backdrops (`public/index.html:129/:164/:188/:205`); mark save status `aria-live="polite"` (`public/index.html:119-122`); add arrow-key list navigation; raise muted contrast tokens (`public/style.css:11`, `:35`). All UI-local.
- **Effort**: M. **Risk**: low (no data impact; regressions limited to focus/modal behavior).

### W20. Graph view
- **Value**: visual map of the vault's link structure; a "wow" feature that makes wikilinks (W2) pay off.
- **Approach**: prerequisite is W2 (edges must exist); compute nodes/edges client-side from `state.notes` + `[[…]]` matches, render on `<canvas>` or SVG with a simple force simulation written in ~100 lines (or a small vendored d3-force build under `public/`, CSP-safe). Scope it as a "local graph" around the current note first — much cheaper than a global graph and more useful.
- **Effort**: L. **Risk**: high (visual clutter/perf at hundreds of notes; pure eye-candy unless links are real).

### Mapping to the requested topic list

The 20 ideas above cover every requested topic: bidirectional links/backlinks (W2), daily notes (W7), templates (W8), outline/TOC (W3), focus mode (W5), slash commands (W8), `[[wiki]]` links (W2), graph view (W20), kanban (W11), table view/sorting (W9), bulk actions (W9), trash (W12), revision history (W13), import/export incl. Markdown/ENEX/Obsidian (W14), print/PDF (W14), web clipper/bookmarklet (W14), command palette (W1), split-pane (W6), collapsible sections (W4), callouts (W4), Mermaid (W16), syntax highlighting (W15), self-hosted fonts + offline SW (W17), accessibility pass (W19), mobile gestures (W18), plus manual ordering (W10) and search improvements (§5 CW6). Search improvements are deliberately treated as a cheap win rather than a separate project.

---

## 5. Cheap wins (the renderer/data model already almost supports these)

These are the ideas where the hard part exists and only wiring is missing. Ordered by leverage. "Why cheap" is the load-bearing argument.

**CW1 — Heading anchors + TOC.** `render()` already parses level and text for every heading (`public/app.js:365-371`); emitting `id="slug"` there and scanning preview DOM afterwards is a dozen lines. No data model, no server. Effort **S**. Unlocks deep links and W3 for free.

**CW2 — Wikilinks + a read-only backlinks strip.** All notes live in `state.notes` in memory (`public/app.js:626-628`), so title resolution and inbound-link scanning are O(n) loops with no API. The inline pipeline has a clean slot after link handling (`public/app.js:286-287`), and escaped text is already safe (`public/app.js:281`). Effort **S** for links, **S** more for backlinks. Graph view then becomes feasible (W20).

**CW3 — Callout/admonition blocks.** The blockquote handler is already recursive (`public/app.js:375-383`); detecting `[!NOTE]` on the first stripped line and swapping `<blockquote>` for `<div class="callout">` is ~15 lines + CSS. Effort **S**.

**CW4 — Clickable `#tags` in rendered notes.** The tag filter machinery already exists (`setTagFilter`, `public/app.js:1024-1041`); a regex pass in `inline()` (after code/math placeholders are restored) can turn `#tag` into a chip whose click calls the existing filter. Note-level `tags` stay unchanged, so no migration. Effort **S**.

**CW5 — Tag autocomplete + global tag list.** Tags are already in memory on every note (`state.notes`), so building a sorted `tag → count` map is trivial; the editor currently takes blind free text (`public/app.js:1235-1246`). A datalist/small suggestion dropdown is **S** and removes the main tag-management friction (F7) without a schema change.

**CW6 — Search operators, match highlighting, result count, saved searches.** Filtering is already a single predicate (`public/app.js:925-932`); adding `tag:`/`folder:`/`title:` prefixes on the parsed query and a `<mark>` highlight pass over the list snippet is **S–M**. No server search needed; this also partially mitigates F6.

**CW7 — Sort selector (updated / created / title / words).** `createdAt` and `updatedAt` already ship with every note from the server (`server.js:705`) and word count is already computed for the status bar (`public/app.js:1144-1149`); the fixed comparator at `public/app.js:931` just needs to read a `state.sort` value. Effort **S** (minus manual order, which is W10).

**CW8 — Focus mode, mono/editor font size, and theme pre-paint.** All three are CSS/localStorage-only: hide chrome via a root class (`public/style.css:80-91`), extend the existing preview-font preference pattern to the textarea (`public/app.js:1985-1998`), and add a tiny blocking `public/theme.js` in `<head>` that sets `data-theme` before first paint (`public/index.html:4-13`; a same-origin script satisfies `script-src 'self'`, `server.js:69-70`). Effort **S**; kills F13 (flash) and improves writing comfort.

**CW9 — Copy button on code blocks.** Fence rendering already knows the language (`public/app.js:354-363`); append a small button element (or renderer-emitted button handled by delegation) and use the existing `copyText()` helper (`public/app.js:1906-1920`). Effort **S**.

**CW10 — Per-note Markdown download + copy-as-markdown.** The data is already in memory and the export code already builds Blobs (`public/app.js:1649-1658`); add a "Download .md" action to the editor actions row and a "Copy markdown" item. Effort **S**; directly reduces F14 lock-in.

**CW11 — Print stylesheet.** A single `@media print` block hiding `.sidebar`, `.editor-header` (except title), `.status-bar`, `.editor-actions`, and showing `#preview` is ~20 lines of CSS and answers F15's "print/PDF" need through the browser's own save-as-PDF. Effort **S**.

**CW12 — Reading time, selection word count, and an "edited just now" ticker.** Word/char count already updates on input (`public/app.js:1144-1149`); adding a reading-time estimate and a `selectionchange` count uses the textarea the app already reads. Effort **S**.

**CW13 — Note-list keyboard access.** Cards are already built element-by-element (`public/app.js:977-1005`); adding `role="button"`, `tabindex="0"`, Enter/Space, `aria-current`, and Up/Down traversal is a localized change that removes the worst F12 gap without touching markup structure or data. Effort **S–M**.

**CW14 — Session-local undo for destructive-ish actions.** Tags, pin, folder moves, and even content snapshots are cheap to keep in an in-memory ring buffer because all state is client-side (`public/app.js:435-455`); a toast with an "Undo" action (pattern already used by `toast()`, `public/app.js:513-519`) can cover tag removal, pin toggle, and folder move. Effort **M**; this is not full trash/versions (W12/W13) but covers the common mis-click at near-zero architecture cost.

### Explicitly *not* cheap (despite looking small)

- **Trash (W12) and revisions (W13)**: the server has no `deletedAt`/revision storage and deletes array entries outright (`server.js:725-730`); these are data-model projects, not UI tweaks.
- **Drag-reorder notes (W10)**: no `order` field exists and the server hard-sorts by pinned/updated (`server.js:691-695`); the folder drag pattern is reusable, but the persistence is not free.
- **Split-pane preview (W6)**: cheap-looking CSS, but the renderer re-parses the whole document on every call (`public/app.js:252-428`) and long documents/math make "live" a performance decision, not a layout decision.
- **Offline-first (W17)**: service-worker shell caching is easy; offline *writes* are not, because the save path has no retry/queue and only a boolean `saving` flag (`public/app.js:1084-1129`). It must be designed together with F2/F4.
- **Any CDN-based enhancement (Mermaid/Prism/fonts)**: blocked by `script-src 'self'; style-src 'self'` (`server.js:69-70`) — everything must be vendored and cache-busted.

---

## 6. README vs. implementation discrepancies worth noting in the brainstorm

| README claim | Actual code | Gap |
|---|---|---|
| "Installable as a PWA (add to home screen)" (`README.md:41`) | manifest only; no service worker anywhere (`public/` file list; no `serviceWorker` in `public/*`) | no offline/install pipeline; manifest also lacks PNG icons (`public/manifest.webmanifest:9-11`) |
| "Markdown notes with live preview" (`README.md:17`) | preview HTML is generated only on mode switch and checkbox toggle (`public/app.js:1572`, `:1625`), not while typing in write mode (`public/app.js:1174-1180`) | "live" is tab-switch-time, not keystroke-time |
| "Full-text search" (`README.md:36`) | client-side substring over title/content/tags of the entire downloaded corpus (`public/app.js:925-932`, `:626-628`); no server search route | fine for small vaults, but no index, no ranking, no highlighting |
| "One-click JSON backup export" (`README.md:40`) | client-generated JSON snapshot (`public/app.js:1649-1658`); no import | not a recoverable backup by itself (README acknowledges the JSON is account-scoped at `README.md:139-140`), and there is no restore path in the UI |

These are accurate-enough marketing copy, but the brainstorm should treat PWA/offline as "not implemented", not "polish it".

---

## 7. Bottom line for the team

The web client is a genuinely well-built small SPA: a safe, extensible hand-rolled markdown+math renderer; solid autosave UX (debounce + five save states + Ctrl+S + unload guard); good folder/pin/share/upload coverage; and a clean no-dependency footprint. Its weaknesses are not in what it renders but in what surrounds the note: **no offline story, no safety net (undo/trash/versions), no linking/outline/TOC, no command palette, no bulk or alternate views, weak search and accessibility, and no import/print path**. The cheapest high-impact batch is CW1–CW13 — roughly a week of work that turns the app into a connected, keyboard-friendly markdown workspace without touching `server.js` or the data model.