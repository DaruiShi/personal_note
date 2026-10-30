# Personal Notes

A tiny self-hosted note-taking web app. Run it on a VPS, open it from any
browser (desktop or phone), and keep your notes private behind a login.

- **Zero dependencies** — Node.js standard library only. No `npm install`,
  no database server, nothing to break on upgrade.
- **Single data file** — everything lives in `data/notes.json`, written
  atomically. Back up one file and you're done.
- **Multi-account** — register accounts, each with its own notes. The first
  account is the admin and can manage users and open/close registration.
- **Hardened auth** — scrypt-hashed passwords, HttpOnly session cookies,
  login rate limiting, registration throttling, strict CSP.

## Features

- Markdown notes with live preview (headings, lists, task lists, tables,
  code blocks, quotes, links, images) and a formatting toolbar in the editor;
  opening a note shows the rendered view first, and task checkboxes can be
  ticked directly in preview
- LaTeX math: `$…$`, `\[…\]`, `$$…$$`, `\(…\)` — sub/superscripts, Greek
  letters, fractions, roots, operators and common function names, rendered
  by a built-in math engine (no external dependencies)
- Images and documents: insert images via the toolbar or by pasting a
  screenshot straight into the editor; attach documents (PDF, Word, Excel,
  PowerPoint, plain text, OpenDocument) with the paperclip button — up to
  25 MB per file
- Share a note with a public link: a read-only page that works without an
  account (its images and attachments included); revocable any time
- **Link previews** — the public share page is server-rendered with Open
  Graph / Twitter Card meta tags (title, description, first image), so
  pasting the link into chat apps or social sites shows a rich card; the
  page itself stays `noindex, nofollow, noarchive`
- **QR code for share links** — the share dialog shows a scannable QR code
  (`/share/<token>/qr.svg`) so a phone can open the note directly
- Adjustable preview font size (− / % / + controls in preview mode,
  remembered per browser)
- Folders: create your own folders, rename or delete them any time, and
  file notes into them from the editor; notes in a deleted folder are kept
  (they return to "No folder"). Folders can be pinned to the top of the
  list and rearranged by dragging
- Full-text search (`Ctrl+K`), tags with filter, pinned notes
- **Trash (soft delete)** — deleting a note moves it to the trash, where it
  can be restored for `trashRetentionDays` (default 30, 1–3650 configurable
  in `data/notes.json` → `settings.trashRetentionDays`); an hourly sweep
  purges expired notes permanently
- **Version history** — every accepted edit is kept for each note (up to 50
  versions, one per minute at most) in per-note sidecar files under
  `data/history/`; any version can be previewed and restored, and restoring
  is itself undoable
- **Conflict detection** — notes carry a `rev` counter; if a note changed on
  another device since you last saw it, saving asks whether to keep your
  version, the other one, or both. Losing payloads are stored in history,
  so nothing is silently discarded or merged
- Auto-save while you type, with save status indicator
- Dark / light theme (follows system preference, toggleable)
- Responsive layout — works well on phones
- One-click JSON backup export
- Installable as a PWA (add to home screen)
- **Native Android app** (`android-app/`) — sign in, browse, edit with
  autosave + Markdown preview, offline drafts, admin panel
- Accounts: registration, sign-in, change password, sign out everywhere,
  delete account; admin panel to promote/demote/delete users and toggle
  open registration
- **Timeline notes** — a second note kind organised by date: it opens on
  today, scrolls horizontally between dates, and holds a list of items per
  date that can be added, edited, moved, and deleted in place. **Paste &
  parse** turns pasted text into dated items (via MiniMax when configured,
  otherwise a basic local parser) for you to confirm.

### Note types

Notes are either plain **markdown** notes (the default; `kind` absent) or
**timeline** notes (`kind: "timeline"`, items in `note.timeline.items`). A
timeline's markdown `content` is a read-only mirror the server derives from
its items — every save regenerates it, so sharing, trash, export, and the
Android app (which shows the mirror read-only and is refused with a clear
message if it tries to write) all keep working. Up to 5000 items per note,
each with plain text up to 4000 characters on a `YYYY-MM-DD` date.

### Wikilinks and daily notes

