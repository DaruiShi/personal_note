# Product Ideation Catalog — Funshare Notes

**What this is.** Eight strategic directions, not a feature list. Each one is a coherent bet about what this
product should become, grounded in what the code actually does today (file:line references), sized for one
developer working evenings on a 2 vCPU / 2 GiB Aliyun box.

**Thesis up front.** This is not a note app competing with Obsidian or Notion. It is *a private server that
turns a note into a page you can hand to someone who has no account*. The share link is the product; storage,
folders, tags and the Android app are what make the share link worth creating. The winning strategy is to
deepen that one axis nobody gives away for free, and then remove the two objections that stop a real person
from trusting it with their actual notes: *"will I lose my data"* and *"will it still exist in three years"*.
Everything else is downstream of those three questions.

**Effort bands** (one part-time developer): **S** ≤ 2 dev-days · **M** 3–7 dev-days · **L** 2–4 weeks ·
**XL** 1–2 months.

---

## 0. The physics of this product (read before proposing anything)

These are not opinions, they are constraints the code imposes. Every direction below is scored against them.

| Constraint (evidence) | Product implication |
| --- | --- |
| Whole DB in memory, every write re-serialises it to `notes.json` (`server.js:82`, `157-175`) | Features that write on a cadence (history, review state, audit, view counts) must live in **sidecar files**, never as `db` fields. At 5 000 notes × ~2 KB the server stringifies ~10 MB per save; autosave debounce hides it today, it will stop hiding. |
| `GET /api/notes` returns every note with full content, no pagination/delta (`server.js:691-696`) | Phone cold start and the SPA's in-memory search grow linearly with the vault. Wikilink indexes and real sync are **blocked on a `?since=` / `?summary=1` variant**; do that before any "sync" feature. |
| Search = client-side `toLowerCase().includes` over `title+content+tags` (`public/app.js:930`) | No ranking, no CJK segmentation, no snippet. Ranking and CJK bigram matching are a client-side afternoon; an embeddings index is a different product. |
| Hard caps: 1 MB/note, 2 MB body, 25 MB/upload, 5 000 notes, 100 folders, 100 users (`server.js:38-46`) | Tells you the intended scale (personal + a handful). Quotas belong here, not in a billing system. |
| Upload metadata already records `{original, size, by, at}` (`server.js:605`) | Per-account storage accounting is ~20 lines, not a project. Disk exhaustion is the only real single-user outage risk on a 40 GB VPS. |
| Delete is a hard delete: array filter + orphan-upload prune (`server.js:725-730`, `258-279`) | No trash, no undo. This is the **single biggest trust gap** in the product. Also: every delete rescans every note's content with a regex — quadratic if you bulk-delete. |
| One share token per note, no password, no expiry (`server.js:734-748`) | Sharing is a capability URL: elegant, but you can only revoke *all* readers or none, and a leaked link stays live forever. |
| The share page **is** the SPA: static `index.html` then a client-side fetch of `/api/share/:token` (`public/index.html:176-184`) | Crawlers see no `<title>`, no description, no image. Telegram/WeChat/Slack/X link previews are all dead, and there is no SEO. Fixing this is the highest-leverage visible change in the entire catalog. |
| CSP `connect-src 'self'` (`server.js:65-71`) | No browser can call a third-party API. All AI must be **proxied by the server** — which conveniently means the API key never reaches a browser. |
| No service worker anywhere in `public/`; the Android app has crude "hold drafts if unreachable" sync (`android-app/README.md:79-81`) | Offline is half-built twice, in two incompatible ways. Pick one model (server-authoritative with conflict detection) and implement it once. |
| Sessions store only `{uid, exp}` (`server.js:130-137`); cookie gets `Secure` only when TLS is detected (`server.js:306-320`) | No device list is possible without a schema addition. On Route B (bare IP:3000) the session cookie is *never* `Secure` — every "privacy-first" claim is downstream of moving to HTTPS. |
| No CORS headers anywhere in `server.js` | Third-party capture (bookmarklet, CLI, clipper) is impossible until API tokens + an explicit CORS allowlist exist. Today the cookie's `SameSite=Strict` is doing all the CSRF work. |
| Upload MIME allowlist has no audio type (`server.js:41`) | Voice memos are rejected by magic-byte sniffing. Adding `m4a/ogg/mp3` with proper sniffing is a 10-line change that unlocks a whole capture modality. |
| `scryptSync` on login blocks the event loop ~50–100 ms (`server.js:179-189`); rate limiter is an in-memory map that resets on restart (`server.js:47-49`) | Fine for 10 friends, a liability for 100 strangers. Any "public instance" idea (Direction 8) inherits this. |
| Deployment today: plain HTTP by IP:3000, ICP 备案 pending for `funshare.site` (`deploy/DEPLOY-ALIYUN.md:13-23`, `README.md:193-198`) | Two consequences: transport security is the gate on trust features, and WeChat is known to refuse/warn on `IP:port` links — so *sharing quality itself* is capped until domain + HTTPS land. |

**Scoring tests used below.** (1) Does it make the *next* share link better? (2) Does it protect notes already
in the vault? (3) Can it be built without npm, inside one JSON file, on one process? (4) What does it cost on
Android? (5) Is it reversible if wrong?

---

## 1. The Publishing Layer — "the share link *is* the product"

