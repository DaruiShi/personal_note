# Android client analysis — Funshare Notes (v1.16)

Scope: `android-app/` — Kotlin + Jetpack Compose native client for the self-hosted
notes server (`server.js`), plus the web client (`public/`) and server routes for
parity comparison. Every claim below is traceable to a file and line range; paths
are relative to the repo root.

Method: full read of all 23 Kotlin/XML sources, both Gradle files, the manifest,
README, all five test classes, `public/app.js` / `public/index.html` /
`public/manifest.webmanifest`, and the `server.js` handlers the app calls.
Line numbers refer to the files as they exist in this tree.

---

## 0. TL;DR

- The client is a **single-Activity, single-ViewModel Compose app** (~5,250 lines
  of Kotlin main + ~540 lines of tests) with **no** navigation library, DI,
  database, repository layer or Flow — state is `mutableStateOf` inside one
  `AndroidViewModel` (`AppViewModel.kt:41-104`), history is a `List<Screen>`
  back stack (`AppViewModel.kt:17-23, 47, 150-160`).
- Feature coverage is **genuinely high** for a one-person project: CRUD, folders
  with pin + reorder, tag filter, client-side search, autosave with offline
  drafts, image/document upload, Markdown preview with tables/task lists/LaTeX,
  public share links, account management, admin panel, JSON export.
- It is **ahead of the web app** in four places: persistent note cache + local
  drafts, folder display on note cards, native attachment download/open, and
  three-way theme control.
- It is **behind the web app** in: word count, four editor toolbar buttons
  (ordered list, code block, link, table), GFM strikethrough rendering, share-link
  *state* (it re-rotates the token every time), "reopen last note", and folder
  drag-and-drop (android uses up/down buttons).
- Neither client has version history, trash/restore, backlinks, bulk operations,
  delta sync, or conflict detection — those are **server-side** gaps, and they
  bound what the Android app can safely become (see §6 ideas 14/15).
- **Four real defects** were found in the client layer, all cheap to fix:
  offline edits to *existing* notes are silently dropped on next sync (§3.6-B1);
  the session cookie is attached to *any* host, including third-party image
  URLs rendered in preview (§3.6-B2); cached notes survive sign-out-by-401 and
  can bleed into another account's first screen (§3.6-B3); and an existing share
  link can never be displayed, only rotated (§3.6-B4).
- **Security/repo hygiene risk, flagged as requested:** the release signing
  keystore **and its password** are in the tree (`android-app/keystore/
  funshare-release.jks`, `app/build.gradle.kts:20-27`,
  `android-app/README.md:124-125`), and
  **17 signed APKs (~188 MB)** are in the tree. `.gitignore` excludes only
  `data/` and OS noise, so any `git add -A` publishes the signing identity. See
  §5.2.
- Android auto-backup is **on with no rules** (`AndroidManifest.xml:9`), so
  the room-temperature session cookie and the entire cached note corpus are
  eligible for Google/D2D backup (§5.4).
- Roughly **a dozen platform capabilities are unused** — share-in target,
  widget, QS tile, notifications, WorkManager, app shortcuts, biometric lock,
  deep links, camera, OCR, per-app language — each is a mobile-native win the
  web client cannot replicate (§4, §6).

---

## 1. The app in numbers and architecture

### 1.1 Size and layout

| Area | Files | Lines (approx.) | Notes |
| --- | --- | --- | --- |
| Data/API core | `Api.kt` 376, `AppViewModel.kt` 817, `Store.kt` 117, `Models.kt` 71, `Folders.kt` 47, `NotesApp.kt` 13 | ~1,441 | no repository, no DI |
| UI | `EditScreen.kt` 925, `NotesScreen.kt` 886, `SettingsScreen.kt` 521, `LoginScreen.kt` 304, `AdminScreen.kt` 232, `Images.kt` 261, `Theme.kt` 164, `Latex.kt` 139, `Design.kt` 137, `Common.kt` 82, `TaskTap.kt` 71 | ~3,722 | Compose + one AndroidView interop |
| Root | `MainActivity.kt` 94 | 94 | edge-to-edge, animated screen switch |
| Tests | 5 classes + fixture | ~542 | Robolectric/JUnit, no instrumentation |
| Resources | 7 XML files | ~49 | only `app_name` is a string resource |

Dependencies (`app/build.gradle.kts:62-87`): core-ktx, activity-compose,
Compose BOM 2024.10.01 + material3 + icons-extended, lifecycle, coroutines,
OkHttp 4.12, Markwon 4.6.2 (core, tables, tasklist, image), JLatexMath,
ExifInterface, JUnit/Robolectric/Compose-test. **No** WorkManager, Room, DataStore,
Navigation, Coil, Biometric, AppCompat, Play Services or Firebase.

### 1.2 Architecture as built

- **Entry point:** `MainActivity.onCreate` calls `enableEdgeToEdge()` then
  `setContent { FunshareTheme(vm.themeMode) { AppRoot(vm) } }`
  (`MainActivity.kt:36-45`). Edge-to-edge is **already adopted**.
- **Navigation:** hand-rolled. `sealed interface Screen { Login, Notes, Edit,
  Settings, Admin }` (`AppViewModel.kt:17-23`); the last element of
  `backStack: List<Screen>` is rendered by an `AnimatedContent` crossfade+slide
  (`MainActivity.kt:70-85`). Screens call `vm.navigate` / `vm.back`; there is no
  deep-link or argument-carrying route model (editor identity lives in
  `editingId`, `AppViewModel.kt:81-88`).
- **State:** Compose `mutableStateOf` fields on the ViewModel with `private set`;
  screens mutate through methods. No `StateFlow`, no `SavedStateHandle`, no
  process-death restoration for navigation or the open editor.
- **Persistence:** a `SharedPreferences` wrapper, `Store` (`Store.kt:11-117`),
  holding server URL, trust-all flag, theme, preview font scale, share link
  base, session cookie, cached user, cached notes, pending drafts. Notes are
  serialized as raw JSON (`Store.kt:101-116`), not a database.
- **Networking:** `Api` (`Api.kt:42-340`) wraps OkHttp with a persisted
  `CookieJar`, JSON-object helpers, and `ApiError(status, message)`.