- **Wikilinks**: `[[Note title]]` (or `[[Note title|label]]` for custom link
  text) renders as a link to that note — titles match ignoring case and
  whitespace. Clicking a link to a note that doesn't exist offers to create
  it. Links inside code spans or fenced code blocks stay literal.
- **Backlinks**: a note's preview ends with a "Linked from" section listing
  every other note that wikilinks to it, each with a snippet around the
  link, plus a line of this note's own outgoing links.
- **Daily notes**: the **Today** button in the sidebar opens (or creates)
  a note titled with today's date in `YYYY-MM-DD` form, and a date bar
  above such notes steps to the previous/next day. Daily notes are plain
  notes — no special storage, tags, or folders.

## Run locally

Requires Node.js 18 or newer.

```bash
node server.js
# → http://localhost:3000
```

The first visit asks you to create the admin account (username +
password). Further accounts can register themselves as long as
registration is open — the admin can close it any time from
**Account → Manage users**. Every account only ever sees its own notes.

## Deploy on a VPS

### 1. Install Node.js (Ubuntu/Debian example)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Copy the app and create a user for it

```bash
sudo useradd --system --home /opt/notes --shell /usr/sbin/nologin notes
sudo mkdir -p /opt/notes
sudo cp -r server.js public deploy package.json /opt/notes/
sudo mkdir -p /opt/notes/data
sudo chown -R notes:notes /opt/notes
```

### 3. Run it as a systemd service

```bash
sudo cp /opt/notes/deploy/notes.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now notes
curl http://127.0.0.1:3000/api/session   # sanity check
```

The unit listens on `127.0.0.1:3000` only, so the app is reachable solely
through your reverse proxy.

### 4. Put it behind HTTPS (recommended)