**Pitch.** Stop treating share links as a plumbing feature and make them the front door: a one-click personal
publishing surface where a note becomes a real, previewable, controllable web page on your own domain.

**Why it fits THIS product.**
- It is the only capability a user cannot get for free elsewhere: Obsidian Publish is a paid subscription
  (~$8–10/mo) and only exists as an Obsidian feature, Notion pages are slow to load in mainland China and drag
  readers into app chrome, and 语雀/飞书 public docs often push readers to sign in for full access. "Open a link,
  no account, images and PDFs included" is genuinely rare.
- The infrastructure is 80% done: capability tokens, asset grace via `?s=<token>`, revocation, read-only
  rendering (`server.js:734-748`, `845-870`; `public/index.html:176-184`).
- The domain already exists and is literally named *funshare*. The product's name is a strategy.
- It composes with what is already built instead of demanding a new data model.

**Plays.**
- **Server-rendered share head + text fallback (S).** A tiny template for `/share/:token` that emits `<title>`,
  `meta description`, `og:*` (image = the first `/uploads/...` reference, rewritten absolute and carrying
  `?s=token`, falling back to `/icon.svg`), plus a short plain-text excerpt of the note inside `<noscript>` and
  the usual SPA shell for the body. Crawlers and chat clients stop seeing an empty page; the renderer stays where
  it is.
- **Full-body SSR for published pages (L, only if Direction 1 becomes a real blog).** The markdown renderer lives
  in `public/app.js`; server-side body rendering means extracting it into a module both sides can load
  (`lib/md.js`) without a build step. Worth it for SEO on `/p/…` pages, not worth it for plain share links.
- **QR code in the share modal (S).** Hand-rolled QR encoder (~150 lines, no deps) rendered as inline SVG:
  phone-to-phone sharing without typing a URL, and the single most useful thing for a WeChat/Telegram handoff.
- **Share controls: expiry, password, per-recipient links (M).** Replace `note.share: {token, createdAt}` with
  `note.shares: [{token, label, createdAt, expiresAt, passwordHash}]`. "Send to Li, revoke Li" becomes possible
  without building an ACL system.
- **Viewer counter + "last opened" (S).** Bump counts in a sidecar `data/views.jsonl` (never in `notes.json`),
  show "opened 14× · last 2h ago" in the share modal. Quietly the most-requested feature of every share
  feature ever shipped.
- **Publish a folder as a mini-site (M).** `published: true` on a folder → `/p/:user/` index page with a list,
  `/p/:user/:slug` pages, `sitemap.xml`, and an RSS feed. This is the bridge from "note app" to "personal site"
  without a static-site generator.
- **Print-to-PDF stylesheet + "Copy as image" (S).** A `@media print` pass on the share page is the cheapest
  PDF export that will ever exist; no PDF library, no browser automation.
- **Comments on shared notes, no account required (M).** A share page gains an optional comment box: display
  name + text, stored in `data/comments/<noteId>.jsonl`, owner reads and moderates them in the editor, closes
  comments per note. This is the *only* collaboration feature worth building here: recipients stay anonymous and
  scoped to a capability token, so there are no users to create and no ACL to get wrong. Abuse control is a
  per-token rate limit plus owner deletion.

**What this direction deliberately excludes.** Shared notebooks, per-note permissions for other *accounts*, and a
"shared with me" inbox. Those need a note-level ACL across accounts, where one missing `userId` filter in the
list route leaks someone else's notes — a catastrophic failure mode traded for a feature the target user doesn't
need. Sharing stays read-only and capability-based (comments are the single exception, scoped to a token).

**Killer small feature.** **A server-rendered `<head>` on share pages.** About 80 lines in the `/share/` branch
of `route()` (`server.js:900-901`) — title from the note, description from the first ~160 characters of content
with markdown syntax stripped, `og:image` from the first image reference, `og:url` from a `PUBLIC_BASE_URL` env
var. It converts every future share link from "suspicious bare URL in a chat" into a titled card with a
thumbnail, and it is the only change here that improves every existing share at once. The body can keep rendering
client-side; chat clients only read the head.

**Effort / first PR.** M overall, but the killer feature is S. First PR: replace the `/share/` branch in
`route()` (`server.js:900-901`, currently "serve the app shell") with a server-rendered template that emits the
meta tags and the note body; keep the SPA fallback for older clients and keep CSP intact (inline styles only,
no scripts).

