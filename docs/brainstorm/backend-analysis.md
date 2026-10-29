# Backend analysis — server.js (Personal Notes)

Brainstorm input, not a decision document, 2026-10-29.

- Source analysed in full: [server.js](server.js), 925 lines / 36,623 bytes (mtime 2026-10-26 17:46).
- Runtime shape: zero npm dependencies, Node >= 18, one HTTP process, one JSON file on disk (`data/notes.json`), uploads in `data/uploads/`.
- On-disk state inspected read-only: `data/notes.json` currently holds 1 user, 1 note, 1 stored session token (expired as of 2026-10-29), and **no** `folders`/`uploads` keys yet (they are in-memory defaults, see section 3.9).
- Line references are `server.js:<line>` and were verified by reading the file; client behaviour references `public/app.js` and `android-app/` where a contract depends on it.
- Effort legend: S = <= 1 day, M = 2-5 days, L = > 1 week, including tests, assuming one developer already familiar with the file and no new dependencies.

## 0. TL;DR

1. **25 `/api/*` routes** (method + path combinations), all hand-routed by an if-chain in `handleApi` (`server.js:447-802`), plus three non-API path classes: `GET /uploads/<name>` (`server.js:847-887`), `GET /share/<token>` served as the SPA shell (`server.js:900-901`), and static files (`server.js:807-826`, `server.js:902`).
2. Every write mutates one in-memory object `db` (`server.js:82`) and then calls `saveDb()`, which serialises the **entire** object and atomically renames a temp file over `data/notes.json` (`server.js:157-175`). There is no database, no index, no query layer, no migration framework.
3. Auth is one HttpOnly cookie (`notes_session`), sessions live inside the same JSON file in plaintext, and "admin" is a boolean on the user object checked ad hoc per route (`server.js:753`, `server.js:763`, `server.js:779`, `server.js:794`).
4. The backend has no revision history, trash, delta sync, conflict detection, pagination, server-side search, tags-as-data, upload management API, storage quota, API tokens, webhooks, reminders, email, or server-side backup. These are the growth areas.
5. The five things most likely to bite a new feature: whole-file rewrite cost (section 4.2), the `loadDb` whitelist that silently discards unknown top-level keys on restart (`server.js:120-127`), the 2 MB JSON body cap (`server.js:38`), pruning of uploads by scanning note text (`server.js:260-279`), and the fire-and-forget save with swallowed errors (`server.js:154-175`).
6. Biggest surprises found: a corrupt `notes.json` makes the server start empty and the next mutation **overwrites the original file** (`server.js:149-151` + `server.js:157-175`); `.md` uploads are accepted by the sniffer but excluded from the served/name allowlist, so they can never be read or pruned (`server.js:41-42` vs `server.js:210`); any signed-in user can fetch any upload whose random name they know (`server.js:849`); and the web client still calls a non-existent `/api/setup` (`public/app.js:502`).

## 1. Request pipeline

- `route()` is the single entry point (`server.js:891-903`): it parses the URL, `decodeURIComponent`s the pathname (`server.js:893`), and dispatches: `/api/*` -> `handleApi`, `/uploads/*` -> `serveUpload`, any non-GET -> 405 JSON (`server.js:897-899`), `/share/*` -> SPA shell (`server.js:901`), everything else -> static file.
- `handleApi` is a linear if-chain. Public routes (`/api/session`, `/api/share/:token`, `/api/register`, `/api/login`, `/api/logout`) are evaluated first; then a single auth gate `if (!user) return 401` (`server.js:542`); everything after requires a session. Admin checks are inline per route, not middleware.
- Errors: handlers throw `HttpError(status, message)` (`server.js:73-78`); the top-level catch maps `instanceof HttpError` to its status, everything else to 500, and includes `err.message` in the JSON body (`server.js:908-913`). There is no request id, no structured logging, only `log()` with a timestamp (`server.js:84-86`).
- Responses always JSON via `sendJson` with `Cache-Control: no-store` (`server.js:404-407`). Note that API responses do **not** get `SECURITY_HEADERS` (`server.js:65-71`); static files and uploads do.
- Request bodies: `readJson` (`server.js:433-443`) enforces object-rooted JSON and `BODY_LIMIT`; uploads use the raw body with a custom `X-File-Name` header instead of multipart (`server.js:591-609`).

## 2. Complete API inventory (25 routes)

Auth legend: **none** = no session; **session** = valid `notes_session` cookie required (401 otherwise, `server.js:542`); **admin** = session + `isAdmin === true` (403 otherwise).

### 2.1 Public / auth entry points

| # | Method + path | Auth | Request | Response | Lines / purpose |
|---|---|---|---|---|---|
| 1 | `GET /api/session` | none | - | `{needsSetup, authenticated, user: publicUser\|null, registrationOpen}` | `server.js:450-458`; bootstrap probe also used as deploy health check (`deploy/update.sh`) |
| 2 | `GET /api/share/:token` | none, 32-hex share token in path | - | `{title, content, updatedAt}`; 404 `{error:'This link is no longer valid'}` | `server.js:462-467`; read-only public view, deliberately omits tags/author (`server.js:466`) |
| 3 | `POST /api/register` | none | `{username, password}` | 201 `{user: publicUser}` + `Set-Cookie`; 400/403/409/429 | `server.js:469-509`; first account becomes admin and bypasses the registration-open check (`server.js:475-478`, `server.js:501`) |
| 4 | `POST /api/login` | none | `{username, password}` | 200 `{user: publicUser}` + `Set-Cookie`; 401 `{error}`; 429 lockout | `server.js:511-529` |
| 5 | `POST /api/logout` | none (cookie optional) | - | `{ok:true}` + cookie cleared | `server.js:533-539`; handled before the auth gate so expired sessions can still log out |

### 2.2 Authenticated (session) routes