- **Rendering:** Markwon inside an `AndroidView` (`EditScreen.kt:834-911`); a
  cached Markwon instance is keyed by client/base URLs/latex size/colour
  (`EditScreen.kt:96-132`). LaTeX is preprocessed into `latex://` image URIs and
  drawn by JLatexMath (`Latex.kt:71-139`).
- **Images:** decode → downscale to ≤2048 px → JPEG q82 → `POST /api/uploads`;
  small GIF/WebP pass through (`Images.kt:40-69`).

### 1.3 Feature inventory (Android)

| Area | Implemented behaviour | Evidence |
| --- | --- | --- |
| Auth | sign in, register, first-run admin setup hint, server probe with debounce, trust-all-cert switch | `LoginScreen.kt:78-84, 137-163, 251-300`; `AppViewModel.kt:170-230` |
| Session | cookie persisted across restarts; silent re-auth at boot; 401 → login screen | `Api.kt:349-376`; `AppViewModel.kt:112-142` |
| Notes list | big-title header, count/subtitle, FAB "New", cards with pin/time/snippet/folder/tags, pinned-first + updatedAt sort, staggered animateItem, long-press action sheet | `NotesScreen.kt:159-302, 786-886`; `AppViewModel.kt:508-509` |
| Search | always-visible pill, case-insensitive substring over title/content/tags, client-side only | `NotesScreen.kt:236-243, 646-695, 118-135` |
| Folders | drawer with All/Unfiled/folder counts, create, rename, delete (notes unfiled), pin-to-top, up/down reorder, scrollable list, one-step "create and move" | `NotesScreen.kt:462-643`; `AppViewModel.kt:331-485`; `Folders.kt:14-47` |
| Editor | flat title + content fields, tag chips + add dialog, pin, folder, delete; 10-button Markdown toolbar; character-level `TextFieldValue` for selection-aware inserts | `EditScreen.kt:424-580`; helpers `136-191` |
| Markdown preview | preview/edit toggle; Markwon tables, task lists, images, links; LaTeX in 4 delimiters; tappable task checkboxes that flip source and autosave | `EditScreen.kt:392-422, 834-911`; `TaskTap.kt:22-68`; `Common.kt:58-82` |
| Autosave | 1.2 s debounce; floating status pill Idle/Saving/Saved(hh:mm)/Pending; save on navigate/back | `AppViewModel.kt:573-589, 611-651`; `EditScreen.kt:801-832` |
| Offline | cached list renders at boot; edit failure parks a draft; banner in list; drafts pushed on next refresh | `AppViewModel.kt:59, 112-136, 295-320, 653-668`; `NotesScreen.kt:716-742` |
| Uploads | system photo picker, clipboard-image banner, document picker (PDF/Office/ODF/text/ZIP), 25 MB guard, CJK-safe `X-File-Name` | `EditScreen.kt:234-315, 196-212`; `Images.kt:24-100`; `Api.kt:35-36, 249-266` |
| Attachment open | preview link → authenticated download to cache → FileProvider → external viewer | `Images.kt:213-261`; `file_paths.xml` |
| Preview URL policy | images resolve to the direct server base, document links to the public base; stored markdown untouched | `Images.kt:160-181`; `EditScreen.kt:408-420` |
| Sharing | POST share (creates/rotates token), Android chooser, copy link, revoke | `EditScreen.kt:644-719`; `AppViewModel.kt:694-734`; `Api.kt:269-291` |
| Settings | account card + avatar, change password, sign out, sign out everywhere, server address, share base, trust-all, theme segmented control, preview text size (4 presets), JSON export, delete account, version label | `SettingsScreen.kt:70-345` |
| Admin | user list with avatars/counts/join date, promote/demote, delete, registration toggle | `AdminScreen.kt:49-232`; `Api.kt:295-322` |
| Design | fixed indigo/violet scheme light+dark, brand gradient, pastel tag palette, initials avatars, 20 dp cards, pills | `Theme.kt:21-164`; `Design.kt:26-137` |

---

## 2. Web ↔ Android parity

Status legend: **P** present · **~** partial · **M** missing. "Evidence" gives the
web implementation and the Android counterpart.

