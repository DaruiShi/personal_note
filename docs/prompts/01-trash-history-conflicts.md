# Vibe-coding prompt — Trash, revision history, and conflict detection

Paste everything between the `====` markers into your coding agent. It is written to be executed in
phases; each phase must end green before the next starts.

====

## Task

Add three data-safety features to the Personal Notes project in this repository: **trash (soft delete +
restore)**, **revision history**, and **conflict detection**. All three must work end to end on the web client,
the server, and the Android client. This is a data-integrity change, not a cosmetic one: nothing may lose data,
and the already-shipped Android APK (v1.16) must keep working against the new server.

## 1. Hard constraints - violate none of them

- **Zero npm dependencies.** Node standard library only (`node:http`, `node:fs/promises`, `node:crypto`,
  `node:path`, `node:test` for tests). Do not add a `dependencies` section, do not run `npm install`, do not
  vendor a library.
- **No inline scripts and no CDN.** The server sends `script-src 'self'; style-src 'self'`. Any new client code
  goes in a same-origin file under `public/`.
- **`data/notes.json` must stay small.** It is fully re-serialised on every write (`server.js:157-175`). History
  therefore goes in **sidecar files**, never inside `db` and never inside the note objects.
- **Do not break the shipped Android client.** `GET /api/notes` may gain fields but must keep its existing
  `{ notes: [...] }` shape; `PUT /api/notes/:id` must still accept a request body with no `rev` field and behave
  as it does today.
- **Every new top-level `db` collection must be registered in `loadDb` (`server.js:120-127`)**, which rebuilds
  `db` from a whitelist and silently drops unknown keys on restart. Design so you do not need a new collection.
- Match the existing code style: small functions, explicit `saveDb()` after mutation, `sendJson(res, status, obj)`,
  `HttpError`, hand-rolled if-chain routing in `handleApi`, no framework, no classes unless one already exists.

## 2. Data model changes

### 2.1 Note objects (in `data/notes.json`)

Add exactly two fields to every note:

- `rev` - integer, `>= 1`. Set to `1` on create, incremented by 1 on **every** accepted mutation
  (PUT, restore-from-history, folder change, restore-from-trash). It is the concurrency token.
- `deletedAt` - `null`, or a millisecond timestamp. `null` = live; a number = in trash.

Everything else about a note stays as it is. Do **not** add `histories`, `revisions`, or `conflicts` arrays to
the note object.

### 2.2 Revision history - sidecar files

One file per note: `data/history/<noteId>.jsonl` (append-only, one JSON object per line).

Entry shape:

```json
{"ts": 1792400000000, "rev": 7, "kind": "edit", "title": "...", "content": "...",
 "tags": ["a"], "pinned": false, "folderId": null, "bytes": 1234, "hash": "<sha256 hex>"}
```

`kind` is one of:

- `"edit"` - the note's state **before** an accepted update
- `"rejected"` - a client payload that lost a conflict; stored so it is never lost
- `"restore"` - the state before a restore-from-history
- `"trash"` - the state just before the note was moved to trash
- `"purge"` - the final state just before permanent deletion

Rules:

- Append at most **one `"edit"` entry per note per 60 seconds** (compare `ts` of the last entry in the file).
  Skip the append entirely when the content hash equals the last entry's hash. Always append `rejected`,
  `restore`, `trash`, and `purge` entries regardless of the 60-second floor.
- Keep at most **50 entries per note**. When trimming, rewrite the file with the newest 50 lines (read it, slice,
  write to `<file>.tmp`, rename - same atomic pattern as `saveDb`).
- Deleting history is allowed only on `"purge"` (permanent delete) or when the whole account is deleted. On
  soft-delete, keep the history file.
- Never put history in `notes.json`. Never scan history files at startup.
- Create `data/history/` lazily with `fsp.mkdir(..., {recursive:true})` on first append.

### 2.3 Settings

Add `settings.trashRetentionDays` (integer, default `30`, allowed 1-3650). Normalise it in `loadDb`; a missing or
invalid value becomes 30. Add it to the `settings` object built at `server.js:123`.

## 3. API contract

Add these routes. Put them in `handleApi` before the final `sendJson(res, 404, ...)` and keep the existing
ordering discipline (note that `handleApi` receives only `pathname`, so use separate paths instead of query
params for state-changing actions - do not add `?purge=1`).