| # | Method + path | Request | Response | Lines / purpose |
|---|---|---|---|---|
| 6 | `POST /api/logout-all` | - | `{ok:true}` + cookie cleared | `server.js:544-550`; deletes every session of the account |
| 7 | `POST /api/password` | `{current, next}` | `{ok:true}`; 403/400 | `server.js:552-572`; re-hashes and kills all other sessions (`server.js:565-568`) |
| 8 | `DELETE /api/account` | `{password}` (JSON body on DELETE) | `{ok:true}` + cookie cleared; 403/400 | `server.js:574-587`; last-admin self-delete blocked (`server.js:580-582`) |
| 9 | `POST /api/uploads` | raw binary body, `X-File-Name` header (percent-encoded or legacy latin-1), 25 MB cap | 201 `{url:'/uploads/<32hex>.<ext>'}`; 400/413 | `server.js:591-609`; magic-byte sniffing, client name never trusted |
| 10 | `GET /api/folders` | - | `{folders:[folder + noteCount]}` | `server.js:613-620`; own folders in stored order |
| 11 | `POST /api/folders` | `{name}` | 201 `{folder:{...,noteCount:0}}`; 400/409 | `server.js:622-635`; 100-folder cap (`server.js:623`) |
| 12 | `POST /api/folders/reorder` | `{ids:[...]}` (must be a permutation of own folder ids) | `{ok:true}`; 400 | `server.js:639-652`; rewrites the global folder array as `[...mine in ids order, ...others]` (`server.js:647-649`) |
| 13 | `POST /api/folders/:id/pin` | `{pinned:bool}` | `{folder}`; 404 | `server.js:655-663`; sets/clears `folder.pinned` |
| 14 | `PUT /api/folders/:id` | `{name}` | `{folder}`; 400/404/409 | `server.js:665-678`; rename with case-insensitive duplicate check |
| 15 | `DELETE /api/folders/:id` | - | `{ok:true}`; 404 | `server.js:679-687`; notes are unfiled (`folderId=null`), not deleted (`server.js:681-683`) |
| 16 | `GET /api/notes` | - | `{notes:[note]}` sorted pinned-first, then `updatedAt` desc | `server.js:691-696`; **full content of every note, no pagination/delta/filter** |
| 17 | `POST /api/notes` | `{title, content, tags, pinned, folderId?}` | 201 `{note}`; 400 note cap | `server.js:698-709`; 5000-note cap (`server.js:44`, `server.js:699`) |
| 18 | `PUT /api/notes/:id` | same fields; full replace | `{note}`; 404 | `server.js:711-724`; `Object.assign` overwrite (`server.js:717`), `folderId` only touched when present (`server.js:721`) |
| 19 | `DELETE /api/notes/:id` | - | `{ok:true}`; 404 | `server.js:725-730`; hard delete + async upload prune (`server.js:728`) |
| 20 | `POST /api/notes/:id/share` | - | `{share:{token,createdAt}, url:'/share/<token>'}`; 404 | `server.js:734-743`; rotating a link replaces the previous token (`server.js:739`) |
| 21 | `DELETE /api/notes/:id/share` | - | `{ok:true}`; 404 | `server.js:744-747`; revocation sets `note.share = null` |

### 2.3 Admin routes

| # | Method + path | Request | Response | Lines / purpose |
|---|---|---|---|---|
| 22 | `GET /api/users` | - | `{users:[publicUser + noteCount], registrationOpen}`; 403 | `server.js:752-759` |
| 23 | `DELETE /api/users/:id` | - | `{ok:true}`; 400/403/404 | `server.js:761-775`; deletes the user's notes and sessions, prunes uploads (`server.js:196-203`) |
| 24 | `POST /api/users/:id/admin` | `{admin:bool}` | `{user: publicUser}`; 400/403/404 | `server.js:777-791`; last-admin demotion blocked (`server.js:784-786`) |
| 25 | `POST /api/settings/registration` | `{open:bool}` | `{registrationOpen}`; 403 | `server.js:793-800`; the only persisted setting |

Fallbacks: unknown authenticated path -> 404 `{error:'Not found'}` (`server.js:802`); unauthenticated protected path -> 401 (`server.js:542`); non-GET outside `/api` and `/uploads` -> 405 (`server.js:897-899`). Unsupported methods on a known resource (e.g. `GET /api/notes/:id`, `POST /api/notes/:id`) fall through to the 404 fallback rather than 405.

### 2.4 Non-API paths

| Path | Auth | Behaviour | Lines |
|---|---|---|---|
| `GET /uploads/<32hex>.<ext>` | session cookie **or** `?s=<share token>` restricted to files referenced by the shared note | streams the file with `Cache-Control: public, max-age=31536000, immutable`, correct MIME; 401/404 otherwise | `server.js:847-887` |
| `GET /share/<token>` | none | serves `public/index.html` (client renders the public note and calls `/api/share/<token>`) | `server.js:900-901`, `public/app.js:1955` |
| `GET /*` | none | static file from `public/`, path-traversal guarded, `no-store` | `server.js:807-826`, `server.js:902` |
| any non-GET | - | 405 JSON | `server.js:897-899` |

### 2.5 Contract conventions a new endpoint must follow

- JSON in and out; errors are `{error: string}` with meaningful status (400/401/403/404/409/413/429).
- Protected routes must appear after the auth gate at `server.js:542`; admin routes add their own `isAdmin` check in the handler (no middleware).
- Mutations must call `saveDb()` before responding (20 call sites in the file); no implicit persistence.
- `PUT` means full replacement, not patch (`server.js:717`). `DELETE /api/account` still reads a JSON body.
- Response resources are the stored objects verbatim (`note`, `folder`), so new fields leak to all clients unless stripped; `publicUser` (`server.js:283`) is the only projection helper.
- No CORS headers, no OPTIONS handler, no API versioning, no `Location` header on 201.

## 3. Data model

### 3.1 Files and directories

- Data dir: `DATA_DIR` env or `<repo>/data` (`server.js:31`); DB file `notes.json` (`server.js:32`); uploads `data/uploads/` (`server.js:40`). Both created lazily (`server.js:165`, `server.js:603`).
- Layout produced by the server:
  - `data/notes.json` — pretty-printed JSON (`JSON.stringify(db, null, 2)`, `server.js:167`), replaced via `notes.json.tmp` + `rename` (`server.js:166-168`).
  - `data/notes.json.tmp` — transient only.
  - `data/uploads/<32 lowercase hex>.<canonical-ext>` — one file per upload, random name, never reused (`server.js:602-604`).
- Nothing else is written. There is no log file, no lock file, no cache dir.

### 3.2 Top-level `db` object (`server.js:82`, normalised at `server.js:120-127`)

```
{
  users:    [user],                 // server.js:495-503, 107-115
  sessions: { <token>: session },   // server.js:314
  settings: { registrationOpen: bool }, // server.js:82, 123, 796
  notes:    [note],                 // server.js:705
  folders:  [folder],               // server.js:631
  uploads:  { <filename>: upload }  // server.js:605
}
```

`loadDb` constructs this object from a **whitelist** (`server.js:120-127`); any other top-level key in the file is dropped. Any feature that adds a new collection must add it to both the default object and `loadDb`, otherwise the data vanishes on the next restart (see F2).

### 3.3 `user`

| Field | Type / rule | Source |
|---|---|---|
| `id` | UUID v4 string | `server.js:496` |
| `name` | original casing, 3-32 chars `[A-Za-z0-9_.-]` | `server.js:51`, `server.js:484` |
| `nameKey` | lowercased name for lookup | `server.js:498`, `server.js:191-194` |
| `salt` | 16 random bytes, 32 hex chars | `server.js:180` |
| `hash` | scrypt(password, salt, 64), 128 hex chars | `server.js:181`, `server.js:186` |
| `isAdmin` | boolean; true for the first account only at creation | `server.js:501` |
| `createdAt` | `Date.now()` ms | `server.js:502` |

Public projection (`server.js:283`): `{id, name, isAdmin, createdAt}` — salt/hash/nameKey never leave the server. Load validation only requires `id`, `name`, `salt`, `hash` (`server.js:88-91`); `nameKey` is optional and falls back via `u.name.toLowerCase()` (`server.js:193`).

### 3.4 `session`

- Stored as a map keyed by the bearer token: `sessions[token] = {uid, exp}` (`server.js:312-316`).
- Token: 32 random bytes as 64 hex chars (`server.js:313`); TTL 7 days (`server.js:37`).
- Cookie `notes_session`; `Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`, plus `Secure` when the request looks HTTPS (`server.js:306-322`).
- Load-time pruning drops malformed, expired, or orphaned sessions (`server.js:129-137`).
- Sessions are stored **in plaintext** in `notes.json`; they also live in every backup/export of the data dir.
- No cap on sessions per user; `login` adds one, `password`/`logout-all` clear the others (`server.js:565-568`, `server.js:544-550`).