| # | Web feature (evidence) | Android | Evidence / notes |
| --- | --- | --- | --- |
| 1 | Email-less username/password auth, register + first-run setup (`app.js:552-620`) | **P** | `LoginScreen.kt:251-300`; setup hint `144-150` |
| 2 | Note CRUD, autosave, save-status indicator (`app.js:1084-1130`) | **P** | `AppViewModel.kt:573-651`; 1.2 s vs web's debounce (`app.js:1122`) |
| 3 | Explicit save shortcut `Ctrl+S` (`app.js:2005-2007`) | **M** | no shortcut; autosave + save-on-back only (`AppViewModel.kt:583-589`) |
| 4 | Word/char count (`app.js:1144-1149`, `index.html:121`) | **M** | no word count anywhere in `EditScreen.kt` |
| 5 | Markdown: headings, bold/italic, **strikethrough**, code, fences, nested lists, order lists, tasks, quotes, tables, links, images, HR (`app.js:40-44, 288-290`) | **~** | tables/tasks/images via plugins (`EditScreen.kt:111-121`); `~~strike~~` has no Markwon strikethrough extension in deps (`app/build.gradle.kts:74-78`) |
| 6 | Toolbar: bold, italic, H, bullet, **ordered**, task, quote, inline code, **fence**, image, attach, **link**, **table** (`app.js:1475-1489`) | **~** | Android has image, attach, bold, italic, H, bullet, task, quote, inline code, divider (`EditScreen.kt:501-535`); missing ordered list, code fence, link, table; adds divider |
| 7 | LaTeX math in 4 delimiters (`app.js:109-247`) | **P** | `Latex.kt:25-35, 71-106`; JLatexMath rendering is *better* than the web's hand-rolled subset |
| 8 | Tappable task checkboxes in preview, fence-aware (`app.js:1583-1627`) | **P** | `TaskTap.kt`; `Common.kt:58-82`; covered by `TaskTapTest`, `PreviewTaskTapTest` |
| 9 | Write/Preview tab switch (`app.js:1564-1573`) | **P** | icon toggle `EditScreen.kt:336-341`; preview is a mode of the editor, not a separate pane |
| 10 | Preview font size ±1 px, persisted (`app.js:1985-1998`) | **~** | 4 fixed presets (0.85/1/1.2/1.4) in `SettingsScreen.kt:266-275`, applied at `EditScreen.kt:400-415` |
| 11 | Tags: add/remove, filter chips, per-note mini-tags that are clickable to filter (`app.js:1219-1260, 994-999, 1024-1043`) | **~** | add/remove + filter chips (`EditScreen.kt:453-486`; `NotesScreen.kt:247-269`); tags on note cards are rendered but inert (`TagChip(tag = tag)` with no `onClick`, `NotesScreen.kt:874`; `Design.kt:61`) |
| 12 | Pinned notes sorted first; pinned/other group headers (`app.js:958-975`) | **~** | sorted first (`AppViewModel.kt:508-509`) but no group headers; pin only from the editor (the long-press sheet offers Move/Delete only, `NotesScreen.kt:323-341`; web also pins from the editor, `app.js:1508-1515`) |
| 13 | Search `Ctrl+K`, debounced client filter (`app.js:1015-1022, 2008-2011`) | **~** | always-visible pill, no shortcut, no debounce (`NotesScreen.kt:646-695`); filters the cached list only |
| 14 | Folder drawer, create/rename/delete, **drag-and-drop reorder**, pin (`app.js:674-871, 664-668`) | **~** | drawer + counts + pin + up/down reorder (`NotesScreen.kt:462-575, 369-451`); drag-and-drop replaced by buttons |
| 15 | Folder assignment from editor `<select>`; folder filter bar (`app.js:897-921, 880-895`) | **~** | move dialog from editor or long-press (`NotesScreen.kt:581-643`), no filter bar (drawer selection instead) |
| 16 | Folder shown on note rows | **M on web / P on Android** | web `noteItem` omits folder (`app.js:977-1004`); Android shows it (`NotesScreen.kt:841-866`) |
| 17 | Upload images: toolbar, multi-file, paste screenshot, drag-drop (`app.js:1385-1473`) | **~** | picker + clipboard banner (`EditScreen.kt:258-315`); no drag-drop (irrelevant), no multi-select |
| 18 | Attach documents, chips in preview with `download` (`app.js:284-285, 1449-1461`) | **~** | upload + `[name](/uploads/…)` link; tap downloads and opens a viewer (`Images.kt:213-261`), no chip styling |
| 19 | Public share: create, copy, revoke, read-only `/share/<token>` page (`app.js:1858-1980, 2049-2052`) | **~** | create/rotate + chooser + copy + revoke (`EditScreen.kt:644-719`); **cannot display an existing link**, cannot open a share link in-app (no deep links) |
| 20 | JSON backup export (`app.js:1649-1657`) | **P** | system file picker export (`SettingsScreen.kt:82-97`) |
| 21 | Admin: users, promote/demote, delete, registration toggle (`app.js:1782-1852`) | **P** | `AdminScreen.kt`; `Api.kt:295-322` |
| 22 | Account: password, sign out, sign out everywhere, delete (`app.js:1720-1775`) | **P** | `SettingsScreen.kt:312-345, 169-193`; `AppViewModel.kt:232-291` |
| 23 | Theme toggle, follows system initially (`app.js:541-550, 1634-1636`) | **P+** | 3-way System/Light/Dark (`Theme.kt:148-164`; `SettingsScreen.kt:248-259`) |
| 24 | Offline read + write | **P on Android only** | web has no service worker (`public/` has no `sw.js`; only a manifest); Android has cache + drafts (`Store.kt:69-77`) |
| 25 | Reopen last note on load (`app.js:641`) | **M** | boot always lands on the list (`AppViewModel.kt:112-136`) |
| 26 | Server address configurable | **P on Android only** | web is same-origin; Android `Store.serverUrl` (`Store.kt:14-16`) |
| 27 | Public base for shared assets, `?s=<token>` grace (`server.js` share asset rule) | **P** | share base setting (`Store.kt:36-43`; `SettingsScreen.kt:207-215`) |
| 28 | Installable PWA (`manifest.webmanifest`) | **n/a** | native app |
| 29 | Bulk select / trash / version history / backlinks / export Markdown | **M everywhere** | see §2.3 |

### 2.1 Where Android leads

1. **Persistent offline cache and drafts** — web is online-only; Android boots
   from `store.cachedNotes` even with no server (`AppViewModel.kt:59, 112-136`)
   and queues new notes as `local:` drafts (`AppViewModel.kt:653-668`).
2. **Folder awareness in the list** — cards show folder name and "not synced"
   (`NotesScreen.kt:841-873`); the web list never shows folders.
3. **Native attachment handling** — downloads through the authenticated client
   and hands the file to a viewer instead of relying on the browser
   (`Images.kt:213-261`).
4. **Camera/photo pipeline niceties** — EXIF rotation on API 26/27, 2048 px
   downscale, GIF/WebP passthrough (`Images.kt:102-158, 45-69`).
5. **Search always visible** — no `Ctrl+K` discoverability problem on a phone.
6. **Configurable server address and public link base** — web is single-origin.
7. **Admin avatars and per-user counts** — richer than the web admin list
   (`AdminScreen.kt:171-232` vs `app.js:1788-1852`).

### 2.2 Where Android trails the web