Easiest with Caddy (automatic Let's Encrypt certificates). Point your
domain's DNS A record at the VPS, then use `deploy/Caddyfile`:

```bash
sudo apt install caddy
sudo nano /etc/caddy/Caddyfile        # replace notes.example.com
sudo systemctl reload caddy
sudo ufw allow 80,443/tcp             # if ufw is enabled
```

With nginx instead:

```nginx
server {
    listen 80;
    server_name notes.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

When running behind a proxy, uncomment `Environment=TRUST_PROXY=1` in the
systemd unit (and restart it) so login rate limiting sees real client IPs.

> If you skip the reverse proxy and expose the port directly, set
> `HOST=0.0.0.0` and open the port in your firewall — but you really want
> HTTPS before typing your password over the public internet.

## Configuration (environment variables)

| Variable      | Default   | Meaning                                          |
| ------------- | --------- | ------------------------------------------------ |
| `PORT`        | `3000`    | Listen port                                      |
| `HOST`        | `0.0.0.0` | Listen address (use `127.0.0.1` behind a proxy)  |
| `DATA_DIR`    | `./data`  | Directory holding `notes.json`                   |
| `TRUST_PROXY` | off       | `1` = honor `X-Forwarded-For` (behind a proxy)   |
| `PUBLIC_BASE_URL` | unset | Public origin (`https://notes.example.com`) used in share-page `og:url`/`canonical` tags and QR codes; unset = derive from the request |
| `CONFIG_FILE` | `./config.json` | Path to the optional config file (see below) |

**Link previews:** share pages build their Open Graph tags from the request
host by default. Behind a reverse proxy, set `PUBLIC_BASE_URL` (and
`TRUST_PROXY=1`) so previews and QR codes always carry your public domain
instead of `127.0.0.1:3000`.

## config.json (optional — AI date parsing for timelines)

Timeline notes work without any configuration. To let **Paste & parse**
extract dates with an LLM, copy `config.example.json` to `config.json`
next to `server.js`, put your MiniMax API key in `llm.apiKey`, and restart:

```json
{
  "llm": {
    "enabled": true,
    "baseUrl": "https://api.minimax.io/v1",
    "model": "MiniMax-M3.1-Flash",
    "apiKey": "YOUR KEY",
    "timeoutMs": 25000,
    "maxInputChars": 20000,
    "maxItemsPerRequest": 200,
    "requestsPerHourPerUser": 30
  }
}
```

- `chmod 600 config.json` — it holds a secret. The file is read once at
  startup and is gitignored; `config.example.json` is the tracked template.
- `baseUrl` must match the platform the key belongs to: international keys
  use `https://api.minimax.io/v1`; keys from the mainland console
  (platform.minimaxi.com) use `https://api.minimaxi.com/v1` — a key on the
  wrong platform fails with 401.
- The `thinking` request parameter is omitted by default (MiniMax-M3.1-Flash
  requires adaptive thinking and rejects `{"type":"disabled"}` with a 400).
  Set `"thinking": {...}` in the config only if your model needs it pinned.
- **Privacy:** when you use Paste & parse, the pasted text is sent to
  MiniMax to extract dates; nothing else from the note is sent.
- Each account is limited to `requestsPerHourPerUser` parses per hour
  (in-memory; the counter resets on restart).
- Without the file, an empty key, or `enabled: false`, the server starts
  normally and the parse button falls back to a basic local parser
  (leading `YYYY-MM-DD`, `M/D`, `M月D日`, `今天/昨天/前天`, `星期X` dates).

## Backups & recovery

- **Backup:** copy the whole `data/` directory — `notes.json` (accounts,
  sessions, notes) plus `uploads/` (images and attachments) and `history/`
  (per-note version sidecars). *Export backup* in the UI exports one
  account's notes as JSON (without files).
- **Deleted a note by accident:** open **Trash** in the sidebar (web) or
  **Settings → Trash** (Android) and restore it. Notes stay in the trash for
  the retention window (default 30 days); "Delete forever" or "Empty trash"
  removes them immediately, together with their version history.
- **Forgot a password:** passwords cannot be recovered (they are only
  stored as scrypt hashes). An admin deletes the account from
  **Manage users** and the person registers again; or edit
  `data/notes.json` directly and remove that user from the `users` array
  (their notes stay until you remove them too).
- **Migrating from the single-password version:** on first start with the
  new code, the old password becomes an account named `admin` that owns
  all existing notes. Sign in as `admin` with the old password and rename
  usage from there (old sessions are invalidated — just sign in again).
- **Restore:** put back the `data/` directory and restart the service.

## Security notes

- Passwords are hashed with scrypt (unique salt per account); sessions are
  random 256-bit tokens in HttpOnly, SameSite=Strict cookies (7-day expiry).
- Five failed logins lock the source IP out for 15 minutes; registration is
  throttled to 5 sign-ups per IP per hour and capped at 100 accounts.
- Changing a password signs out all other devices; "sign out everywhere"
  kills every session of the account.
- All note content is HTML-escaped and rendered through a small built-in
  markdown parser; external scripts can't be injected via note content.
- Uploads (images and documents) are validated by magic bytes — images
  (PNG/JPEG/GIF/WebP) and documents (PDF, Office, OpenDocument, plain text),
  25 MB max — stored under random names, and served only to signed-in
  sessions, plus — for a **shared** note — to visitors holding that note's
  share token (limited to exactly the files the shared note references).
- Share links are capability URLs: whoever has the 128-bit token can read
  the note until the owner revokes it. Only title, content and update time
  are exposed — never tags, author or other notes.
- A strict Content-Security-Policy is served with every page.

## Project layout

```
server.js                 HTTP server, auth, JSON API, static files
public/index.html         single-page UI
public/style.css          theme (light/dark) and layout
public/app.js             app logic + markdown renderer
android-app/              native Android client (Kotlin + Compose)
deploy/notes.service      systemd unit
deploy/Caddyfile          reverse-proxy config with auto-HTTPS
data/notes.json           created at runtime — accounts, sessions, notes
data/uploads/             created at runtime — uploaded images and documents
data/history/             created at runtime — per-note version sidecars
test/                     node:test suite (npm test)
```

## Android app

A native Android client lives in [`android-app/`](android-app/README.md) —
the signed APK is `android-app/FunshareNotes-v1.19.apk`. It connects to this
server's JSON API with the same accounts and notes as the website, and its
server address is configurable on the sign-in screen.

> **Server address on the phone:** the app defaults to
> `http://120.76.229.180:3000` (deploy doc "Route B": security group port
> 3000 open, service bound to `0.0.0.0`). The domain `funshare.site` is
> intercepted by Aliyun's ICP-filing check while the 备案 is pending; once
> it completes (or from an HK/international region server), switch the app
> to `https://funshare.site` in its settings.