### 3.5 `settings`

Only `registrationOpen: boolean` (`server.js:82`, `server.js:123`), toggled by the admin (`server.js:793-800`). Defaults to open unless the stored value is exactly `false` (`server.js:123`). There is no other server setting (no site name, no upload policy, no quota, no email).

### 3.6 `folder`

`{id: UUID, userId: string, name: string, createdAt: ms, pinned?: boolean}` (`server.js:631`; `pinned` only added by `POST /api/folders/:id/pin`, `server.js:660`).

- `name` is `str(body.name, 128).trim().slice(0, 64)` (`server.js:627`, `server.js:671`), i.e. capped at 64 chars, no other validation.
- Duplicate names are case-insensitive per user (`server.js:629`, `server.js:673`).
- Max 100 per user (`server.js:45`, `server.js:623`).
- `noteCount` is computed on read (`server.js:618`), not stored.

### 3.7 `note`

| Field | Type / rule | Source |
|---|---|---|
| `id` | UUID v4 | `server.js:705` |
| `userId` | owner; always set by the server | `server.js:705` |
| `folderId` | string or `null`; **absent** on notes created before folders or by older clients | `server.js:705`, `server.js:721` |
| `title` | string, trimmed, silently truncated to 500 chars | `server.js:389` |
| `content` | string, silently truncated to 1 MiB | `server.js:390` |
| `tags` | up to 50 unique strings, each trimmed and truncated to 32 chars | `server.js:376-385` |
| `pinned` | boolean, only `true` counts | `server.js:392` |
| `createdAt` | ms | `server.js:705` |
| `updatedAt` | ms, refreshed on every PUT even if nothing changed | `server.js:705`, `server.js:717` |
| `share` | absent, `null` (after revoke), or `{token: 32 hex, createdAt: ms}` | `server.js:739`, `server.js:744` |

`sanitizeNote` (`server.js:387-394`) is the only schema enforcement on write; it silently coerces/truncates rather than rejecting. `isNoteShape` on load only requires `id` (`server.js:93`), so hand-edited or future-version records can carry arbitrary types (see F14). `updatedAt` is server time, not client time; there is no revision counter and no last-writer identity.

### 3.8 `uploads` map and `uploads/` conventions

- DB metadata: `uploads[filename] = {original: string, size: bytes, by: userId, at: ms}` (`server.js:605`). `original` is decoded from `X-File-Name` (`server.js:242-256`), sanitised (`\r\n"\\/` -> space), trimmed, truncated to 160 chars (`server.js:596-597`). It is display-only metadata; the stored name is random.
- File naming: `crypto.randomBytes(16).toString('hex') + '.' + ext` (`server.js:602`), so 32 lowercase hex + canonical extension. `UPLOAD_NAME_RE = ^[a-f0-9]{32}\.(png|jpe?g|gif|webp|pdf|docx?|pptx?|xlsx?|txt|csv|zip|odt|odp|ods)$` (`server.js:41-42`).
- Type detection is by magic bytes, never the client name/content-type (`server.js:212-235`):
  - `png`, `jpg`, `gif`, `webp`, `pdf` from their signatures.
  - ZIP container (`PK\x03\x04`): trusts a plausible provided extension from `docx/pptx/xlsx/odt/odp/ods`, else stores as `.zip` (`server.js:222-225`).
  - OLE2 container: provided `doc/ppt/xls`, else `.doc` (`server.js:226-229`).
  - Any file with no NUL/control bytes is treated as text: provided `txt/csv/md`, else `.txt` (`server.js:230-233`).
  - Everything else -> `null` -> 400 (`server.js:599-601`).
- Serving: `GET /uploads/<name>` requires a valid session, or a share token `?s=` whose note content contains the filename (`server.js:847-857`); the filename regex is re-checked (`server.js:864`) and the file read from disk (`server.js:869-876`). Cache headers are immutable because names are never reused (`server.js:880-885`).
- Orphan pruning: after a note delete (`server.js:728`) or account delete (`server.js:202`), `pruneOrphanUploads` (`server.js:260-279`) scans **all** notes' `content` for `/uploads/<32hex>.<ext>` URLs, then deletes files on disk whose names match `UPLOAD_NAME_RE` and are unreferenced, and drops their `db.uploads` entries. Files not matching the regex are never pruned; DB records whose files are missing are never removed.

### 3.9 Schema drift observed on disk

`data/notes.json` (1,054 bytes) currently contains `users` (1), `sessions` (1 token, expired as of 2026-10-29 but still in the file because load-time pruning at `server.js:129-137` is only persisted on the next mutation), `settings.registrationOpen=true`, and `notes` (1: `title`, `content`, `tags:["test","beta","demo"]`, `pinned:false`, `createdAt`, `updatedAt`). It has **no** `folders` and no `uploads` keys, and the note has no `folderId`/`share` field. The server fills those with defaults at load (`server.js:120-127`), which is why legacy/partial files keep working. The file also demonstrates that sessions are stored as plaintext bearer tokens next to scrypt hashes.

### 3.10 Constants and caps (single source of truth)

| Constant | Value | Line |
|---|---|---|
| `PORT` | 3000 (env `PORT`) | `server.js:29` |
| `HOST` | `0.0.0.0` (env `HOST`) | `server.js:30` |
| `DATA_DIR` | `./data` (env `DATA_DIR`) | `server.js:31` |
| `TRUST_PROXY` | env `TRUST_PROXY === '1'` | `server.js:34` |
| `SESSION_COOKIE` | `notes_session` | `server.js:36` |
| `SESSION_TTL_MS` | 7 days | `server.js:37` |
| `BODY_LIMIT` | 2 MB — all JSON request bodies, incl. note content + metadata | `server.js:38` |
| `UPLOAD_LIMIT` | 25 MB per uploaded file | `server.js:39` |
| `SHARE_TOKEN_RE` | `^[a-f0-9]{32}$` (128-bit) | `server.js:43` |
| `MAX_NOTES_PER_USER` | 5000 | `server.js:44` |
| `MAX_FOLDERS_PER_USER` | 100 | `server.js:45` |
| `MAX_USERS` | 100 | `server.js:46` |
| `LOGIN_MAX_FAILURES` | 5 | `server.js:47` |
| `LOGIN_LOCK_MS` | 15 minutes | `server.js:48` |
| `REGISTER_MAX_PER_HOUR` | 5 per IP | `server.js:49` |
| `USERNAME_RE` | `^[A-Za-z0-9_.-]{3,32}$` | `server.js:51` |
| Title cap | 500 chars | `server.js:389` |
| Content cap | 1 MiB | `server.js:390` |
| Tags | 50 tags x 32 chars, deduped | `server.js:379-382` |
| Folder name cap | 64 chars | `server.js:627`, `server.js:671` |
| Original upload name | 160 chars | `server.js:596` |
| Password length | 8-1024 chars | `server.js:488`, `server.js:559` |

## 4. Architectural constraints any new feature must respect

### 4.1 Zero npm dependencies

Only `http`, `fs/promises`, `path`, `crypto` are imported (`server.js:22-25`); `package.json` has no dependencies and only a `start` script. Every feature must be built from the standard library: SSE can use `res.write`, but WebSocket needs a manual HTTP upgrade parser; SMTP needs `net`/`tls`; ZIP needs `zlib` plus a hand-written central directory; multipart parsing is manual; no JWT library; hashing is `crypto.scryptSync`/`createHash`.