| Method | Path | Auth | Request | Success | Notes |
|---|---|---|---|---|---|
| GET | `/api/session` | public | - | add `features: {trash: true, history: true, conflicts: true}` | presence = capability advertisement for old/new clients |
| GET | `/api/notes` | session | - | `{notes: [...]}` | must **exclude** notes with `deletedAt != null`; each note now carries `rev` |
| GET | `/api/trash` | session | - | `{notes: [...], total: n}` | only trashed, newest `deletedAt` first, includes `rev` and `deletedAt` |
| DELETE | `/api/notes/:id` | session | - | `{ok: true, deletedAt: <ms>}` | **soft** delete now; idempotent (second call returns the same `deletedAt`) |
| POST | `/api/notes/:id/restore` | session | - | `{note}` | trash -> live; sets `deletedAt = null`, `updatedAt = now`, `rev += 1` |
| POST | `/api/notes/:id/purge` | session | - | `{ok: true}` | permanent: drop the note, append a `purge` history entry, then prune uploads |
| POST | `/api/trash/empty` | session | - | `{purged: n}` | purge every trashed note of this account |
| PUT | `/api/notes/:id` | session | `{title, content, tags, pinned, folderId?, rev?}` | `{note}` | see section 4 |
| GET | `/api/notes/:id/history` | session | - | `{revisions: [{rev, ts, kind, bytes, title, preview}]}` | newest first; `preview` = first 120 chars of content, **no full content** |
| GET | `/api/notes/:id/history/:rev` | session | - | `{revision: {ts, rev, kind, title, content, tags, pinned, folderId}}` | full content for one revision; 404 if absent |
| POST | `/api/notes/:id/history/:rev/restore` | session | - | `{note}` | see section 4.6 |

Changed routes:

- `GET /api/share/:token` - a note with `deletedAt != null` must answer 404 (`server.js:462-467`).
- `GET /uploads/<name>?s=<token>` - the share-token path must also refuse when the owning note is trashed
  (`server.js:851-857`).
- `POST /api/notes` - response note includes `rev: 1` and `deletedAt: null`.

All note objects returned by the API must include `rev`. Trashed notes may additionally include `deletedAt`
(it is `null` for live notes - sending the field always is fine).

## 4. Server behaviour rules (these are the parts that must not be gotten wrong)

### 4.1 `PUT /api/notes/:id` - concurrency

After `await readJson(req)` and before mutating anything:

1. Look up the note scoped to `user.id`. If missing, 404 as today.
2. If `note.deletedAt != null`, return `409` with
   `{error: 'This note is in the trash', code: 'trashed', note}`. Do not mutate it.
3. Conflict check:
   - If the body has **no** `rev` field: legacy client. Accept (last-write-wins), exactly as today.
   - If the body has `rev` and it is **not a number**: `400 {error: 'rev must be a number'}`.
   - If `body.rev !== note.rev`: **do not mutate**. Append a `rejected` history entry containing the *incoming*
     title/content/tags/pinned/folderId, then return
     `409 {error: 'This note was changed on another device', code: 'conflict', note}` where `note` is the
     current server state (including `rev`). Never merge silently.
4. Accept: `Object.assign(note, sanitizeNote(body))`, keep the `'folderId' in body` guard
   (`server.js:718-721`), set `note.updatedAt = Date.now()`, `note.rev += 1`, `saveDb()`.
5. A `rev` that matches but is stale by more than one is still accepted - we detect "changed since I read it",
   not optimistic-locking history.

Do the rev check **after** the `await`, immediately before mutating, so two interleaved requests in the single
Node process cannot both pass.

### 4.2 Soft delete

`DELETE /api/notes/:id`:

- If already trashed: return 200 with the existing `deletedAt` (idempotent).
- Else: append a `trash` history entry, set `deletedAt = Date.now()`, `rev += 1`, `saveDb()`.
- **Do not** call `pruneOrphanUploads()` here. Trashed notes still reference their files.
- The note stays in `db.notes` (so `MAX_NOTES_PER_USER` counts it) - that is intentional; it prevents a user
  from using trash as unlimited free storage. Trashed notes are also capped: if an account has more than
  `MAX_TRASH_PER_USER = 500` trashed notes, auto-purge the oldest ones during the same request.