**Main blocker.** Two, in order: (a) **HTTPS + domain** — mainland ICP 备案 is the gate, and moving the ECS to
Hong Kong/Singapore is the one-day workaround; without it WeChat may not even open the link. (b) Absolute URLs
inside share pages need a configured `PUBLIC_BASE_URL` env var, because the server currently has no idea what
its public origin is (this also fixes the Android app's hard-coded `https://funshare.site` default).

---

## 2. Knowledge Loop 2.0 — make the vault compound

**Pitch.** Turn a flat pile of notes into a graph you can walk: links, backlinks, daily pages, and resurfacing
of things you forgot — using syntax that is also an Obsidian escape hatch.

**Why it fits THIS product.**
- The renderer is hand-written and lives in `public/app.js`; adding a `[[Title]]` pass is a regex plus a lookup,
  not a framework. This is the rare case where the "build it yourself" architecture is an *advantage*.
- The SPA already holds every note in memory (`server.js:691-696`), so a title→id index costs nothing extra.
- Android renders markdown with Markwon (`android-app/README.md:38-39`); custom link handling is a known,
  bounded extension point, not a rewrite.
- `[[wikilinks]]` are Obsidian-compatible, so the syntax choice simultaneously powers Direction 7's export and
  reduces lock-in anxiety. One decision, two payoffs.

**Plays.**
- **`[[Wiki links]]` + backlinks strip (S/M).** Resolve by normalised title; unresolved links render dimmed and
  create the note on click (Obsidian's behaviour, and the reason it feels alive). Under the preview, a
  "Linked from" list computed from the same in-memory index.
- **Daily notes / journal (S).** A "Today" button that opens (or creates) `Journal/YYYY-MM-DD` in a folder.
  Deterministic title means no schema change; add a create-if-missing endpoint to avoid two devices creating
  two "today" notes (the naive SPA approach races on sync).
- **Resurface card (S).** On the empty state and once per session: "On this day, 2025" / "You haven't opened
  this in 8 months" — pure computation over `createdAt`/`updatedAt`, which already exist. This is the 80%
  version of spaced repetition, at 2% of the cost.
- **Outline / TOC rail (S).** Parse `##` headings from the open note; click to scroll. Also makes long notes
  navigable on Android where scrolling is worse.
- **Tag pages (S).** `/tag/:name`-style filtered view with counts; tags already exist and are filtered
  client-side, so this is UI, not storage.
- **Spaced repetition on `#flashcard` notes (L).** Only if the resurface card proves people actually revisit
  old notes. Needs review state, scheduling, and Android parity — a real feature, not a weekend.

**Killer small feature.** **Wikilinks + backlinks panel.** ~150 lines in `app.js` with zero server, zero schema,
zero migration, and it retroactively organises notes the user already has. It also makes the vault look like
something worth investing more in.

**Effort / first PR.** S–M. First PR: renderer pass for `[[...]]` + click-to-open; second PR: backlink
computation; third: daily note button.

**Main blocker.** Title-based identity is fragile: rename a note and its inbound links break. Mitigation is an
alias field (`aliases: []` in frontmatter or note meta) and "resolve by title, then by alias, then unresolved" —
tiny schema growth, but it must be designed before users write 500 links, not after. Secondary:
re-indexing costs O(total content) per load; fine now, but the moment `?summary=1` exists (Direction 5) the
index should be built from titles+links only.

---

## 3. Capture Everywhere — meet the user on the phone

**Pitch.** The note that never gets written is the feature request; make capture possible from the share sheet,
the clipboard, a screenshot, a voice memo, and a URL — without opening the app first.

**Why it fits THIS product.**
- The owner is phone-first: a Redmi K80 Pro, a native app, an editor built around the system photo picker and
  clipboard banner. Capture is the natural next step for *this* user, not a market survey.
- The cheap wins require **zero server changes**: a `ACTION_SEND` intent filter and one Compose screen.
- The PWA already installs; `manifest.webmanifest` has no `share_target`, which is a 5-line addition that gives
  Chrome-on-Android users a share target without shipping an APK.
- Honest limits: Telegram is blocked from mainland egress and WeChat bots are not viable (see rejects), so the
  capture strategy has to be *device-local and HTTPS-free first*.

**Plays.**
- **Android share-sheet target (S).** `ACTION_SEND` for `text/plain`, `image/*`, and `text/uri-list` → "New note
  in Funshare". Reuses `POST /api/notes` and `POST /api/uploads` exactly as they are. This is the highest
  daily-value / lowest-cost item in the catalog.
- **PWA `share_target` with a GET fallback (S).** `share_target.action: "/"`, method GET, params url/text/title
  → the SPA reads the query string and pre-fills a draft. No new endpoint, no service worker, no POST body
  parsing. Works in Chrome/Edge on Android; degrades to "nothing" elsewhere.
- **Screenshot → note (S).** Paste already works in the web editor; on Android, extend the share target to
  images and dump them into a configurable "Inbox" folder. Screenshot-as-note is how half of Chinese mobile
  users actually take notes.
- **On-device OCR (M).** ML Kit `text-recognition-chinese` (bundled model, works offline, a few MB of APK):
  screenshot → text → editable note body. Keeps the privacy promise intact because nothing leaves the phone —
  the correct answer to "OCR" for this product, and it should replace any server-side Tesseract thought.
- **Token-authenticated capture endpoint + bookmarklet (M).** `POST /api/inbox` with `Authorization: Bearer
  <token>`, plus CORS for one known origin; a bookmarklet pre-filled with the token turns any web page into
  "title + URL + selection" in one click.
- **Voice memo → upload (S/M).** Add `m4a/ogg/mp3` to `UPLOAD_EXT_RE` and `sniffFile` (`server.js:41`,
  `214-238`); record in-app and attach. Transcription is optional and belongs to Direction 6, not here.
- **Telegram bot (M) — only if the server leaves mainland.** Bot API long-polling is ~100 lines of `fetch`, but
  `api.telegram.org` is unreachable from an Aliyun mainland VPS. This is a *deployment* decision, not a coding
  one; do not schedule it before the region decision.

**Killer small feature.** **Android `ACTION_SEND` share target.** About 40 lines of manifest + one screen, zero
server work, and it turns the phone into the capture device the app was always meant to be. Runner-up: the
`share_target` GET manifest trick, which costs 10 minutes and reaches web-app users.

**Effort / first PR.** S–M. First PR: share target → create note in an "Inbox" folder; then OCR; then the
bookmarklet (which is blocked on tokens).

**Main blocker.** **Auth without a cookie.** Every capture channel except the native app is a third-party
context, and today there is no token system and no CORS (`server.js` has neither). Building capture out of order
means shipping a token scheme under pressure — do Direction 7's API tokens first and wait for them.

---

## 4. Privacy That Actually Ships — fix the transport, then make trust visible

**Pitch.** Stop arguing about end-to-end encryption you cannot deliver, and instead close the two gaps a real
user can see: cleartext transport and "who is signed in to my notes?"

**Why it fits THIS product.**
- The privacy story is *already* the product's best asset (zero deps, one file you own, no vendor, capability
  URLs, strict CSP) — and it is undermined by the current deployment: plain HTTP by IP (`README.md:193-198`),
  so the `Secure` flag never applies (`server.js:306-320`) and a password crosses the wire in the clear.
- Sessions already live in the DB, so a device list and revocation are a small schema addition plus two routes.
- The single-file, append-only audit log is *easier* here than in a normal app, because there is one process and
  one writer.
- Full-vault E2E encryption is a trap for this specific architecture (see rejects); the honest wins are
  transport, visibility, and recovery.

**Plays.**
- **HTTPS + domain, by moving the ECS to Hong Kong/Singapore if 备案 is the blocker (S).** Not glamorous, not
  optional: HSTS, `Secure` cookies, Web Share API, service workers, clipboard write, and WeChat link opening all
  key off it. `deploy/DEPLOY-ALIYUN.md` already documents the HK route; the catalog's advice is to take it
  instead of waiting weeks and writing more HTTP-only features.
- **Device/session list with per-session revoke (S/M).** Add `createdAt`, `ip`, `ua`, `lastSeenAt` to each
  session (`server.js:130-137`), expose `GET /api/sessions` and `DELETE /api/sessions/:id`, show it in the
  Account modal. Feature-for-feature what Gmail/Notion users expect, and ~100 lines total.
- **Append-only audit log + admin viewer (S/M).** `data/audit.jsonl`, `fs.appendFile` (never a full DB rewrite),
  events: login ok/fail, password change, logout-all, account delete, admin promote/demote/delete, share
  create/revoke, registration toggle, token create/revoke. Rotate at ~5 MB, keep 5 files. Admin reads
  `GET /api/admin/audit?limit=200`.
- **At-rest encryption of `notes.json` (M) with an explicit trade-off.** AES-256-GCM with a passphrase-derived
  key at boot (Node `crypto` only) protects the one file that matters if the VPS disk leaks. The cost is real:
  a lost passphrase = a lost vault, `cp` in cron produces ciphertext the owner cannot inspect, and the
  "edit notes.json by hand" recovery path in `README.md:141-144` dies. Recommendation: only the **backup
  copies** get encrypted, not the live file.
- **TOTP two-factor auth (M).** HMAC-SHA1 + base32 is ~60 lines of stdlib, no deps. But it cannot ship before
  the Android login screen gains a code field, or the phone app is locked out — that coordination cost is the
  whole reason it is M and not S.
- **Login-notification e-mail / webhook (S).** Optional outbound `POST` to a user-configured URL on new-device
  login; a poor man's intrusion detection that needs no mail server.

**Killer small feature.** **The device list with revoke.** It converts "trust me" into something the user can
verify, costs about a day, and unlike TOTP it cannot lock the Android app out. Bonus: it also solves the
"my session expired and I want to kill the old laptop" support question.

**Effort / first PR.** S–M. First PR: session metadata + `GET/DELETE /api/sessions` + Account-modal UI.

**Main blocker.** The HTTPS/region decision — bureaucratic, not technical, and everything else in the privacy
narrative hangs off it. Secondary blocker: at-rest encryption fights the product's best backup story
("copy one file"), so treat it as an optional mode and never the default.

---

## 5. Durability & Sync — never lose a note, never show a conflict dialog for no reason

**Pitch.** Make "my data is safe" true by construction: undo, history, real backups, and conflict detection
instead of silent last-writer-wins.

**Why it fits THIS product.**
- The update path is `Object.assign(note, body)` with a fresh `updatedAt` and no precondition
  (`server.js:715-724`): two devices editing the same note means the later save silently wins. The Android app
  already holds unsynced drafts and pushes them later — the collision is not hypothetical, it is scheduled.
- There is no trash and no history (`server.js:725-730`); a mis-tap on Delete is permanent. For a tool meant to
  hold a person's real notes, that is the product's biggest credibility problem.
- The data is one file, so the *right* backup features are cheap for this product in a way they never are for
  normal apps.
- The write path is already coalesced into one atomic `tmp`+`rename` (`server.js:157-175`) — good bones to build
  on.

**Plays.**
- **Optimistic concurrency: `baseUpdatedAt` precondition (S).** Client sends the `updatedAt` it edited; server
  compares and returns `409 {conflict:true, current}` instead of overwriting; the SPA offers *keep mine / keep
  theirs / see both*. ~30 lines server, ~80 client, and it is the prerequisite for every offline feature.
- **Client-generated operation id / idempotency key (S).** Offline draft push currently retries into duplicate
  notes; accept a client `clientRef` and return the existing note on a repeat, so a flaky network cannot clone a
  note.
- **Per-note revision history as sidecar JSONL (M).** `data/history/<noteId>.jsonl`, append `{at, title,
  content}` on save, keep 50 revisions, `GET /api/notes/:id/history` + restore. **Must not go into
  `notes.json`**, or every keystroke pays the full-DB serialisation cost. Cap content per revision; store
  diffs only if size becomes a problem (it won't at personal scale).
- **Trash with 30-day retention (S/M).** `deletedAt` on the note, filtered from lists, `GET /api/trash` +
  `POST /api/trash/:id/restore`; make `pruneOrphanUploads` retention-aware (`server.js:258-279`) so a trashed
  note doesn't lose its images. Also fixes the quadratic delete rescan by pruning on a timer, not per delete.
- **Rolling local snapshots + "download everything" (M).** `data/backups/notes-<date>.json` written on boot and
  daily, keep 14, plus `GET /api/admin/backup` streaming `db + uploads` as a single archive. Zero-dep ZIP is a
  store-only writer with a CRC32 table (~150 lines); tar.gz via `zlib.createGzip` is ~80 but Windows users need
  7-Zip. Recommend ZIP, because the user is on Windows.
- **Delta API: `GET /api/notes?summary=1&since=<ms>` + tombstones (M).** Stops shipping every note body to
  every cold start, and is the only sane foundation for a real multi-device sync loop. This is the one item here
  that is *architecture*, not feature — schedule it before the vault gets big.

**Killer small feature.** **The 409 conflict precondition with keep-mine/keep-theirs.** It is the cheapest
possible defence against the worst failure mode (silent data loss), and it is the enabling change for offline
editing on both clients. Everything else in this direction is a variation on "we kept a copy".

**Effort / first PR.** S–M. First PR: `baseUpdatedAt` check + 409 + a "someone else edited this" modal; second:
trash; third: history sidecar; fourth: backups.

**Main blocker.** The backup *download* is the fiddly part (no ZIP in stdlib), and history forces an
architectural rule the codebase doesn't yet enforce: **writes that happen often cannot touch `notes.json`**.
Also worth measuring before the delta API: at 5 000 notes the in-memory sort and full JSON rewrite are the
ceiling, and sharding per-user files is the escape hatch if it's ever hit.

---

## 6. Scoped AI — one note at a time, your key, your rules

**Pitch.** Ship AI that respects the data path: explicit per-note actions, the user's own API key (or a local
model), server-side proxying so nothing leaks to a browser, and no vault-wide index to be breached.

**Why it fits THIS product.**
- CSP `connect-src 'self'` (`server.js:65-71`) forces server-side proxying — which is exactly the privacy
  property you want to advertise: the key never leaves `data/`, the browser never sees it.
- Transfer is one HTTP call, so zero-dep is only ~150 lines of `node:https` + SSE parsing; no SDK, no bundler.
- The product's unit of work is a single note with a title and markdown body. That is the cheapest and most
  useful AI affordance on the market: summarise *this*, rewrite *this*, translate *this*.
- The owner is in China, where the sensible provider is DeepSeek-compatible (`base URL + key`): cheap, fast,
  and reachable — with the option of pointing at a local Ollama on the LAN for the truly private mode.

**Plays.**
- **"Summarize this note" / "Extract action items" (S).** A button in the editor header → modal with the result
  and an "insert as new note / append" choice. Server route `POST /api/ai/complete` with `{mode, noteId}`.
- **Rewrite / continue / translate CN↔EN (S).** Same route, different prompt, selection-aware (send only the
  selected text — smaller bill, better privacy story).
- **Auto-title + tag suggestions (S).** One cheap call returning 3 tags from a fixed vocabulary; the user
  accepts or ignores. No embedding, no index, no cost after the note is written.
- **"Ask this note" Q&A (M).** One note as context, a question box; no retrieval, no chunks, no vector store.
  This is 80% of what people think they want from a vault chatbot, at 5% of the cost.
- **Weekly digest across *selected* notes (M).** User picks notes/folder → one call → "what happened this week".
  Batched and opt-in, so the token bill stays visible.
- **Provider config in `data/settings` (S).** `{provider:'deepseek'|'openai-compatible'|'ollama', baseUrl,
  model, keyEncrypted?}` — with a hard rule: never auto-send anything on save, always show the payload size and
  estimated cost before sending.

**Cost & privacy analysis (do this in the UI, not just the doc).** Roughly: a 1 500-character note is ~700
tokens; a summary costs on the order of **¥0.001–0.002** on a DeepSeek-class model (order-of-magnitude, verify
current pricing), so 100 summaries ≈ ¥0.1–0.2. Whole-vault tagging of 5 000 notes is a one-off **single-digit
yuan** — which makes the "AI is expensive" objection false for this product, and the *privacy* objection the
real one. Therefore: per-note consent, a visible "this content will be sent to \<provider\>" line, a config
toggle to disable AI entirely, and an Ollama option for the people who mean it. Never log prompt or response
content to disk; keep only token counts.

**Killer small feature.** **Summarize-this-note.** One route, one modal, one prompt. It is the demo that makes
people take the product seriously, costs a weekend, and can be switched off without breaking anything.

**Effort / first PR.** S–M. First PR: `/api/ai/complete` proxy + key in env var, "Summarize" button, cost line
in the modal.

**Main blocker.** Not code, **judgement**: the product's entire pitch is "your notes stay on your server", and
this is the one direction that sends them elsewhere. That conflict is manageable with optics (opt-in, provider
shown, Ollama path) — but if the owner isn't comfortable making that claim, skip the direction entirely rather
than ship a half-honest version. Secondary blocker: streaming SSE parsing and a 30 s proxy timeout inside a
single-process server that also serves notes.

---

## 7. Platform & Portability — be the server other tools can talk to, and never trap a note

**Pitch.** Turn the server into a platform: tokens for the tools the owner already uses, a CLI, and Markdown
export that makes leaving easy — which is exactly why staying is safe.

**Why it fits THIS product.**
- The API is already a clean JSON REST surface with cookie auth; a token scheme is additive, not a rewrite.
- One developer, three clients, no SDKs: a documented token API plus a CLI in `tools/` lets the owner automate
  things without touching the UI at all (cron digests, `git log | notes add`, bulk imports).
- Export/portability is the answer to the #1 objection to self-hosted software ("what if I stop maintaining it").
  Markdown + frontmatter + attachments is also the bridge to Obsidian, Logseq, and every static site generator.
- The Android app hard-codes the share base URL (`android-app/README.md:64-67`) — a public-base config is a
  prerequisite for several directions and belongs here.

**Plays.**
- **API tokens with scopes and last-used (M).** `db.tokens: [{id, name, hash, scopes:['read','write','admin'],
  createdAt, lastUsedAt}]`, `Authorization: Bearer`, hashed at rest like passwords. Enables the clipper, the CLI,
  and any future sync client, without weakening the cookie session.
- **Explicit CORS allowlist (S).** `Access-Control-Allow-Origin` only for a configured origin, only for token
  routes. Needed by the bookmarklet; dangerous if done as `*`. This is the security-critical 20 lines of the
  whole capture direction.
- **`tools/notes.js` CLI (M).** `notes add --title … < file`, `notes search`, `notes cat`, `notes export`,
  `notes token`. Node 18 `fetch`, no deps. Doubles as documentation-by-example for the API.
- **Markdown vault export + import (M).** Export: one ZIP with a folder tree, `---` frontmatter (title, tags,
  pinned, created/updated, share/slug), notes as `.md`, uploads under `uploads/`, plus a `manifest.json` of the
  ids for round-tripping. Import: accept the same ZIP, or — when run locally — a directory path. Obsidian-compatible
  by construction, and the strongest possible answer to lock-in fear.
- **ICS calendar feed for dated notes (S).** `GET /api/calendar.ics?token=…` listing notes with a `date:` in the
  title/frontmatter (daily notes make this natural). ~60 lines, works in any phone calendar, zero UI.
- **PWA share target + shortcuts (S).** Shares the plumbing with Direction 3; also add `shortcuts` for "New note"
  and "Search" so the installed icon is useful on a long-press.

**Killer small feature.** **Markdown vault ZIP export.** One button that produces a folder of `.md` files plus
their images. It de-risks the entire investment, markets itself ("your notes are just Markdown files on your
disk"), and forces the frontmatter design that wikilinks and publishing both want. Import can follow later.

**Effort / first PR.** M. First PR: tokens + `/api/tokens` CRUD + Bearer auth on existing routes; second:
export ZIP; third: CLI.

**Main blocker.** ZIP in/out without dependencies — a store-only ZIP writer (local headers + central directory +
CRC32) is ~150 lines of bit-poking that must be tested by opening the file in Windows Explorer, 7-Zip, and
Obsidian. The alternative (tar.gz) is easier to write and worse to consume on Windows. Secondary: token scoping
must be right the first time, because a leaked write token on a note server is a full compromise.

---

## 8. Fit & Scale — decide who this is for before building more for anyone

**Pitch.** There are three futures — a personal vault, a small trusted circle, or a product — and the product
should commit to one on purpose rather than drift into a half-SaaS.

**Why it fits THIS product.**
- The architecture is *honest* about its scale: 100-user cap, 5 000-note cap, in-memory rate limiting, one JSON
  file, `scryptSync` on the event loop (`server.js:44-49`, `179-189`). That is a personal/family server, not a
  business.
- Multi-account, admin panel, registration toggle, and per-user isolation already exist — a 5–10 person circle
  works today; it just has no onboarding or resource governance.
- On mainland China hosting, running UGC for strangers means ICP 备案, content moderation obligations, and
  being on call. For one part-time developer, that is negative expected value.
- The most valuable "growth" feature for a circle server is not billing — it's **not being woken up at 2 a.m.**

**Plays.**
- **Invite codes instead of open registration (S).** `db.settings.inviteOnly` + one-time codes; admin shares 5
  codes, registration can stay effectively closed. ~80 lines and it removes the "someone's friend registered and
  now I'm the sysadmin of a stranger" risk.
- **Per-account storage quota (S).** Sum `db.uploads[*].size` by `by` (data already exists, `server.js:605`),
  cap at e.g. 500 MB default with an admin override, `413` on breach. Also show disk usage in the admin panel —
  this is the only realistic way a 40 GB VPS goes down.
- **Admin dashboard v2 (S/M).** Per-account: notes, storage, last sign-in, last activity, admin flag; "purge a
  user's uploads"; a health line (data file size, save latency, uptime). Replaces "SSH in and look at
  `journalctl`".
- **Operational guardrails (S).** Truncate/hash client IPs in logs; cap `data/uploads` growth; a boot-time
  sanity check that the JSON parsed and the user count is sane; a `/api/health` endpoint for uptime monitoring.
- **Monetization: don't (M/L — all cost, no upside).** You cannot charge strangers in China without a company,
  备案, an ICP-licensed site, and payment qualification; you cannot support them with one part-time developer.
  The realistic outcomes are: cost-share among friends (a WeChat/Alipay transfer for the ¥30/month VPS),
  a portfolio piece, or "sell the APK/self-host template" — all compatible with shipping the product for its
  own sake. If money ever matters, revisit only after the publishing direction (1) has proven real readers.

**Killer small feature.** **Invite codes + a storage quota.** Two small changes that turn "a dev server with
100 open slots" into "a server I can invite a colleague to without worrying".

**Effort / first PR.** S. First PR: invite-only setting + quota check in `/api/uploads` + usage in the admin
panel.

**Main blocker.** None technical — the decision. The real risk is drift: building comments (Direction 1's
collaboration endgame) or AI for an audience that doesn't exist, while the single-user experience quietly
stays the only thing that's finished.

---

## 9. Ranked roadmap (if the owner asked "what do I do next?")

| Rank | Bet | Phase | Value / Effort | Why it's ranked here |
| --- | --- | --- | --- | --- |
| 1 | **Publishing layer** (share-page `<head>`+OG, QR, expiry/password, views) | Phase 1–2 | high / S–M | Improves every existing share immediately; unique to this product; no new data model. |
| 2 | **Durability** (409 conflicts, trash, history sidecar, backups) | Phase 1–2 | high / S–M | Protects the only asset the user has; prerequisite for all offline work. |
| 3 | **Knowledge loop** (wikilinks, backlinks, daily, resurface) | Phase 1 | high / S | Pure client-side, zero schema, retroactive value, Obsidian-compatible syntax. |
| 4 | **Security/trust** (HTTPS+region, device list, audit log) | Phase 1 | high / S–M | Cheap visible trust; unblocks every privacy claim (and WeChat link opening). |
| 5 | **Capture** (share targets, OCR, bookmarklet after tokens) | Phase 2–3 | high / S–M | Daily value on the device the owner actually uses. |
| 6 | **Scoped AI** (summarize / ask-this-note, BYO key) | Phase 3 | med / S–M | Cheap, demo-worthy, but only if the privacy optics are acceptable. |
| 7 | **Platform/portability** (tokens, CLI, Markdown export) | Phase 2–3 | med / M | Enables capture + kills lock-in fear; export is the cheapest part. |
| 8 | **Fit & scale** (invite codes, quota, admin v2) | Phase 2 | med / S | Small work, prevents the only realistic operational failure. |

Suggested sequencing for a part-time developer:

- **Phase 1 (~2 weeks):** HTTPS/region decision + Caddy → share-page `<head>` with OG meta + QR → wikilinks &
  backlinks → 409 conflict precondition → device list & revoke.
- **Phase 2 (~4 weeks):** trash → history sidecar → rolling snapshots + ZIP backup download → share
  expiry/password/per-recipient → `?summary=1&since=` → invite codes + quota.
- **Phase 3 (~6 weeks):** API tokens + CORS → Android share target + OCR → scoped AI → Markdown export/import +
  CLI → published folder pages + RSS.
- **Phase 4 (only if committed):** the moonshots below.

---

## 10. Ideas to reject or defer (be honest with yourself)

**Reject outright.**

1. **Real-time collaborative editing (CRDT/Yjs/WebSocket OT).** Needs a persistent connection, per-keystroke
   operation broadcast, and a data model that is not "the whole DB rewritten to one JSON file"
   (`server.js:157-175`). There is no co-editing demand in a personal vault shared with three friends, and the
   engineering cost is 10× every other item in this document. *Instead:* per-recipient share links and comments
   (Direction 1), which solve the actual social need — "read this and tell me what you think".
2. **A full-vault RAG chatbot / embeddings semantic search.** Requires an embedding model (no zero-dep option),
   a vector index (not a JSON file), ~5 000 chunks to keep fresh, and a 2 GiB VPS to run it on — plus it
   contradicts the privacy pitch by shipping the entire vault to a third party. *Instead:* better lexical search
   (ranking + CJK bigrams + snippets, ~a day) and "ask this note" (Direction 6), which covers the common case.
3. **WeChat 公众号 / personal-WeChat bot.** Three gates, all closed: 认证 requires an enterprise subject, the
   callback URL requires a filed domain with public HTTPS, and unofficial bot protocols violate WeChat's terms
   (ban risk for the account). Plus the owner already has 文件传输助手 for the "send it to myself" case. *Instead:*
   the Android share target, which is faster than opening WeChat.
4. **Public multi-tenant SaaS with billing.** UGC in mainland China = 备案 + moderation + on-call, on an
   architecture with 100-user caps and in-memory rate limiting. One part-time developer cannot run this and
   should not try. *Instead:* invite-only accounts for a trusted circle (Direction 8).
5. **Full-vault end-to-end encryption as the default.** It breaks server-rendered share pages (Direction 1),
   search before unlock, admin password-reset-by-deletion, the Android client's parity, and the "copy one file"
   backup story — while *not* fixing the actual hole, which is plain HTTP. *Instead:* HTTPS now; per-note
   "sealed notes" as a moonshot.
6. **A Notion-style WYSIWYG/block editor.** Requires ProseMirror/Tiptap or an equivalent — i.e. the first npm
   dependency, which is the product's defining constraint. A split-pane textarea + hand-written renderer is the
   honest shape of this app, and it is also why it is fast and dependency-free. *Instead:* slash commands and a
   formatting toolbar (already exists) plus an outline rail.
7. **A native desktop app (Electron/Tauri).** The PWA already installs and the phone app already exists; a third
   client triples the parity burden for zero new capability. *Instead:* make the PWA actually work offline
   (Direction 5) — that is the feature a desktop wrapper would be pretending to offer.
8. **A graph view.** Beautiful in screenshots, rarely used in practice, and a force-directed layout in vanilla JS
   is a week of math with no data-model payoff. The vault's value is in backlinks you can *read*, not nodes you
   can drag. *Instead:* the backlinks panel and tag pages.

**Defer, with explicit trigger conditions.**

- **Server-side OCR / transcription.** No zero-dep option; the VPS is the worst place to run it. Revisit only if
  a transcription API is already integrated for Direction 6.
- **Email-to-note via built-in SMTP.** Aliyun blocks outbound port 25 by default, inbound SMTP means hosting mail
  and fighting spam, and IMAP polling is a protocol stack in itself. Use the token webhook (Direction 3) instead;
  revisit only if a provider offers a signed inbound-mail webhook.
- **Migrating storage from `notes.json` to SQLite (`node:sqlite`) or Postgres.** The single file *is* the selling
  point. Trigger: data file > ~50 MB, or p95 save latency > 100 ms, or a second process ever becomes necessary.
  Until then, shard per user before changing engines.
- **Spaced repetition (SRS).** Only if the "resurface" card proves that old notes get reopened. It needs review
  state, a scheduler, and Android parity — a project, not a feature.
- **Paid plans / donations infrastructure.** A donation link costs nothing; payment integration costs weeks and
  creates obligations. Revisit only after Direction 1 has real external readers.

---

## 11. Moonshots (pick at most one; each is 1–2 months)

**M1. "Funshare" as a personal publishing platform, not a note app.**
Public pages on the user's own domain with a slug, sitemap, RSS, SEO, password/expiry controls, per-recipient
tracking, and print/PDF export — a one-person 公众号 replacement that needs no corporate entity and gives readers
no account. *Why it differentiates:* every competitor either pushes readers into a sign-in wall (Notion embeds,
语雀, 飞书) or requires the author to pay a subscription and trust a SaaS; this is the only self-hosted option
where the reader experience is genuinely first-class. *Cost:* Direction 1 fully built plus a real design pass on
the share page, plus the ICP/HTTPS prerequisite. *Hardest problem:* making a hand-rolled template look like a
designed site without a CSS framework, and making WeChat happy about the URL.

**M2. Sealed notes — per-note E2E with zero-knowledge share links.**
Encrypt individual notes client-side (WebCrypto, AES-GCM, key derived from a per-note passphrase or stored per
device) and put the key in the URL **fragment**, which browsers never send to the server: `…/share/<token>#k=…`.
The server stores ciphertext it cannot read; recipients decrypt in the browser. *Why it is more feasible than it
sounds here:* markdown rendering is already client-side, so the plaintext never needed to reach the server for
display; only search, sharing previews, and the Android client pay. *Cost:* key management UX (unlock per device,
no recovery), asset encryption for images, Android crypto parity, and no OG cards for sealed notes. *Hardest
problem:* the UX of a forgotten key — the honest answer is "there is no recovery", which must be designed in, not
apologised for later.

**M3. Offline-first capture with an operation log (not CRDT).**
Every device appends operations to a local log; the server exposes `?since=` deltas plus tombstones; the client
merges at paragraph granularity with last-writer-wins per block and undoable merges. Capture from the share sheet
lands in the outbox instantly and syncs whenever the network appears. *Why it differentiates:* a three-client
product with a flaky-network reality (mainland VPS, phone on the subway, laptop on hotel Wi-Fi) where the
competition either has no native app or no self-hosting. *Cost:* a real sync engine, schema versioning, and
careful Android work — the largest engineering item in the catalog. *Hardest problem:* convincing yourself that
"dumber than CRDT" is enough — it is, for text notes at this scale, but only if the merge unit is chosen
correctly (paragraph, not character) and every merge is reversible via Direction 5's history.

---

## 12. Five decisions the owner has to make before any of this is scheduled

1. **Is this "my notes" or "my publishing tool"?** If publishing, Direction 1 gets 60% of the next quarter and
   everything else is maintenance.
2. **Move the VPS to Hong Kong/Singapore for HTTPS now, or wait for 备案?** This gates trust features, WeChat
   link opening, and the whole publishing moonshot.
3. **Is the Android app a first-class client or a companion?** Every direction costs 1.3–2× if it must ship on
   both; the answer determines what gets deferred.
4. **Will note content ever be sent to a third-party AI API, even opt-in?** If no, delete Direction 6 and stop
   pretending; if yes, design the consent UI first.
5. **How many real users by end of year — 1, 5, or 100?** Direction 8's answer is "1–5"; anything above that
   turns a pleasant side project into an unpaid on-call job.