### 4.2 Single JSON file, in-memory DB, whole-file rewrite

- `db` is one in-memory object (`server.js:82`); the only persistence primitive is `saveDb()` (`server.js:154-175`): pretty-print the whole object, write `notes.json.tmp`, `rename` over `notes.json`.
- Writes are coalesced while one is running (`saveQueued`/`saveRunning`, `server.js:155-175`), but each save is still O(total DB bytes) and CPU-synchronous (`JSON.stringify` blocks the event loop).
- Worst case per account: 5,000 notes x 1 MiB content (`server.js:44`, `server.js:390`) => ~5 GB of JSON serialised per save, and every login and registration triggers one (`server.js:526`, `server.js:506`). Real deployments are far smaller, but this is the hard ceiling.
- `saveDb` is fire-and-forget: handlers respond before the disk write completes; errors are only `console.error` (`server.js:170-171`); there is no `fsync`. Durability of a 200 response is "queued, not confirmed".
- New features must not save more often than the mutation itself, must not add collections that are rewritten on every keystroke, and should consider `await`-able flush before restart/backup.

### 4.3 Request size limits

`BODY_LIMIT` (2 MB, `server.js:38`) is applied by `readBody` (`server.js:409-431`) to every JSON endpoint: note create/update, import, etc. A batch import or a Markdown file over 2 MB needs an explicit per-route limit override (`readBody(req, limit)` already supports it) plus a streaming path. Uploads use `UPLOAD_LIMIT` 25 MB (`server.js:39`, `server.js:592`), raw body, no multipart. The 1 MiB content cap (`server.js:390`) is per note and silently enforced by truncation, not 413.

### 4.4 Single process, single event loop

- One `http.createServer` (`server.js:906-914`), no cluster/worker threads, no IPC. All in-memory state (db, throttle maps at `server.js:341` and `server.js:359`, sessions) dies on restart. Rate limits reset on deploy.
- CPU-heavy work blocks everything: `crypto.scryptSync` on login/register/password (`server.js:181`, `server.js:186`) and `JSON.stringify` on every save (`server.js:167`). A search index build, export zip, or backup copy must be chunked or accepted as a stall.
- Long-lived connections (SSE/WebSocket) live in the same process and must be tracked and cleaned; there are no server timeouts configured beyond Node defaults.
- Graceful shutdown: only `SIGINT` calls `process.exit(0)` immediately (`server.js:922-925`); there is no `SIGTERM` handler (systemd stop uses SIGTERM) and no drain of `saveDb`. A feature that queues writes must add shutdown flushing.

### 4.5 No indexes, no query layer

Every lookup is a linear `Array.find`/`filter`/`sort`:

| Operation | Code | Cost |
|---|---|---|
| Session -> user | `server.js:335` | O(users) |
| Note by id (owner-scoped) | `server.js:713` | O(notes) |
| Notes list | `server.js:692-694` | O(notes log notes), returns full content |
| Folder list + counts | `server.js:616-618` | O(folders x notes) |
| Admin user list + counts | `server.js:754-757` | O(users x notes) |
| Share token -> note | `server.js:464`, `server.js:853` | O(notes) |
| Save | `server.js:167` | O(DB bytes) |

There is no pagination, no `updatedSince`, no ETag, no field selection. Any server-side search or ranking is O(total content) per query unless the feature adds its own index structure (which then must live in memory and be rebuilt on load, or it will be rewritten into `notes.json` on every save).

### 4.6 Manual persistence and migrations

- Handlers call `saveDb()` explicitly after mutating `db` (`server.js:506`, `server.js:526`, etc.); a new endpoint that forgets it will appear to work and silently lose data on restart.
- There is no migration framework. `loadDb` (`server.js:97-152`) is the de-facto schema authority: it validates/normalises users, sessions, notes, folders; migrates the legacy `parsed.auth` single-password format (`server.js:106-118`); and drops unknown top-level keys (`server.js:120-127`). New fields can be added to existing objects, but new top-level collections must be registered there or they are discarded.
- Load-time normalisation mutates in place but does not immediately save; the normalised shape is only persisted on the next mutation.

### 4.7 Auth and transport model

- Cookie-only sessions (`server.js:295-338`); no `Authorization` support, no API keys, no CSRF token (SameSite=Strict is the mitigation, `server.js:319`). The Android client uses the same cookie flow (`android-app/.../Api.kt`).
- `TRUST_PROXY` only affects `clientIp` (`server.js:287-293`); `isSecure` trusts `X-Forwarded-Proto` unconditionally (`server.js:306-310`). TLS is always terminated by a reverse proxy (`deploy/Caddyfile`); the Node server itself is plain HTTP.
- Admin is a boolean, not a role; checks are duplicated in each admin handler (`server.js:753`, `server.js:763`, `server.js:779`, `server.js:794`).

### 4.8 Hand-rolled routing and response conventions

- If-chain ordering matters (`server.js:447-802`): `/api/folders/reorder` must be matched before `/api/folders/:id`; `/api/notes/:id/share` must be matched after the single-segment regex (which is safe because `[^/]+` cannot span `/`).
- A matched resource with an unsupported method falls through to the 404 fallback, not 405; new methods must be added as explicit branches.
- JSON responses bypass `SECURITY_HEADERS` (`server.js:404-407` vs `server.js:65-71`); static/uploads set CSP and friends.
- Client compatibility is a live constraint: the web app and a shipped Android APK both talk to this API, and the Android client predates folders — hence the `'folderId' in body` guard on PUT (`server.js:718-721`). Any new note field must use the same "only touch when present" pattern or old clients will wipe it.

## 5. Backend feature opportunities (18)

Each idea lists: **Idea**, **Why it fits / matters**, **Endpoints changed**, **Effort**, **Risk**. "New" endpoints are additions; existing contract changes are called out.

### 5.1 Note revision history / snapshots

- **Idea:** append a compact snapshot of the previous title/content/tags/pinned on every `PUT /api/notes/:id`, keep the last N revisions per note, and expose list/view/restore. Optionally debounce snapshots (e.g. at most one per 10 minutes while typing) to avoid one row per autosave.
- **Why it fits:** autosave plus full-replacement PUT (`server.js:715-724`) means one bad or partial save destroys content irrecoverably; the app already promises "your data is one file", so undo history is the natural next step and also powers "conflict copy" recovery.
- **Endpoints changed:** `PUT /api/notes/:id` (capture before overwrite), new `GET /api/notes/:id/revisions`, `GET /api/notes/:id/revisions/:rev`, `POST /api/notes/:id/restore`; new top-level `db.revisions` (or `note.revisions`) must be added to `loadDb` (`server.js:120-127`).
- **Effort:** M.
- **Risk:** DB growth is quadratic-ish with editing (content up to 1 MiB x revisions x 5,000 notes) and every save rewrites all of it (`server.js:167`); `pruneOrphanUploads` only scans `note.content` (`server.js:264-269`), so upload references that exist only in a snapshot would be deleted — the ref scan must include revisions or pruning will corrupt history. Needs retention/compaction and a cap per note.

### 5.2 Soft delete, trash, restore, and retention