### 4.3 Restore from trash

`POST /api/notes/:id/restore`: 404 if the note is missing or not owned. If not trashed, return the note
unchanged (idempotent). Otherwise `deletedAt = null`, `updatedAt = now`, `rev += 1`, `saveDb()`. Keep `folderId`
as it was; `GET /api/folders` counts should already ignore trashed notes (`server.js:616-618`) - fix that count
to filter `deletedAt == null`.

### 4.4 Permanent delete and retention

- `POST /api/notes/:id/purge`: append a `purge` entry, delete the history file, remove the note, `saveDb()`,
  then `pruneOrphanUploads()`.
- `POST /api/trash/empty`: same for every trashed note of this account; prune once at the end (not per note).
- **Retention job:** a `setInterval` (every 60 minutes) plus one run right after `loadDb()` in the startup
  sequence. It purges notes where `deletedAt < Date.now() - trashRetentionDays*86400000`. Batch the work, call
  `saveDb()` **once per sweep**, and only when something was actually purged. Never block startup waiting on it.

### 4.5 `pruneOrphanUploads()` must learn about trash and history

It currently builds its reference set from `db.notes[*].content` only (`server.js:264-269`). Deleting one note
would therefore delete attachments that a *trashed* note or a *history revision* still references. Change it to
build the reference set from:

1. every note in `db.notes` regardless of `deletedAt`,
2. every line of every file in `data/history/` (read them lazily; on any read error, treat as "no references" but
   log a warning - do **not** delete a file you could not check; safest is to skip pruning entirely if a history
   file fails to parse).

Keep the existing allowlist/name regex. Run it on purge/empty, on account delete, and never on plain trash.

### 4.6 Restore from history

`POST /api/notes/:id/history/:rev/restore`:

1. Load the revision. If absent: 404.
2. Append the note's **current** state as a `restore` entry (so the restore itself is undoable).
3. Apply the revision's `title/content/tags/pinned/folderId`, set `updatedAt = now`, `rev += 1`, `saveDb()`.
4. Honour the same conflict rules as a normal write: if the body carries a `rev` and it does not match, return
   409 `code: 'conflict'` without touching anything.

### 4.7 History API

- `GET /api/notes/:id/history`: read the sidecar, parse defensively (skip malformed lines, never throw a 500 for
  a corrupt line), return newest-first summaries. Missing file = `{revisions: []}`.
