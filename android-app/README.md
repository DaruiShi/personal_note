# Funshare Notes — Android app

Native Android client (Kotlin + Jetpack Compose) for the self-hosted
Personal Notes server (`../server.js`). It talks to the server's JSON API
over HTTP(S) with the same cookie session a browser uses, so the website and
the phone app share one account and the same notes.

## Features

- **Sign in / register** against your server, incl. first-run admin setup.
  Server address is configurable per install (defaults to
  `http://120.76.229.180:3000`), with an optional *trust all certificates*
  switch for HTTPS-by-IP setups.
- **Notes list** — big-title header with a **folder drawer** (hamburger
  button), always-visible search pill, pastel tag filter chips, rounded
  tonal note cards with staggered layout animation, pinned-first ordering,
  pull-to-refresh. Long-press a note for **Move to folder** / Delete.
- **Folders** — the left drawer lists All notes, Unfiled, and every folder
  with note counts; the list **scrolls** when there are more folders than
  fit, while the header and the **New folder** button stay in place; tap a
  folder to switch views. The ⋮ on each folder row renames or deletes it
  (deleting a folder unfiles its notes), **pins it to the top** ("Pin to
  top" / "Unpin"), and **reorders it** with the up/down buttons — pinned
  folders are shown above the rest and each group keeps the order set
  this way (stored on the server via `/api/folders/reorder` and
  `/api/folders/:id/pin`, so other clients see it too). The
  **Move-to-folder dialog** lists folders in the same order (scrollable,
  pinned first) and can also create a folder and move a note in
  one step (type a name + "Create and move"); the editor's folder icon
  moves the open note, including brand-new unsaved ones (applied at first
  save). Backed by the server's
  `/api/folders` endpoints; notes carry a `folderId`, and the web app
  preserves it when editing (it just doesn't display folders).
- **Editor** — flat borderless title/content fields, tag chips, pin toggle,
  a **Markdown quick-insert toolbar** (image, bold, italic, heading, list,
  task, quote, code, divider), debounced auto-save with a floating status
  pill, and a rendered **Markdown preview** (Markwon: headings, task lists,
  tables, images, **LaTeX equations** — `$$…$$`, `\[…\]`, `\(…\)` and
  `$…$` rendered with JLatexMath, sized to the preview font and themed).
  Tapping a note opens it in **preview mode**; the pencil
  icon switches to editing, while the "New" button starts in the editor.
  In preview, **task checkboxes are tappable** — tapping one flips the
  `[ ]`/`[x]` marker in the note source and autosaves (fenced code blocks
  and nested/quoted task lists are handled).
  Uploads with **Chinese (non-Latin-1) file names** work: the name rides
  the `X-File-Name` header percent-encoded (header values are Latin-1 only,
  so raw CJK made OkHttp throw before the request was even sent); the
  server decodes it back. Requires the matching server version.
  and nested/quoted task lists are handled).
- **Images** — insert a picture via the toolbar (system photo picker) or
  by copying an image anywhere and tapping "Insert" on the clipboard
  banner in the editor. Photos are downscaled (≤2048px) and recompressed
  to JPEG, small GIF/WebP files pass through unchanged; the bytes are
  uploaded via `POST /api/uploads` and a relative `![alt](/uploads/…)`
  reference is inserted at the cursor.
- **Document attachments** — the paperclip in the toolbar picks a PDF,
  Word/PowerPoint/Excel (old and OOXML), OpenDocument, text/CSV/Markdown
  or ZIP file (≤25 MB) and uploads it unchanged (`X-File-Name` carries the
  original name, percent-encoded — header values are ISO-8859-1 only); a
  `[name](/uploads/…)` link is inserted. Tapping an
  attachment link in the preview downloads it through the app's
  authenticated client and opens it in a document viewer (FileProvider).
  In the preview, document links are shown under the **public share link
  base** (`https://funshare.site`) rather than the server address the
  phone uses; stored markdown stays relative so the web app's attachment
  chips and share-recipient asset access keep working.
- **Sharing** — the share icon in the editor saves the note, creates (or
  rotates) its public link via `POST /api/notes/:id/share`, and offers
  Share… (Android share sheet), Copy link, and Turn off (revoke).
  Links are built from the **public share link base** (default
  `https://funshare.site`, editable in Settings → Server) rather than
  the server address the phone itself uses — that one may be an IP:port
  outsiders can't reach. Recipients open `/share/<token>` in any
  browser — the web app renders it read-only, including images and
  attachments via the `?s=<token>` asset grace.
- **Share QR code** — when the server advertises `features.qr`, the share
  dialog also shows a QR code fetched from `/share/<token>/qr.svg`
  (rendered locally from the SVG rects — no extra library). It is fetched
  through the same base the link shows, so scanning always opens the URL
  in the dialog. A server-configured `PUBLIC_BASE_URL` (also advertised
  in `/api/session`) overrides the local share-link base.
- **Wikilinks and backlinks** — `[[Note title]]` (or `[[Note title|label]]`)
  renders as a link in the preview; tapping opens that note, or offers to
  create it when no note has the title (missing links render muted). The
  link index is maintained client-side over the cached notes. A preview
  ends with a "Linked from" section listing notes that wikilink to it,
  each with a snippet, plus a chips line of the note's own outgoing links.
- **Daily notes** — the calendar action on the notes screen opens (or
  creates) today's note titled `YYYY-MM-DD`; while such a note is open, a
  ‹ label › Today bar steps between days. Daily notes are plain notes.
- **Timeline notes** — the timeline action creates a date-organised note:
  swipe between date pages (items + today + visited), check items done,
  add / edit / move / delete them with optional HH:MM-HH:MM time ranges
  (timed items sort first, untimed last; quick Morning / Noon / Afternoon /
  Evening presets), long-press-drag rows into a manual order, and paste text to parse into dated, timed items (server AI
  when configured, local basic parser otherwise). Saves carry `kind:
  timeline` + items; conflicts keep the existing dialog.
- **Preview text size** — Settings → Appearance offers Small / Default /
  Large / Huge; the scale applies to the preview title and body and is
  remembered.
- **Offline drafts** — if the server is unreachable, notes are kept on the
  phone as local drafts ("not synced") and pushed automatically on the next
  successful sync.
- **Account** — change password, sign out, sign out everywhere, delete
  account, JSON backup export (via the system file picker).
- **Admin panel** — manage users (promote/demote/delete), open/close
  registration, with per-user avatars.
- **Design** — curated indigo/violet brand palette (light & dark), rounded
  grouped settings cards, segmented theme control, gradient accents, smooth
  screen transitions.

## Project layout

```
app/src/main/java/site/funshare/notes/
  Api.kt            OkHttp client, cookie persistence, all REST endpoints
  AppViewModel.kt   state, navigation, autosave, offline-draft sync
  Folders.kt        folder ordering helpers: pinned-first display order,
                    same-group neighbour lookup, stored-order swaps
  Store.kt          SharedPreferences (config, cookie, caches, drafts)
  Models.kt         Note / User / session models
  MainActivity.kt   root + animated navigation
  ui/Design.kt      design system: brand gradient, tag palette, avatars,
                    badges, shape tokens
  ui/Theme.kt       curated light/dark schemes + typography
  ui/Images.kt      image pipeline: decode/downscale/compress, alt text,
                    relative-URL resolution for the preview
  ui/Latex.kt       LaTeX math: preprocessing to `latex://` images +
                    JLatexMath scheme handler (size/color aware)
  ui/               LoginScreen, NotesScreen, EditScreen, SettingsScreen,
                    AdminScreen, Markdown preview, helpers
```

## Build

Requirements: JDK 17, Android SDK (platform 35, build-tools 34.0.0).

With Gradle (a wrapper is included):

```bash
./gradlew assembleRelease
# → app/build/outputs/apk/release/app-release.apk (signed, installable)
```

The release APK is signed with `keystore/funshare-release.jks`
(alias `funshare`, password `funshare2026`). Keep this keystore — every
future update must be signed with it to install over the current app.
Repositories resolve through the Aliyun mirrors first (fast in mainland
China), then fall back to google()/mavenCentral().

In Android Studio: open the `android-app` folder and press Run.

## Install on the Redmi K80 Pro

1. Copy `FunshareNotes-v1.24.apk` to the phone (USB transfer, 微信文件传输助手, etc.).
2. Open it from the file manager (小米文件管理 → 安装包). HyperOS will ask
   to allow installing from this source — allow it once.
3. First screen: set the **server address** (see below), then sign in with
   your account.

## Server address — what to enter

The app can talk to any deployment of the notes server:

| Server setup | Address to use in the app | Notes |
| --- | --- | --- |
| Bare IP, port 3000 (deploy doc "Route B") | `http://120.76.229.180:3000` | Needs security-group port 3000 + `HOST=0.0.0.0` on the server |
| Caddy HTTPS via IP | `https://120.76.229.180` | Cert is issued for the domain → enable **Trust all certificates** |
| Domain with HTTPS | `https://funshare.site` | Currently blocked by Aliyun's ICP filing check on 80/443 (mainland region) — works once 备案 is completed, or from an HK/international region server |

## Development notes

- `usesCleartextTraffic="true"` — required so the app can speak plain HTTP
  to a self-hosted server without TLS. Passwords over plain HTTP are
  visible on the network path; prefer HTTPS for long-term use.
- The session cookie (`notes_session`) is stored in the app's private
  SharedPreferences and expires server-side after 7 days.
- The UI uses a fixed brand palette (indigo/violet) in both themes rather
  than Material You dynamic color, so it looks identical on every device.
- minSdk 26 (Android 8.0), targetSdk 35.
- **Preview checkbox taps are handled by the `TextView`'s own
  `OnTouchListener`, not by a Compose `pointerInput`.** Markwon's
  `setMarkdown` installs a `LinkMovementMethod`, which makes the preview
  `TextView` clickable — the interop view then consumes every touch inside
  `AndroidView`, so a Compose gesture detector above it never fires (v1.15
  fixes the "checkboxes can't be checked" bug this caused). The listener
  uses `TaskTap.taskIndexAt` for hit-testing, ignores drags beyond the
  touch slop so scrolling still works, and returns `false` for everything
  that is not a checkbox so links keep opening.
- **The folder drawer must keep a constrained, scrollable list area**
  (`weight(1f) + verticalScroll`) between its fixed header and the fixed
  "New folder" footer — otherwise accounts with more folders than fit on
  screen can't reach the rows below the fold (fixed in v1.16). Folder
  pinning/ordering is display-side: `displayOrder()` puts pinned folders
  first while `POST /api/folders/reorder` still receives a permutation of
  all folder ids, so the stored order stays canonical.