- **Idea:** replace hard delete (`server.js:725-730`) with `deletedAt`/`trashedAt`; `GET /api/notes` excludes trashed by default; add trash listing, restore, permanent delete, and an auto-purge after a configurable retention window (e.g. 30 days). Owner-visible "Empty trash".
- **Why it fits:** delete is immediate and irreversible; mobile autosave and share links make accidental deletion likely; a trash is the cheapest safety net, and retention logic is a prerequisite for any later quota work.
- **Endpoints changed:** `DELETE /api/notes/:id` (soft by default, `?purge=1` for hard), `GET /api/notes?trash=1` (or `GET /api/trash`), `POST /api/notes/:id/restore`, `POST /api/trash/empty`; `GET /api/notes` sorting/filtering; share lookup must treat trashed notes as gone (`server.js:464`).
- **Effort:** M.
- **Risk:** `MAX_NOTES_PER_USER` (`server.js:699`) now counts trash or not — both choices surprise someone; `pruneOrphanUploads` scans all `db.notes` (`server.js:264-269`), so if trashed notes stay in `db.notes`, their uploads survive (good) but a retention purge must then re-run pruning; old clients still expect hard-deleted notes to disappear (they do if filtered); share links to trashed notes must 404; `updatedAt` sort and admin `noteCount` (`server.js:756`) need a trash decision.

### 5.3 Delta sync: `updatedSince`, pagination, tombstones

- **Idea:** `GET /api/notes?since=<ms>&limit=<n>&cursor=<opaque>` returns `{notes, nextSince, hasMore, serverTime, deleted:[ids]}`; clients persist the cursor and fetch only changes. Keep the no-parameter behaviour byte-compatible for the Android app.
- **Why it fits:** today every start/refresh re-downloads every note with full content (`server.js:691-696`), which is the main scaling wall (5,000 x 1 MiB worst case) and blocks offline-first clients. The server already has `updatedAt` on every note, so this is mostly a contract change.
- **Endpoints changed:** `GET /api/notes` (query params + response envelope), plus a tombstone source (needs 5.2 soft delete, or a retained id list). Sorting/pagination must be stable across `updatedAt` ties.
- **Effort:** M.
- **Risk:** ms-resolution `Date.now()` means two writes can share a timestamp (`server.js:717`); the sort is pinned-first then `updatedAt` (`server.js:694`), so "since" must be computed against a stable cursor, not array order; deletions currently leave no trace and a purge would erase tombstones. Breaking the no-param response shape would break the shipped Android client.

### 5.4 Optimistic concurrency / conflict detection

- **Idea:** add a per-note monotonic `rev`; `PUT /api/notes/:id` accepts `rev` (or `If-Match`); mismatch returns 409 with the current note and optionally creates a "conflict copy". Web and Android can then detect simultaneous edits instead of silently last-writer-wins.
- **Why it fits:** two first-class clients (web + Android, plus multiple browsers) write whole notes; offline drafts exist in Android; `PUT` overwrites unconditionally today (`server.js:715-724`), so simultaneous edits lose data with no warning.
- **Endpoints changed:** `PUT /api/notes/:id`, `POST /api/notes` (return `rev`), `GET /api/notes` (expose `rev`); restore/import/trash operations must bump `rev`; old clients that omit it need a compatibility mode.
- **Effort:** S-M.
- **Risk:** shipped Android client sends no `rev` — a strict server breaks it, a lenient server keeps the bug; conflict UI/UX is client work; `rev` must survive export/import and restore; 409 handling must be added to both clients; `sanitizeNote` must not strip it.

### 5.5 ETags / conditional GET on list and share endpoints

- **Idea:** emit a strong `ETag` (hash of note ids + `updatedAt`s + counts, or per-note) and support `If-None-Match` -> 304 on `GET /api/notes`, `GET /api/share/:token` and `GET /api/folders`; add `Last-Modified`/`If-Modified-Since`.
- **Why it fits:** cheap incremental improvement; polling clients currently re-download everything; 304s are free once an ETag is computed from fields already in memory. Pairs naturally with delta sync but ships independently.
- **Endpoints changed:** `GET /api/notes`, `GET /api/share/:token`, maybe `GET /api/folders` (headers only, no body change).
- **Effort:** S.
- **Risk:** an accurate ETag still scans all notes (O(n)) and per-note ETags would require a single-note GET that does not exist today; `Cache-Control: no-store` (`server.js:405`) is currently set globally, so the ETag feature must selectively relax it; array-order/tie instability yields false "changed" responses; shared-note ETags expose update timing (minor).

### 5.6 Account-to-account note/folder sharing with permissions

- **Idea:** per-note (and optionally per-folder) grants to specific accounts: `viewer`/`editor`; a "shared with me" view; keep public capability links as the anonymous path. Editor writes must bump the same rev/conflict machinery as 5.4.
- **Why it fits:** the app is explicitly multi-account (`MAX_USERS=100`, `server.js:46`) but every account is a hard silo (`server.js:693`, `server.js:713`); public links are the only sharing and they are anonymous, read-only, title/content only (`server.js:466`). Family/team self-hosting is the obvious use case.
- **Endpoints changed:** new `POST/DELETE /api/notes/:id/access` (and folder equivalent), `GET /api/notes/shared`, owner/permission checks in `GET/PUT/DELETE /api/notes/:id`, `GET /api/folders`, upload serving (`server.js:847-857`), and `pruneOrphanUploads` refs. New top-level `db.grants` must be added to `loadDb`.
- **Effort:** M-L.
- **Risk:** ACL checks must be added to every note/folder lookup; a single missed check leaks notes; share-token access (`server.js:464`, `server.js:853`) already bypasses ownership for one note, so the two sharing models can collide; account deletion cascade (`server.js:196-203`) must clean grants; folder `noteCount` (`server.js:618`) and admin counts (`server.js:756`) need a "visible to me" definition; the Android client assumes "my notes only".

### 5.7 Collaborative editing (real-time-ish)

- **Idea:** SSE channel per note (`GET /api/notes/:id/events`) plus coarse op/lock semantics: `POST /api/notes/:id/lock` (lease with TTL) or last-writer-wins with `rev`, presence/cursor broadcast, and client refetch on change. Full CRDT/OT is explicitly out of scope for a stdlib-only server.
- **Why it fits:** multi-device is already the product; SSE is achievable with `res.write` while a real WebSocket implementation needs manual upgrade framing (doable, but a bigger lift). Combined with 5.4 it prevents the classic two-tab overwrite.
- **Endpoints changed:** new SSE `GET /api/notes/:id/events`, `POST /api/notes/:id/lock` (or reuse PUT with `rev`), event emission inside note handlers; no DB change if events are ephemeral.
- **Effort:** L.
- **Risk:** each open SSE holds a socket/file descriptor in the single process; no cross-process pub/sub; reverse proxies buffer SSE unless configured; Node/server/proxy idle timeouts need heartbeats; autosave PUTs still race; auth must be checked at connect (cookie) and connections invalidated on logout/password change; CSRF for event POSTs; admin/proxy timeouts; long-lived connections complicate graceful shutdown.

### 5.8 Server-side search index