- `GET /api/notes/:id/history/:rev`: return the full entry; 404 when absent.
- Path traversal: the note id comes from the URL. Validate it is a UUID-shaped string and that the resolved path
  stays inside `data/history/` before any read or write (`path.normalize` + prefix check, like
  `serveStatic`'s guard at `server.js:809-814`). History file names derive from `note.id`, never from request
  input.

## 5. Web client (`public/`)

### 5.1 Plumbing

- `api()` (`public/app.js:496-509`) currently throws a bare `Error`. Attach the status and payload to the
  thrown object: `err.status = res.status; err.code = data.code; err.payload = data;` Keep the existing message
  text so nothing else changes.
- Extend `toast(msg)` (`app.js:514`) to `toast(msg, {action, onAction})` that renders an optional inline action
  button; keep the 2.6 s auto-dismiss and clear any pending action timer. Existing call sites must be unchanged
  in behaviour.
- `state` (`app.js:435-453`) gains `conflict: null` and `trashCache: []`.
- `saveNote()` (`app.js:1102-1129`): send `rev: note.rev` in the PUT body; on success copy back
  `note.rev = updated.rev; note.updatedAt = updated.updatedAt`. On failure:
  - `err.code === 'conflict'` -> call `handleConflict(note, err.payload.note)`, set save status to `pending`
    (not `error`), and do not toast.
  - `err.code === 'trashed'` -> toast "This note was deleted on another device" with action "Restore", call
    `POST /api/notes/:id/restore`, then resave.
  - anything else -> existing error behaviour.
- `scheduleSave()` (`app.js:1125-1131`): return early while `state.conflict` is set, so autosave cannot spin
  against a conflict.
- `flushSave()`/`selectNote()` must clear `state.conflict` when switching notes.

### 5.2 Conflict UI

Add a modal to `public/index.html` near the existing `#modal` (`index.html:203-213`), following the same
`.modal-backdrop` + `role="dialog" aria-modal="true"` pattern:

- `#conflict-modal` with title "This note changed elsewhere", a one-line explanation naming both timestamps, and
  three buttons: `#conflict-mine` ("Keep my version"), `#conflict-theirs` ("Keep the other version"),
  `#conflict-both` ("Keep both").

Behaviour:

- **Keep my version**: re-PUT the local content with `rev` = the server's `rev` from the 409 payload.
- **Keep the other version**: load the server note into the editor, discard the local buffer, toast "Loaded the
  newer version". The discarded text is still recoverable from history (`kind: "rejected"`), and the UI should
  say so in the modal copy.
- **Keep both**: `POST /api/notes` with the local content and title
  `` `${localTitle || 'Untitled'} (conflict copy)` ``, then keep the user on the original note.
- After any choice: clear `state.conflict`, close the modal, and re-render.

### 5.3 Delete becomes trash

- Change the confirm copy at `app.js:1517-1539` to "Move to trash?" / "... will be moved to the trash. You can
  restore it for N days." and the button label to "Move to trash".
- Keep the local list update, then `toast('Moved to trash', {action: 'Undo', onAction: restore})`.
- Add a **Trash** entry in the sidebar footer next to "Export backup" (`index.html:70-73`): a `link-btn`
  `#trash-btn` with a count. Clicking opens `#trash-modal` (new, same pattern, `.modal.wide`): each row shows
  title, "deleted N ago", and `Restore` / `Delete forever` buttons, plus an "Empty trash" button that confirms
  first. Restore removes the row; if the trash becomes empty, show an empty-state line.

### 5.4 History UI

- Add an `icon-btn` `#history-btn` to `.editor-actions` immediately before `#delete-btn` (`index.html:103`),
  with a clock-style inline SVG in `ICONS`, `title="Version history"`, `aria-label="Version history"`.
- Clicking opens `#history-modal`: a list of rows "N ago - 1.2 kB - edit" (newest first). Clicking a row fetches
  `GET /api/notes/:id/history/:rev` and shows the revision's rendered content in the modal with a
  **Restore this version** button (confirm first). Restoring then refreshes the editor from the response note.
- Empty history: "No saved versions yet".

### 5.5 Startup

`enterApp()` (`app.js:622-647`) also fetches `/api/trash` (tolerate 404 for old servers) so the trash count can
be rendered. Do not block the first paint on it.

## 6. Android client (`android-app/`)

Keep it minimal but complete for these three features:

- `Models.kt`: add `val rev: Int = 0` and `val deletedAt: Long? = null` to `Note`; parse both in `fromJson`
  (`optInt("rev", 0)`, `optLong` with a `has()` guard) and emit `rev` in `toJson`.
- `Api.kt`: `request()` must throw a typed `ApiException(val status: Int, val code: String?, message: String)`
  instead of a plain `Exception` when the response is not successful, preserving the current message text.
  `updateNote(...)` gains a `rev: Int?` parameter and includes it in `noteBody` only when non-null.
- `AppViewModel`: pass `note.rev` when saving; catch `ApiException` with `status == 409 && code == "conflict"` and
  expose a `conflict` UI state carrying the server note. The save must **not** be retried automatically.
- Conflict dialog (Compose `AlertDialog` in `EditScreen`): "Keep mine" (re-save with the server `rev`), "Keep
  theirs" (replace the editor buffer), "Keep both" (create a new note with `" (conflict copy)"` appended).
- Trash: a "Trash" entry in `SettingsScreen` opening a small list screen that calls `GET /api/trash`, with
  restore and delete-forever actions. Do not build history UI on Android in this change (out of scope); just do
  not break on the extra fields.
- `syncPendingDrafts` must send the note's current `rev` when it has one, and must treat a 409 as "queue a
  conflict", not as "drop the draft".
- Out of scope for this prompt: the pre-existing offline-draft data-loss bug and the cross-account cache leak.
  Do not refactor them, but do not make them worse.

## 7. Migration and startup

- `loadDb` (`server.js:97-152`): normalise every note to `rev = (Number.isInteger(n.rev) && n.rev >= 1) ? n.rev : 1`
  and `deletedAt = (typeof n.deletedAt === 'number') ? n.deletedAt : null`. Normalise
  `settings.trashRetentionDays`. Persist the normalised shape only on the next natural save - do not force a save
  at boot.
- No new top-level `db` collection is allowed to be **required**; history lives on disk. If you decide you need
  one anyway, you must also add it to the whitelist at `server.js:120-127` and validate it there.
- Existing `data/notes.json` files (including the one in this repo) must load without edits.

## 8. Tests you must add

Create `test/` and use `node:test` only (`node --test`). Each test file should spawn the server as a child
process with `DATA_DIR` pointed at a fresh temp directory and `PORT` set to a random high port, poll
`GET /api/session` until ready, register an account, and run against the HTTP API. Add `"test": "node --test"`
to `package.json`.

Cover at minimum:

1. **Conflicts**: create a note (rev 1); PUT with `rev: 1` succeeds (rev 2); PUT with `rev: 1` again -> 409 with
   `code: "conflict"` and the current note; PUT with no `rev` still succeeds (legacy); the rejected payload is
   present in history as `kind: "rejected"`.
2. **Trash**: DELETE removes it from `GET /api/notes`, puts it in `GET /api/trash`; the note's share token now
   404s; restore brings it back with `rev` incremented; purge removes it from `db` and its history file; empty
   trash purges everything; deleting twice is idempotent.
3. **History**: two edits produce entries; `GET .../history` returns summaries without content;
   `GET .../history/:rev` returns content; restoring an old revision creates a `restore` entry and changes the
   note; the 50-entry cap trims the oldest; the sidecar is `data/history/<id>.jsonl` and `notes.json` contains
   no history; upload pruning keeps a file referenced only by a history entry or by a trashed note.
4. **Retention**: with `trashRetentionDays` forced small, a backdated `deletedAt` is purged by the sweep.
5. **Compatibility**: `GET /api/notes` still returns `{notes: [...]}` and every note has `id`, `title`,
   `content`, `tags`, `pinned`, `createdAt`, `updatedAt`.

## 9. Implementation order

1. Data model + `loadDb` normalisation + `rev` on create + rev check in PUT + `features` in `/api/session`.
   Write test 1. Everything green before moving on.
2. History sidecar module (`append`, `list`, `read`, `trim`, path guard) + history endpoints + prune fix.
   Write test 3.
3. Soft delete, restore, purge, empty, retention sweep. Write tests 2 and 4.
4. Web: `api()` errors, conflict modal, trash view, history view, delete copy, undo toast.
5. Android: model, `ApiException`, `rev` on save, conflict dialog, trash screen.
6. Run the full suite, then a manual pass: two browser windows on the same note (edit in A, save, edit in B,
   save -> conflict modal appears and all three choices behave), delete/undo, delete/restore from the trash view,
   restore an old version, and the Android app against the same account.

## 10. Definition of done

- `node --test` passes.
- `node server.js` starts against the repo's existing `data/notes.json` with no manual migration, and the web app
  loads, edits, saves, deletes to trash, restores, shows history, and resolves a real two-window conflict.
- The Android app (built from `android-app/`) can save with `rev`, show the conflict dialog, and list/restore
  trashed notes.
- No `package.json` dependencies. No inline script. No new top-level collection that `loadDb` would drop.
- `README.md` updated: the delete flow now says trash, retention window documented, and the three features listed
  under Features. `data/history/` added to the project-layout section and to `.gitignore`'s data rules (the
  existing `data/` ignore already covers it - verify).

## 11. Do not

- Do not merge conflicting versions automatically, ever.
- Do not store history inside `notes.json`.
- Do not let a *soft* delete (or its prune) touch uploaded files that trashed notes or history still reference.
- Do not change the success shape of `GET /api/notes` or require `rev` on PUT.
- Do not add `?purge=1`-style query parameters to state-changing routes - `handleApi` does not receive the URL.
- Do not introduce `dependencies`, a bundler, TypeScript, or a framework.
- Do not refactor unrelated code, reformat untouched functions, or "clean up" the existing markdown renderer.
  Keep the diff scoped to these three features.
- Do not claim done without running the manual two-window conflict test.

====