- **Word count** (§2 #4) — trivial to add, users notice.
- **Four toolbar actions**: ordered list, fenced code block, link, table
  (`app.js:1475-1489`); the Markdown helpers already exist as patterns in
  `EditScreen.kt:136-191`, so these are ~15 lines each.
- **GFM strikethrough** — web renders it (`app.js:290`), Android has no plugin
  registered.
- **Share-link lifecycle** — see §3.6-B4.
- **Folder reorder ergonomics** — drag-and-drop on web; two icon buttons on
  Android (`NotesScreen.kt:403-422`).
- **Continuous font size** — web ±1 px (`app.js:1987-1998`), Android 4 presets.
- **Keyboard shortcuts** — irrelevant on touch, matters on tablets/ChromeOS.
- **Reopen last note** — web remembers `lastNoteId` (`app.js:641`).
- **Continuous preview** — web can render while typing on a wide screen; Android
  is a modal toggle (correct for phones).

### 2.3 Missing on both (server-bound)

Version history / snapshots, trash + restore, note-level permissions or sharing
to another account, real-time collaboration, backlinks/graph, note templates,
daily notes, outline/TOC, Mermaid, syntax highlighting, bulk operations,
Markdown/ENEX/Obsidian import, delta sync/ETags/conflict detection, push
notifications, an API token for third-party clients, and a batch endpoint.
Some of these are already task-4's territory; the Android-relevant consequence is
that **any sync/conflict feature needs a server change first** (see §6).

---

## 3. API surface consumed by the app

### 3.1 Endpoints

`Api.kt` is the entire network layer. All JSON calls go through
`request(method, path, body)` (`Api.kt:86-108`); the three binary endpoints are
hand-rolled.

| Method + path | Api.kt | Purpose | Server handler |
| --- | --- | --- | --- |
| GET `/api/session` | 121-129 | boot/probe: needsSetup, authenticated, user, registrationOpen | `server.js:450-460` |
| POST `/api/login` | 131-136 | sign in, sets cookie | `server.js:511-532` |
| POST `/api/register` | 138-143 | create account | `server.js:469-510` |
| POST `/api/logout` | 145 | sign out | `server.js:533-543` |
| POST `/api/logout-all` | 147 | kill all sessions | `server.js:544-551` |
| POST `/api/password` | 149-151 | change password | `server.js:552-573` |
| DELETE `/api/account` | 153-155 | delete own account (password re-entry) | `server.js:574-587` |
| GET `/api/notes` | 159-163 | full note list (no pagination, no delta) | `server.js:691-696` |
| POST `/api/notes` | 178-184 | create (full body incl. folderId) | `server.js:698-709` |
| PUT `/api/notes/:id` | 186-193 | **full replacement** of title/content/tags/pinned/folderId | `server.js:715-724` |
| DELETE `/api/notes/:id` | 195-197 | hard delete, prunes orphan uploads | `server.js:725-730` |
| GET `/api/folders` | 201-213 | folder list with noteCount | `server.js:613-620` |
| POST `/api/folders` | 215-219 | create | `server.js:622-635` |
| POST `/api/folders/reorder` | 222-224 | permutation of all folder ids | `server.js:639-652` |
| POST `/api/folders/:id/pin` | 227-231 | pin/unpin | `server.js:655-663` |
| PUT `/api/folders/:id` | 233-235 | rename | `server.js:669-678` |
| DELETE `/api/folders/:id` | 237-239 | delete, notes become unfiled | `server.js:679-686` |
| POST `/api/uploads` (raw bytes + `X-File-Name`) | 249-266 | image/document upload → `{url}` | `server.js:591-609` |
| POST `/api/notes/:id/share` | 269-277 | create **or rotate** token, returns path | `server.js:738-743` |
| DELETE `/api/notes/:id/share` | 280-291 | revoke | `server.js:744-747` |
| GET `/api/users` | 295-309 | admin: users + registrationOpen | `server.js:752-759` |
| POST `/api/users/:id/admin` | 311-313 | promote/demote | `server.js:777-792` |
| DELETE `/api/users/:id` | 315-317 | delete user | `server.js:761-776` |
| POST `/api/settings/registration` | 319-322 | open/close registration | `server.js:793-800` |

Not consumed: `GET /api/share/<token>` (`server.js:462-468`) and the public
`/share/<token>` route (`server.js:900-901`) — that is the read-only *browser*
experience; the app only ever creates/revokes links.

Consumption pattern: the app is **whole-list oriented**. It fetches every note at
boot/refresh and keeps the array in memory; there is no single-note GET, no
pagination, and no conditional request. With `MAX_NOTES_PER_USER = 5000`
(`server.js:44`) and 2 MB bodies (`server.js:38`), a heavy account approaches
the limits of this model (see §6 idea 15).

### 3.2 Auth handling

- Session is the server's `HttpOnly` `notes_session` cookie (`server.js:36`),
  captured by `PersistedCookieJar` (`Api.kt:349-376`) and persisted in
  SharedPreferences as the raw `name=value` string (`Store.kt:45-48`; set at
  `Api.kt:368-375`).
- `loadForRequest` re-parses that cookie against **whatever URL is being
  requested** (`Api.kt:357-366`) — host matching is deliberately bypassed
  (the comment explains it is for the direct-IP vs public-domain split). The
  save side does restrict storage to the configured host (`Api.kt:368-370`).
  This asymmetry is a credential-leak vector, see §3.6-B2.
- No token/refresh flow, no biometric gate, no keystore-backed secret storage;
  the cookie lives in plaintext prefs.
- TLS: optional "trust all certificates" switch installs an all-accepting
  `X509TrustManager` and `hostnameVerifier { _, _ -> true }` (`Api.kt:63-75`).
  Needed for HTTPS-by-IP with a domain cert, but it is a one-tap MITM switch.
- Cleartext: `android:usesCleartextTraffic="true"` (`AndroidManifest.xml:14`),
  and the **default server is plain HTTP** (`Store.kt:99`,
  `LoginScreen.kt:60-63`), so a first-run login can send the password in clear
  text if the user accepts the default.

### 3.3 Error handling

- Non-2xx → `ApiError(code, serverMessage)` (`Api.kt:24-25, 103-105`);
  network exceptions surface as the generic
  "Can't reach the server — check the address and your network"
  (`Api.kt:334-338`).
- 401 is special-cased only in `refresh` (`AppViewModel.kt:312-313`), `moveNote`
  (479-480), `deleteNote` (524-525) and `saveEditor` (641-646): it clears the
  cookie and returns to Login. Everywhere else (folders, admin, share, settings)
  a 401 is merely a snackbar, so the UI can sit signed-out but still on screen.
- No retry/backoff, no offline queue for failed non-note writes (folder moves,
  share revokes, admin actions are lost), no handling for 409 (duplicate folder
  name) beyond showing the server's message.
- Snackbars are one-shot strings on the ViewModel, consumed in `AppRoot`
  (`MainActivity.kt:52-58`).

### 3.4 Offline, drafts, and what actually happens

Intended design: boot from cache (`AppViewModel.kt:59, 112-136`); if the server
is unreachable but a user is cached, browse offline with a banner
(`AppViewModel.kt:126-132`, `NotesScreen.kt:716-742`); if a save fails, park the
note as a local draft and retry on the next `refresh()`
(`AppViewModel.kt:653-668, 487-506`); new drafts get `local:<uuid>` ids where
`Note.isLocal` is `id.startsWith("local:")` (`Models.kt:17`).

What actually happens:

- **New notes** are safe. Failure produces a `local:` draft which
  `syncPendingDrafts` recreates via POST on the next successful refresh.
- **Edits to existing notes are not persisted as drafts** — see B1.
- **Folder choice on a failed first save is lost**: `keepAsLocalDraft` builds the
  draft without `folderId` (`AppViewModel.kt:657-660`) and `syncPendingDrafts`
  posts `n.folderId` (`491-492`), so the note later lands unfiled.
- **Drafts only flush on `refresh()`** (pull-to-refresh, boot, after login).
  There is no connectivity listener and no WorkManager job, so a phone left
  offline→online stays "not synced" until the user pulls or restarts.
- `refresh()` flushes drafts *before* fetching, then replaces the list with
  server notes + remaining local drafts (`AppViewModel.kt:300-304`).

### 3.5 Config and session storage map

| Data | Key | Evidence |
| --- | --- | --- |
| Server URL (default `http://120.76.229.180:3000`) | `server_url` | `Store.kt:14-16, 86, 99` |
| Trust-all-certs flag | `trust_all_certs` | `Store.kt:18-20, 87` |
| Theme (`system/light/dark`) | `theme_mode` | `Store.kt:22-25, 88` |
| Preview font scale | `preview_font_scale` | `Store.kt:28-30, 89` |
| Public share base (default `https://funshare.site`) | `share_link_base` | `Store.kt:36-43, 90-93` |
| Session cookie | `session_cookie` | `Store.kt:45-48, 94` |
| Cached user JSON | `cached_user` | `Store.kt:50-67, 95` |
| Cached notes (synced only) | `cached_notes` | `Store.kt:69-72, 96` |
| Pending local drafts | `pending_notes` | `Store.kt:74-77, 97` |

Prefs file: `funshare_notes`, `MODE_PRIVATE` (`Store.kt:12`). No encryption.

### 3.6 Defects and risks found in the client layer

**B1 (High, data loss) — offline edits to existing notes are dropped.**
`keepAsLocalDraft` reuses the server id for existing notes
(`AppViewModel.kt:654-655`), so `isLocal` is false; only `local:` drafts are
persisted (`AppViewModel.kt:664`, `Models.kt:17`) and `store.cachedNotes` is not
written on this path. On the next successful `refresh()`, `notes` is rebuilt
from `listNotes()` plus local drafts only (`AppViewModel.kt:300-304`) — the
offline edit silently disappears, and an app restart (cache reload,
`Store.kt:69-72`) loses it even before that. The pill still says "Offline — kept
on this phone" (`EditScreen.kt:811`), which is misleading.
*Fix sketch:* give offline-edited notes a `dirty` flag + local id shadow, persist
them in a pending table, and push with a `PUT` (or `POST` when the server copy is
gone).

**B2 (High, credential leak) — the session cookie is sent to arbitrary hosts.**
`loadForRequest` ignores the request host (`Api.kt:357-366`), and the preview's
image loader is built on the same client
(`ImagesPlugin … OkHttpNetworkSchemeHandler.create(client)`, `EditScreen.kt:114-121`).
`resolvePreviewUrls` only rewrites `/uploads/` URLs
(`Images.kt:167-181`); any absolute external image URL in a note is fetched with
the cookie attached. A note containing a third-party image therefore hands
`notes_session=…` to that host.
*Fix sketch:* restrict `loadForRequest` to the configured host (or a small
allow-list: server host + public base host), and give the preview an
unauthenticated client for non-upload URLs.

**B3 (High, cross-account privacy) — cached data survives session expiry and
account changes.** `sessionExpired()` clears only the cookie and user
(`AppViewModel.kt:138-142`); `cachedNotes`/`pendingNotes`/`cachedUser` stay. The
next login seeds the list from the old cache (`AppViewModel.kt:59`) and only
clears it if the refresh succeeds. Offline (or on a failed refresh) user B sees
user A's note titles/snippets; user A's pending drafts would even be *posted into
user B's account* by `syncPendingDrafts` (`AppViewModel.kt:487-506`), because the
drafts carry no owner. `store.clearAccountData()` exists (`Store.kt:79-83`) but
is called only on explicit logout/logout-all/delete-account
(`AppViewModel.kt:235, 249, 280`).
*Fix sketch:* call `clearAccountData()` in `sessionExpired()`, and scope
persisted caches by user id.

**B4 (Medium, UX + broken links) — an existing share link can never be shown.**
`Note.fromJson` drops the `share` object the server returns
(`Models.kt:30-43` vs `server.js:691-695`), the API has no read-share call, and
the Share action always POSTs (`EditScreen.kt:342-356` → `Api.kt:269-277`),
which **rotates the token** (`server.js:738-742`). Recipients of the previous
link get a 404 after the owner taps Share again.
*Fix sketch:* parse `share` into the model, show "Sharing on / turn off /
copy existing" and only rotate on an explicit "new link".

**B5 (Medium, memory) — uploads are fully buffered.** A 25 MB document is read
into a `ByteArray` and then placed in a request body (`Images.kt:71-82`;
`Api.kt:249-266`), so low-RAM devices can OOM where the web client streams.

**B6 (Low) — no HTTP cache.** The OkHttp client has no `Cache`
(`Api.kt:57-77`); every preview render re-downloads images.

**B7 (Low) — process death loses editor state.** `backStack`, `editingId` and
the text fields are ViewModel state, not `SavedStateHandle`
(`AppViewModel.kt:47-104`); the 1.2 s autosave window means a kill in that
window loses keystrokes.

---

## 4. Android platform capabilities: used vs unused

| Capability | Status | Evidence | Cheap win? |
| --- | --- | --- | --- |
| Share-sheet **target** (receive text/image from other apps) | **unused** | manifest has only MAIN/LAUNCHER (`AndroidManifest.xml:21-24`); no `ACTION_SEND`/`ACTION_PROCESS_TEXT` filter | **Yes — highest value/effort ratio in this document** |
| Share **out** of note content | **partial** | only a plain-text link is shared (`EditScreen.kt:648-655`); note body is never shared | Yes |
| Home-screen widget | **unused** | no `AppWidgetProvider`, no `res/xml/appwidget*` | Medium win, medium cost |
| Quick-settings tile | **unused** | no `TileService` | Yes |
| Notifications / reminders | **unused** | only `INTERNET` permission (`AndroidManifest.xml:4`); no `POST_NOTIFICATIONS`, no channel, no AlarmManager/WorkManager | Yes (local reminders) |
| WorkManager background sync | **unused** | no `androidx.work` dependency (`app/build.gradle.kts:62-87`); sync is pull-to-refresh/boot only (`NotesScreen.kt:172-178`) | Yes |
| App shortcuts / launcher long-press | **unused** | no `res/xml/shortcuts.xml`, no `meta-data` in the activity | Yes |
| Biometric app lock | **unused** | no `androidx.biometric`; app opens straight into cached notes (`AppViewModel.kt:112-136`) | Yes |
| Deep links / App Links | **unused** | no `VIEW`/`BROWSABLE` intent filter; no `android:autoVerify`; server serves no `/.well-known/assetlinks.json` (`server.js:807-824, 900-902`) | Custom scheme: easy. App Links: needs server file |
| Android Auto | **n/a (reject)** | would require a car-optimised UI and a category; absurd for a personal note app | No |
| Wear OS | **unused (stretch)** | no Wear module/APK split | Only with a server-backed quick capture |
| Edge-to-edge | **already used** | `enableEdgeToEdge()` `MainActivity.kt:38` | — |
| Predictive back | **unused** | no `android:enableOnBackInvokedCallback`; back handled by `BackHandler` per screen (`NotesScreen.kt:104-112`, `EditScreen.kt:317-320`) | Yes, polish |
| Material 3 **dynamic colour** | **deliberately unused** | fixed schemes (`Theme.kt:21-75`); README:156-157 says it is intentional | Yes, as an opt-in toggle |
| Predictive text / spellcheck | **IME-provided** | `BasicTextField` everywhere (`EditScreen.kt:426, 556`); spelling/correction is left entirely to the keyboard, no explicit control | Minor |
| Camera capture | **unused** | only photo *picker* (`PickVisualMedia`, `EditScreen.kt:282-286`); no `ACTION_IMAGE_CAPTURE`, no `CAMERA` permission | Yes |
| Voice input | **IME-provided only** | no `SpeechRecognizer`/`RecognizerIntent`; keyboard mic works | Yes (dedicated dictation) |
| OCR | **unused** | no ML Kit / Play Services | Medium (APK size) |
| Local backup / auto-backup rules | **implicit, unsafe** | `allowBackup="true"` with no `dataExtractionRules`/`fullBackupContent` (`AndroidManifest.xml:7-15`) | Yes, config only |
| Per-app language | **unused** | one `strings.xml` with `app_name` only (`res/values/strings.xml`); all UI text is hardcoded English in Kotlin | Yes, but needs string extraction first |
| Themed icon / splash API | **partial** | adaptive icon only (`res/mipmap-anydpi-v26/ic_launcher.xml`); splash is the default platform one | Yes |
| FileProvider | **used** | downloads via cache dir (`AndroidManifest.xml:27-35`, `Images.kt:249-253`) | — |
| Clipboard (read image, write link) | **used** | `EditScreen.kt:234-256, 656-660` | — |

Notes:
- The 26+ manifest surface is minimal — one activity, one provider. That is why
  every capability above is a genuinely *new* integration rather than a tweak.
- `allowBackup` interacts badly with B2/B3: prefs contain the session cookie and
  the whole note cache, so Android's default backup (cloud + device-to-device)
  can copy them off-device. Modern targets want
  `android:dataExtractionRules` + explicit `<exclude>` for `funshare_notes`.

---

## 5. Release, versioning and repository hygiene

### 5.1 Build facts

| Fact | Value | Evidence |
| --- | --- | --- |
| applicationId / namespace | `site.funshare.notes` | `app/build.gradle.kts:8, 13` |
| versionCode / versionName | `17` / `1.16` | `app/build.gradle.kts:16-17` |
| minSdk / targetSdk / compileSdk | 26 / 35 / 35 | `app/build.gradle.kts:9, 14-15` |
| buildToolsVersion | `34.0.0` (with compileSdk 35) | `app/build.gradle.kts:10` |
| AGP / Gradle / Kotlin | 8.7.3 / 8.9 / 2.0.21 | `android-app/build.gradle.kts:2-4`, `gradle-wrapper.properties` |
| Java level | 17 | `app/build.gradle.kts:36-39, 54-56` |
| Minification / R8 | **disabled** (`isMinifyEnabled = false`) | `app/build.gradle.kts:30-33`; `proguard-rules.pro` is a comment + 2 keep rules |
| Signing | release config with **plaintext passwords** | `app/build.gradle.kts:20-27` |
| Release APK size | ~11.3 MB (v1.16 = 11,608 KB), 17 builds ≈ 188 MB in-tree | root listing |
| Repos | Aliyun mirrors first, then google/mavenCentral | `settings.gradle.kts:4-24` |
| CI / lint / static analysis | none present | no workflow files, no detekt/ktlint config |

Versioning is a clean `versionCode = release number` pattern (v1.0 → 0/1 … v1.16
→ 17; the 17 APKs and versionCode 17 line up). That is fine for sideloading and
is what makes "install over the old app" work — which is exactly why the signing
key matters.

### 5.2 FLAGGED: the signing keystore and its password are in the repository

`android-app/keystore/funshare-release.jks` (2.6 KB) sits in the working tree,
and the credentials are published twice:

- `app/build.gradle.kts:20-27` — `storePassword = "funshare2026"`,
  `keyAlias = "funshare"`, `keyPassword = "funshare2026"`;
- `android-app/README.md:123-125` — same values in prose ("alias `funshare`,
  password `funshare2026`").

There is no `.git` directory in this checkout, so nothing is *literally*
committed yet, but the root `.gitignore` excludes only `data/` and OS noise — a
`git add -A` would include the keystore, all 17 APKs and `local.properties`.

Why this is a real security risk, not just untidiness:

1. **Signing identity = update authority.** Android only accepts an update signed
   by the same key for `site.funshare.notes`. Anyone with the repo can build a
   malicious APK that installs *over* the user's app, inheriting its data
   (SharedPreferences cache, session cookie) and its trust. There is no Play
   App Signing key to rotate this away.
2. **The APKs amplify it** — 17 release artefacts with a known key invite
   differential analysis of the app's history and confirm the signing identity.
3. **The key cannot be silently rotated** — the README itself notes that every
   future update must use it (`android-app/README.md:124-125`). Leaking it converts a
   "destroy the phone to recover" situation into a permanent one.
4. It is trivially avoidable: `keystore/`, `*.jks`, `local.properties`,
   `*.apk`, `build/`, `.gradle/` belong in `.gitignore`, with signing
   credentials passed via `-P` properties / `~/.gradle/gradle.properties` or
   environment variables and a documented key-backup procedure.
5. `local.properties` (with `sdk.dir=D:\android-tools\sdk`) is also in the tree —
   harmless content, wrong pattern; it is machine-specific and normally ignored.
6. 17 APKs of ~11 MB each (≈188 MB) for a 5 k-line client is repo bloat with no
   upside — release artefacts belong on a release page, not in source control.

**Recommendation:** move the keystore out of the repo now (and back it up
offline), rotate to a fresh key only if the repo has already been shared, purge
the APKs, and add the ignore rules. If the current key is already public, treat
the app's local data as compromise-adjacent and rotate the server-side sessions
(`/api/logout-all`) at minimum.

### 5.3 Test coverage

Five JVM/Robolectric classes under `app/src/test` (there is **no**
`src/androidTest`, so no on-device instrumentation tests):

| Test | What it pins down |
| --- | --- |
| `TaskTapTest.kt` (200 lines) | renders a real 30-task note through Markwon on a real `TextView`, verifies every checkbox hit-box maps to the right document index, that body taps miss, and that flipping marker *i* changes exactly marker *i* |
| `PreviewTaskTapTest.kt` (138) | regression for the Compose-interop bug: taps through the real `MarkdownText` inside a scrolling column must toggle, body taps and scroll drags must not |
| `FolderOrderTest.kt` (90) | pure functions: pinned-first display order, same-group neighbour rules, permutation-preserving swaps, unknown ids |
| `FolderDrawerScrollTest.kt` (75) | Compose semantics test: 40 folders scroll into view while the "New folder" footer stays |
| `UploadNameEncodingTest.kt` (39) | `X-File-Name` percent-encoding round-trips CJK/spaces/pluses |

Themes: **geometry/rendering integration** and **pure ordering logic** — both
high-value, both regression tests for real shipped bugs (v1.15 checkbox taps,
v1.16 drawer scroll, CJK upload names). The Robolectric setup points at an Aliyun
mirror because Maven Central is unreachable from the build host
(`app/build.gradle.kts:40-53`).

Gaps (important, because they hide §3.6):

- **No tests at all** for `Api`, `Store`, `AppViewModel` — i.e. nothing covers
  login, session expiry, offline drafts, `keepAsLocalDraft`, folder sync, share
  rotation, or the conditional `folderId` PUT. B1/B3 would have been caught by a
  single fake-server test of "edit offline → refresh".
- No Compose screen tests beyond the drawer (login, editor, settings, admin).
- No instrumentation/UI automation, no screenshot tests.
- No test for `preprocessLatex` / `flipTaskMarker` edge cases beyond the fixture
  note, and none for `resolvePreviewUrls` (the URL-policy split in B2).

---

## 6. Mobile feature ideas

Effort: **S** ≈ ≤1 day, **M** ≈ 2-5 days, **L** ≈ 1-2 weeks. "Server?" means the
server must change before the feature can ship well. "Why mobile-native" is the
reason a phone specifically makes this worth doing.

| # | Idea | Why mobile-native | Effort | Risk | Server? |
| --- | --- | --- | --- | --- | --- |
| 1 | **Share-sheet capture inbox**: register `ACTION_SEND`/`ACTION_SEND_MULTIPLE` (text, image, PDF) and `ACTION_PROCESS_TEXT`; land in the editor with the shared content/first image already uploaded and tagged `inbox` (or drop into a pre-selected folder) | This is the single biggest thing a phone can do that a browser cannot: capture from WeChat, a browser, a PDF reader, a photo app with one tap. The upload/pipeline already exists (`Api.kt:249-266`, `Images.kt:45-69`), only the manifest filter + intent parsing is new | S | Low — new entry path only, no data-model change | No |
| 2 | **Share-out of the note itself** (full Markdown/text via `ACTION_SEND`, plus "share as .md" through FileProvider) | Sharing currently only sends the public URL (`EditScreen.kt:648-655`); sending the actual note is what people expect when handing a note to a colleague | S | Low — no auth/URL implications (unlike public links) | No |
| 3 | **Launcher shortcuts + intent API** (`funshare://new?text=…`, "New note", "Search", "Capture photo"), long-press menu | Shortcuts and intent URLs are the cheapest automation surface on Android (Tasker, Nova gestures, quick capture from the home screen) | S | Low | No |
| 4 | **Quick Settings tile "New note"** (`TileService` that launches the editor) | One swipe + tap from anywhere, including the lock screen's quick panel; impossible on the web | S | Low — must handle locked state / launch flags | No |
| 5 | **Home-screen widget**: quick-add row + the 3–5 most recent notes (Glance or classic RemoteViews) | Ambient access without opening the app; the killer "notes as a utility" affordance. Also reuses the cached-note store | M | Medium — widget process has no ViewModel; must refresh cache from `GET /api/notes` and handle signed-out/stale states; Glance adds a Compose surface | No (delta endpoint would help later) |
| 6 | **Local reminders** on a note (date/time picker → `AlarmManager`/`WorkManager` + notification channel, tap opens the note) | Calendar-like nudges are a phone job; "remind me about this note" is a top-5 note-app ask. Needs `POST_NOTIFICATIONS` + exact-alarm care | M | Medium — permissions, battery optimisation, reboot persistence (needs a `BOOT_COMPLETED` receiver) | No (local only). Yes if reminders must fire on other devices / web |
| 7 | **WorkManager sync** (periodic + on-network, with backoff) to flush drafts, refresh the list and warm the cache | Turns the current "only on pull-to-refresh" sync into background behaviour that matches phone expectations; directly fixes the half-sync offline story in §3.4 | M | Medium — auth/cookie in a background worker, work constraints, dedupe with foreground refresh | No for pull; a delta endpoint (`?since=`) would make it cheap and is the real win |
| 8 | **Biometric app lock** (`androidx.biometric` prompt on open/resume; `FLAG_SECURE` for the recents thumbnail) | A phone gets handed around and left on tables; the app currently opens straight into cached notes (`AppViewModel.kt:112-136`) with no gate, and a plaintext cookie in prefs | S | Low-Medium — device-credential fallback, don't lock out users without biometrics | No |
| 9 | **Deep links**: custom scheme `funshare://note/<id>` today; App Links for `https://<host>/share/<token>` once the server serves `/.well-known/assetlinks.json` | Notifications, widgets and shortcuts all need a way to open a specific note; share links opened from chats should land in the app, not a browser | M | Medium — App Links need server-hosted assetlinks + signing-cert hash (interacts with §5.2!); share tokens are bearer secrets in URLs, so don't log them | Yes for App Links (`/.well-known/assetlinks.json` + `/note/<id>` maybe) |
| 10 | **Camera capture** (`ACTION_IMAGE_CAPTURE` / `TakePicture` → existing compress+upload pipeline) | Photographing a whiteboard/receipt/paper is the archetypal mobile capture; today only the gallery picker exists (`EditScreen.kt:282-286`) | S | Low — FileProvider already configured (`file_paths.xml` cache path) | No |
| 11 | **Voice note / dictation button** (`RecognizerIntent` or `SpeechRecognizer` → live transcript into content/title) | Walking-and-talking capture; keyboards' mics work but a dedicated button is discoverable and can keep appending | M | Medium — recogniser availability varies, on-device vs cloud, needs a partial-results UX | No |
| 12 | **OCR capture** (ML Kit text recognition on a camera shot or gallery image → pre-filled Markdown, image attached) | Converts paper/screenshots into searchable notes; only possible on-device cheaply, and the upload path already exists | M | Medium — +APK size (bundled model ≈ tens of MB) or Play Services dependency, offline model management, accuracy expectations | No |
| 13 | **Swipe actions on note rows** (right = pin, left = move/delete) with undo snackbar | Thumb-reach bulk-feel editing; long-press+modal is slow on a phone (`NotesScreen.kt:294-299`) | S | Low — delete needs undo since server delete is hard (`server.js:725-730`) | No (undo would be nicer with soft delete — server) |
| 14 | **Bulk selection mode** (long-press to enter, multi-select, move/delete/pin) | Cleaning up 50 notes on a phone is currently 50 dialogs; this is a phone-scale chore | M | Medium — no batch endpoint, so N requests against the 2 MB body / rate limits; optimistic UI + partial failure handling | Recommended (batch endpoint; trash for undo) |
| 15 | **True local-first store** (Room/SQLite + operation log + conflict detection: local `rev`/`updatedAt` compare, per-field merge or "keep both") | This is what makes every offline feature reliable, and it is only worth doing on the client that is actually offline. It also fixes B1/B3 structurally. Blocked by the server's last-write-wins full-replace PUT (`server.js:715-724`) | L | High — schema, migration, conflict policy, server contract; easy to get subtly wrong | **Yes** (delta sync / `If-Match` or `rev`, `updatedAt` from server, tombstone deletes) |
| 16 | **Read-aloud / listen mode** (Android `TextToSpeech` on the rendered note, sentence highlight) | Commute/hands-busy listening is a phone-only use case; TTS is offline and free | S | Low — engine availability, long notes need chunking | No |
| 17 | **Per-app language + Chinese localisation** (extract hardcoded strings to `strings.xml`, add `values-zh`, `localeConfig`) | The deployment target is a Chinese-hosted server used on a Xiaomi phone (`README.md:186-198`); today every label is hardcoded English in Kotlin | M | Low-Medium — string extraction touches every screen (mechanical), then translation quality | No |
| 18 | **Material You opt-in + themed icon + Android 12 splash** (toggle in Appearance; `dynamicColorScheme` when available) | Personalisation is expected on Android 12+; keeping the curated scheme as the default respects the current design intent (README:156-157) | S | Low — alternative colour paths need contrast checks across all custom surfaces | No |
| 19 | **Predictive back + shared-element transitions** (`enableOnBackInvokedCallback`, animate note card → editor) | Makes the app feel native rather than like a port; back is the most-used gesture on Android | S | Low — per-screen `BackHandler` already exists, so verify the callback ordering | No |
| 20 | **Backup hardening + restore** (`dataExtractionRules` excluding prefs, encrypted local export, and a JSON *import* in Settings that the export UI implies) | The app exports JSON but cannot restore it — a backup you can't restore is a trap; and auto-backup currently leaks the cookie (§4) | S | Low-Medium — import needs id-collision policy (new ids vs upsert) and folder mapping | Optional (bulk import endpoint) |

Deliberately **rejected/deferred**: Android Auto (no in-car use case, large
surface), Wear OS (only worth it after #6/#7 give a server-backed quick-capture
API; otherwise it is a second client to maintain), real-time collaborative editing
(CRDT is a server rewrite, see task-4's rejection list), full on-device AI/RAG
(APK size + a server the user self-hosts), and a Compose desktop/tablet rewrite
(nothing here is blocked on form factor).

### 6.1 Best five, in order

1. **#1 Share-sheet capture** — mobile-native to the core, one day of work,
   reuses the entire upload pipeline, and no other client can match it.
2. **#8 Biometric lock** — tiny effort, closes an actual exposure (plaintext
   cookie + cached corpus, §5.4), and is a trust feature users can see.
3. **#7 WorkManager sync** — turns the half-implemented offline story into
   something dependable and is a prerequisite for a widget.
4. **#4 QS tile + #2 share-out** — both tiny, both make the app feel native,
   and #3 shortcuts should ship alongside them.
5. **#14 bulk selection (after a batch/trash endpoint)** — the highest-value
   *quality-of-life* feature once the server can support undo and batching.

Do **#15 local-first** only with server work scoped first — attempting it against
the current last-write-wins PUT is how offline edits get lost twice.

---

## 7. Open questions / unknowns

- Is the app distributed only by sideload (README's install flow implies yes)?
  If it ever goes to a store, §5.2 must be fixed *before* the first upload.
- Is "trust all certificates" ever expected in production, or is it a
  temporary workaround? It is currently one tap away for every user.
- Is the public share base (`https://funshare.site`) actually reachable from the
  phone's network? Attachment links and share links are built from it
  (`Images.kt:167-181`, `AppViewModel.kt:605-609`); if it is ICP-blocked
  (`README.md:147, 193-198`), shared attachment links break for recipients on
  mainland networks.
- Does anyone use this on a tablet? If so, a write/preview split pane
  (§2.2) is worth revisiting.
- Since the server is single-process with a 2 MB body limit, does an average
  account ever hit the 5,000-note cap? That answer decides whether #15 needs
  pagination alongside delta sync.