- **Idea:** `GET /api/search?q=&tag=&folder=&pinned=&limit=&cursor=` scanning note fields server-side, optionally maintaining an in-memory inverted index (token -> note ids) rebuilt at startup and updated on every note write. Do not persist the index in `notes.json`.
- **Why it fits:** search is currently client-side (README:36) because `/api/notes` ships every note; on mobile that is slow and memory-hungry; a server endpoint also enables ranking (5.9) and small result payloads. The data set is small enough for an in-memory index.
- **Endpoints changed:** new `GET /api/search`; optionally `GET /api/notes?q=`; no schema change if the index is ephemeral, but startup rebuild adds load-time cost (`server.js:97-152`).
- **Effort:** M.
- **Risk:** tokenisation must handle CJK (no spaces) — naive whitespace split fails for Chinese notes, which this codebase likely has; index memory can approach DB size; every write must update the index or it goes stale; linear fallback is O(total content) per keystroke and blocks the event loop; query rate limiting is absent.

### 5.9 Full-text ranking and snippets

- **Idea:** score title matches above tags above body, weight recency/pinned, return `{id, title, snippet, tags, updatedAt}` with match offsets instead of full content; highlight in the client.
- **Why it fits:** once search is server-side (5.8), ranking is what makes it useful; snippets also cut payload size dramatically vs. the current "download everything" model.
- **Endpoints changed:** response shape of `GET /api/search`; possibly `GET /api/notes?fields=summary` for lighter lists; no schema change.
- **Effort:** M.
- **Risk:** ranking must be hand-written (no FTS engine allowed); snippet extraction must not break on multi-byte characters; snippets must be escaped client-side (content is Markdown/HTML-escaped by the client renderer); scoring changes are hard to test without a corpus; performance per query is O(matches x content).

### 5.10 Tags as first-class entities

- **Idea:** `db.tags: [{id, userId, name, color, createdAt}]` with create/rename/merge/delete and counts; notes keep tag names (for backward compatibility) or migrate to ids; `GET /api/tags` powers autocomplete and the filter sidebar.
- **Why it fits:** tags are currently free strings attached per note (`server.js:376-385`); renaming or merging requires rewriting every note, there is no list endpoint, and the UI can only derive tags by scanning all notes.
- **Endpoints changed:** new `GET/POST /api/tags`, `PUT/DELETE /api/tags/:id`, `POST /api/tags/merge`; `sanitizeNote` must resolve/validate names; note PUT stays strings-compatible for the Android client; new top-level `db.tags` in `loadDb`.
- **Effort:** M.
- **Risk:** two sources of truth during migration (note.tags strings vs db.tags); case/whitespace duplicates already exist (sanitizer only trims/dedupes exact strings); deleting/renaming a tag rewrites many notes in one save; old clients sending arbitrary tag strings can resurrect deleted tags; export/import format changes.

### 5.11 Attachment management API and orphan GC

- **Idea:** `GET /api/uploads` (own uploads with size, original name, referencing note ids), `DELETE /api/uploads/:name` (refuse if referenced or detach), optionally `POST /api/uploads/:name/adopt` for shared transfers. Improve `pruneOrphanUploads`: ownership-aware, handle trash/revisions, remove `db.uploads` records whose file is missing, run a startup reconciliation and a periodic sweep.
- **Why it fits:** uploads are currently write-only from the client's perspective; orphans and stale DB records accumulate silently, the 25 MB cap is enforced only at upload time, and a quota feature (5.12) needs accurate accounting. The current prune only removes files whose names match the allowlist and are unreferenced (`server.js:260-279`).
- **Endpoints changed:** new `GET /api/uploads`, `DELETE /api/uploads/:name`; changes inside `pruneOrphanUploads` (`server.js:260-279`) and `serveUpload` (`server.js:847-887`).
- **Effort:** M.
- **Risk:** reference detection is a regex over note text (`server.js:265-269`), so it over-counts (a filename in a code block keeps a file alive) and under-counts (URL-encoded path, other base URL, references from trash/revisions if added); deleting a file that another account's note references is possible because any session can link any upload name; startup reconciliation must not delete files before the DB is loaded.

### 5.12 Per-account storage quotas and disk guard

- **Idea:** configurable bytes limit per account; compute usage as note content bytes + sum of `db.uploads.size` (only own uploads); reject note create/update and uploads over the limit with 413/507; expose usage in `GET /api/account/usage` and the admin user list; optional global free-space guard before accepting uploads.
- **Why it fits:** `UPLOAD_LIMIT` is per file only (`server.js:39`) and `MAX_NOTES` caps count, not size (`server.js:44`); one registered user can fill the disk with 25 MB files or 1 MiB notes, and there are up to 100 accounts (`server.js:46`). Disk exhaustion breaks the global `saveDb` for everyone (`server.js:167-171`).
- **Endpoints changed:** `POST /api/uploads`, `POST/PUT /api/notes`, new `GET /api/account/usage`, admin settings (extend `POST /api/settings/registration` or add `POST /api/settings`), `GET /api/users` (usage column).
- **Effort:** M.
- **Risk:** computing usage per write is O(notes + uploads); stale `db.uploads` records skew accounting; trash/revisions (5.1/5.2) must count or people game the quota; a failed upload at the limit triggers cleanup complexity; `ENOSPC` in `saveDb` is currently only logged (`server.js:170-171`) and would silently lose writes; quotas need admin configuration persisted in `settings` (currently one boolean, `server.js:82`).

### 5.13 Markdown + zip export/import

- **Idea:** `GET /api/export?format=md|zip` produces Markdown files per note plus a manifest and attachments (zip built from stdlib `zlib`); `POST /api/import` accepts that zip or the existing client JSON export, mapping folders and tags and creating notes/attachments transactionally. Per-note export too.
- **Why it fits:** the only export today is client-side JSON of `state.notes` + `state.folders` (`public/app.js:1649-1650`), no attachments and no import; README calls it a backup. Portable Markdown is the natural self-hosting exit hatch and enables migration from other tools.
- **Endpoints changed:** new `GET /api/export`, `POST /api/import` (large body, needs `readBody` override), plus internal reuse of note/folder/upload creation.
- **Effort:** M-L.
- **Risk:** `BODY_LIMIT` 2 MB blocks realistic imports (`server.js:38`, `server.js:409`); zip handling needs path-traversal protection and a hand-rolled writer/reader; many notes means many `saveDb` calls unless the handler batches one save; partial failure leaves half-imported data (no transactions); attachment binary handling and quotas; import must not let a client pick `userId`/`id` from the archive.

### 5.14 Personal API tokens for third-party clients

- **Idea:** `db.tokens` (hashed token, label, scopes, createdAt, lastUsedAt, expiresAt) with `GET/POST/DELETE /api/tokens`; accept `Authorization: Bearer <token>` in `getSession` as an alternative to the cookie; scopes `read`/`write`/`admin` (admin only for admin accounts).
- **Why it fits:** auth is cookie-only (`server.js:330-338`), so scripts/CLI/alternative clients must juggle cookies; tokens enable revocable integrations and pair well with webhooks/reminders/mobile clients. Hashing at rest also fixes the session-plaintext issue for new credentials.
- **Endpoints changed:** `getSession`/auth gate (`server.js:531-542`), new `/api/tokens` CRUD, `POST /api/password`/`logout-all` interplay (should tokens survive?), admin routes must reject non-admin tokens; new top-level `db.tokens` in `loadDb`.
- **Effort:** M.
- **Risk:** token format and timing-safe comparison; scopes must be enforced on every handler or a read token can write; admin flag escalation (a token for an admin is full admin — needs explicit UI warning); no CORS, so browser-based third-party clients still cannot call cross-origin; token leakage in logs/URLs; lookup must be O(1) (hash the token and key the map) not linear.

### 5.15 Webhooks / event feed

- **Idea:** user-configurable webhook URLs receiving `note.created|updated|deleted`, `share.created|revoked`, `folder.*` events with HMAC signature and idempotency id; plus `GET /api/events` audit feed. Delivery via `http`/`https` request with an in-memory retry queue (optionally persisted).
- **Why it fits:** self-hosters glue apps together (n8n, Home Assistant, backup jobs); a note change is a useful trigger, and the same event stream gives the app an audit log and future real-time clients.
- **Endpoints changed:** new `/api/webhooks` CRUD, event emission in note/folder/upload/auth handlers, `GET /api/events`; new top-level `db.webhooks`/`db.events` (or log file) in `loadDb`.
- **Effort:** M.
- **Risk:** SSRF (must block private/link-local targets and validate redirects); delivering must not block the request — fire-and-forget with bounded retries; retry persistence means new writes on the hot save path; ordering and duplicate delivery; secrets must be masked in responses/logs; webhook storms under bulk imports; single process means the queue is lost on restart unless persisted.

### 5.16 Reminders / scheduling

- **Idea:** `note.remindAt` + `reminderState`; `GET /api/reminders/upcoming`; a `setInterval` tick marks due reminders and delivers via webhook (5.15), email (5.17) or SSE, with snooze/dismiss endpoints. Catch-up on restart for missed reminders.
- **Why it fits:** notes with dates/pinned items are a natural reminder surface; zero-dependency scheduling is just timers; users already keep personal task lists in Markdown (README mentions task lists).
- **Endpoints changed:** `POST/PUT /api/notes/:id/reminder` (or fields on note PUT), `GET /api/reminders`, `DELETE /api/reminders/:id`; interval job at startup (`server.js:905-920`); note field must be preserved by `sanitizeNote`/PUT (see F8).
- **Effort:** L.
- **Risk:** no delivery channel exists without email/webhook/push — reminders without delivery are just a list; restart catch-up needs last-run bookkeeping persisted; time zones (server time vs user expectation) and DST; the tick must not rewrite the whole JSON per reminder (batch); `PUT` full-replace semantics would clear `remindAt` for old clients unless the "only if present" pattern is used (`server.js:718-721`).

### 5.17 Email: notifications, invites, password reset

- **Idea:** a stdlib SMTP client (`net`/`tls`) with settings for host/port/TLS/user/pass/from; password-reset tokens (hashed at rest, single-use, short expiry); optional new-account invite and "your share link was accessed" notices. Admin test-email endpoint.
- **Why it fits:** there is no password recovery at all today (README:142-145 tells users to delete and re-register), which is the sharpest operational gap for a self-hosted multi-account app; email also gives reminders and alerts a delivery path.
- **Endpoints changed:** new public `POST /api/password/forgot` and `POST /api/password/reset`, admin `POST /api/settings/email` + `POST /api/email/test`, token storage; `db.settings` grows beyond one boolean.
- **Effort:** L.
- **Risk:** writing SMTP/TLS/MIME by hand is error-prone (auth mechanisms, STARTTLS, encoding); blocking socket I/O must be async; credentials are secrets (env vs settings; never return them); email enumeration and reset-token brute force require rate limits and single-use hashed tokens; deliverability/spam; outbound network may be blocked on the VPS; adding a reset flow changes the account security model (`server.js:552-572`).

### 5.18 Backup automation

- **Idea:** admin-configurable periodic snapshot: flush pending saves, copy `notes.json` plus `uploads/` to `data/backups/<timestamp>/`, rotate last N, and expose `GET /api/backup/list` + `GET /api/backup/download` (admin, streaming tarball). Optional startup integrity check and "restore from snapshot" CLI.
- **Why it fits:** everything is one file and one directory; `deploy/update.sh` only backs up manually on deploy; a corrupt file currently starts an empty store and can be overwritten (F1), so automatic snapshots are the difference between a scare and data loss. The single-file design makes this feature cheap.
- **Endpoints changed:** new admin `POST /api/backup/run`, `GET /api/backup/list`, `GET /api/backup/download`; `settings.backup` (interval/retention); an interval job; `saveDb` needs an awaitable flush/`drain()` hook (`server.js:154-175`).
- **Effort:** M.
- **Risk:** copying `uploads/` while files are being written (upload write is a direct `writeFile`, `server.js:604` — a file can be mid-copy; random names make half-files identifiable but still need care); disk doubling; rotation errors; the DB snapshot must reflect exactly a flush boundary, not an in-flight save; backups contain password hashes and plaintext session tokens, so they must be admin-only and preferably encrypted; local backups do not protect against disk failure (offsite is out of scope without deps).

## 6. Fragility register: what is easy to break

Ordered roughly by blast radius. "New feature likely to hit it" is the warning for design work.

- **F1 - Corrupt DB silently becomes an empty DB, then gets overwritten.** `loadDb` catches parse errors, logs a warning, and leaves the default empty `db` (`server.js:97-152`). Because `needsSetup` is then true (`server.js:453`) and registration is allowed (`server.js:475`), a visitor can create the "first admin", and the next `saveDb()` writes the empty-plus-new-user object over the original file (`server.js:157-175`). No backup, no quarantine, no read-only mode. Any feature that writes at startup (indexes, migrations, backup jobs) makes this worse. *Fix prerequisite: rename the unreadable file to `notes.json.corrupt-<ts>` and refuse to start, or start read-only.*
- **F2 - `loadDb` whitelist discards unknown top-level keys.** `db` is rebuilt field by field (`server.js:120-127`); adding `db.revisions`, `db.tokens`, `db.grants`, etc. without editing this function means the data silently disappears on the next restart (and the next save persists the loss). Every new collection must be registered here and validated.
- **F3 - Writes are fire-and-forget and errors are swallowed.** Handlers respond before `saveDb` completes; write failures only `console.error` (`server.js:170-171`); no `fsync`; `SIGINT` exits immediately (`server.js:922-925`); there is no `SIGTERM` handler. A crash/restart inside the write window loses the last acknowledged mutation. Revision history and backups must not assume a 200 means durable.
- **F4 - `.md` uploads are accepted but unusable.** `sniffFile` can return `md` because `TEXT_DOC_EXTS` includes it (`server.js:210`, `server.js:230-233`), but `UPLOAD_EXT_RE`/`UPLOAD_NAME_RE` (`server.js:41-42`) and `UPLOAD_TYPES` (`server.js:830-839`) do not include `md`. The upload is stored as `<hex>.md`, the response returns `/uploads/<hex>.md`, serving then 404s (`server.js:864`), and pruning never touches it (`server.js:271`). A Markdown import feature will trip over this immediately.
- **F5 - Stale upload metadata is never reconciled.** The current `notes.json` has no `uploads` key at all, and a DB record whose file was removed out-of-band is never deleted because `pruneOrphanUploads` iterates disk files, not `db.uploads` (`server.js:260-279`). Quota accounting (5.12) and attachment management (5.11) must run a startup reconciliation.
- **F6 - Any authenticated user can read any upload by name.** `serveUpload` sets `allowed = !!user` (`server.js:849`) with no ownership lookup and no `db.uploads` check; names are random 128-bit, so it is a capability, but a URL pasted into a shared note, a browser history, or a log exposes the file to every account. The share-token path only checks `note.content.includes(name)` (`server.js:853-855`) — a substring test, so any occurrence of the filename anywhere in the shared note grants access (and serving is session-only for non-shared notes).
- **F7 - Pruning fights any feature that keeps note text alive elsewhere.** `pruneOrphanUploads` scans only current `db.notes[*].content` (`server.js:264-269`) and is invoked on every note delete and account delete (`server.js:728`, `server.js:202`). Trash (5.2) and revisions (5.1) keep old content; if their notes are excluded from `db.notes` or their refs are not scanned, deleting an unrelated note will delete attachments still referenced by trashed notes/history. Also deletion is global across accounts.
- **F8 - `PUT` is a full replace and truncates silently.** `Object.assign(note, sanitizeNote(body), {updatedAt})` (`server.js:717`) resets `title/content/tags/pinned` to defaults when omitted (`server.js:387-394`); over-cap content is truncated instead of rejected (`server.js:389-390`). Old clients only survive `folderId` because of the `'folderId' in body` guard (`server.js:721`). Any new note field must use the same guard, and any partial-save client can destroy a note.
- **F9 - Whole-file rewrite amplifies every mutation.** Login/session creation writes the entire DB (`server.js:526`); pretty-printed JSON (`server.js:167`); 5,000 notes x 1 MiB ceiling (`server.js:44`, `server.js:390`). Revision history, trash, tags-as-entities, and import must batch writes, or a login after a big import can stall the event loop and rewrite gigabytes.
- **F10 - The notes list is unbounded.** `GET /api/notes` returns every note with full content, sorted, no pagination (`server.js:691-696`); `GET /api/folders` computes counts with an O(folders x notes) nested filter (`server.js:616-618`); admin lists do the same (`server.js:754-757`). Search, delta sync, and mobile clients all need this split into summary/detail or paged endpoints, without breaking the current shape.
- **F11 - Rate limiting is in-memory, IP-only, and leaky in semantics.** `loginFailures` and `registerAttempts` maps grow per unique IP and reset on restart (`server.js:340-368`); behind a proxy without `TRUST_PROXY`, every user shares the proxy IP, so an attacker can lock out everyone (`server.js:287-293`); a failed registration counts toward the login lock (`server.js:348-356`), and the registration throttle consumes attempts even for requests that fail validation (`server.js:361-368`, `server.js:473`). New public endpoints (password reset, share views) need their own limits, not this map.
- **F12 - Uploads have no quota, no per-user accounting, and no disk check.** 25 MB per file, unlimited count, any account (`server.js:39`, `server.js:591-609`); the DB stores only metadata (`server.js:605`). Disk exhaustion manifests as a swallowed save error (`server.js:170-171`), which loses data for all users.
- **F13 - Share tokens are permanent capability URLs.** `note.share` has no expiry; rotating replaces the token (`server.js:739`), revocation sets `null` (`server.js:744`); the token is passed in URLs (`/share/<token>`, and `?s=` for uploads, `server.js:742`, `server.js:851-856`), so it can leak via logs/history; share responses expose only title/content/updatedAt (`server.js:466`). Adding permissions (5.6) must decide how capability links and account grants interact.
- **F14 - Load-time validation is shallow.** `isNoteShape` only checks `id` (`server.js:93`); a note with missing `content` makes `pruneOrphanUploads`'s regex throw (caught and logged, `server.js:268-278`) and would make the share path `note.content.includes` throw a 500 (`server.js:855`). Folder refs are repaired on load (`server.js:144-148`), but note fields are not. Imports and hand edits must go through `sanitizeNote`.
- **F15 - No account lifecycle tools.** No rename, no admin password reset, no admin note browsing, no "transfer notes"; admin can only list/promote/delete (`server.js:752-799`), and deleting a user erases their notes and sessions permanently (`server.js:196-203`). Sharing/quota features assume these gaps are filled first.
- **F16 - Routing bypasses method validation for known resources.** `GET /api/notes/:id`, `POST /api/folders/:id`, and similar fall through to the global 404 (`server.js:802`) instead of 405, and `GET /api/folders/:id` does not exist. New methods must be added as explicit branches before the fallback; a future `GET /api/notes/:id` is needed for ETags/revisions anyway.
- **F17 - Malformed URL/cookie encoding becomes a 500, not a 400.** `decodeURIComponent(url.pathname)` (`server.js:893`) and cookie decoding (`server.js:301`) throw `URIError`, which is not an `HttpError`, so the top-level catch returns 500 with the raw error message (`server.js:908-913`). Minor information leak and wrong status.
- **F18 - Static shell hardcodes `/share/`.** `route` serves `index.html` for any `/share/*` (`server.js:901`); new client routes (e.g. `/trash`, `/search`) need the same treatment or they will 404 through `serveStatic`. Conversely, API additions are unaffected.
- **F19 - `sendJson` skips `SECURITY_HEADERS`.** API responses (`server.js:404-407`) lack the CSP/referrer/frame headers that static and upload responses set (`server.js:65-71`). Not exploitable today (JSON is not a document), but a future endpoint returning user HTML (export preview, rendered share page server-side) must not reuse `sendJson` naively.
- **F20 - Client contract dead reference.** `public/app.js:502` exempts `/api/setup` from 401 redirects, but the server has no `/api/setup` route (only `/api/session`). If a setup endpoint is added, decide whether `needsSetup`/registration bootstrap moves there; otherwise remove the dead check. Do not reuse the name casually.

## 7. Suggested sequencing

- **Prerequisites (do first, unblock everything):**
  1. F1/F2/F3 hardening: corrupt-file quarantine, whitelist registration for new collections, awaitable `saveDb` flush, `SIGTERM` handling.
  2. Compat guarantees: keep `/api/notes` no-param shape for the Android APK; keep note PUT field-presence semantics.
  3. Decide one identity for notes across features (`rev`, `updatedAt` cursor, soft-delete visibility), because revisions, trash, delta sync, and conflicts all touch the same fields.
- **Quick wins (S):** ETags/304 (5.5), optimistic concurrency `rev` (5.4, client permitting), attachment list/delete + startup reconciliation (5.11), backup flush + manual snapshot (5.18 first half), `.md` allowlist fix (F4).
- **Medium (M):** revision history (5.1), trash + retention (5.2), delta sync/tombstones (5.3), per-account quotas (5.12), tags as entities (5.10), Markdown/zip export/import (5.13), API tokens (5.14), webhooks (5.15), automated backup rotation (5.18 rest).
- **Large (L):** account-to-account sharing (5.6), collaborative editing (5.7), reminders (5.16), email/password reset (5.17).
- **Server-side search (5.8/5.9)** sits between M and L: the endpoint is easy, but CJK tokenisation, index maintenance, and ranking make it a real project. Prototype with plain linear scans on a small corpus first; only build an index if measurements demand it.

Open questions for the rest of the team: who are the real users (one operator with a few accounts, or a family/team?), does the product promise portability (Markdown export) or convenience (real-time sync), and is the shipped Android client frozen (it constrains every contract change) or rebuildable alongside the backend?