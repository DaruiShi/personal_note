# Feature brainstorm — Personal Notes / Funshare (October 2026)

**What this is.** A prioritized menu of functions to add, built from a full read of `server.js` (925 lines),
`public/` (~3,200 lines), and `android-app/` (~5,200 lines of Kotlin). It is organized by *what it buys you per
day of work*, not by how cool it sounds. Four deep-dive evidence documents sit in `docs/brainstorm/`; this file is
the decision layer on top of them.

**Effort bands** (one part-time developer): **S** ≤ 2 dev-days · **M** 3–7 days · **L** 2–4 weeks.

---

## The verdict in one paragraph

You do not have a feature-shortage problem. You have a **trust-shortage problem** and one **under-exploited
advantage**. The trust problem: a note can be deleted forever with one tap and no undo, autosave can overwrite
your work with no history, two devices editing the same note silently destroy each other, a corrupt
`data/notes.json` starts the server *empty* and then overwrites the original, the web app does not work offline
at all, and the Android client can silently drop offline edits to existing notes. The advantage: **the share link
is genuinely rare** — a read-only page you can hand to anyone, no account needed, images and PDFs included — and
its share card currently shows up in chat apps as an empty untitled URL because the share page is a client-rendered
SPA with no `<head>` metadata.

So: first make the thing safe to trust, then make the one thing nobody else gives away excellent, then add
delightful depth. A new feature added on top of a delete-with-no-undo data model inherits that risk.

---

## 0. What actually exists today (verified, not from the README)

| Area | Reality |
|---|---|
| Server | 925-line zero-dependency Node HTTP server, 25 `/api` routes, single `data/notes.json` rewritten atomically on every mutation |
| Auth | scrypt passwords, HttpOnly `SameSite=Strict` cookie sessions, in-memory IP rate limits; **cookie-only** — no API tokens, no CORS |
| Data | users, sessions, settings, notes, folders, uploads metadata; 5,000 notes / 100 folders / 100 users caps; 1 MB note, 2 MB body, 25 MB upload |
| Notes | Markdown + a hand-written LaTeX engine, tags, pinning, folders with order+pinning, autosave, client-side substring search |
| Sharing | one permanent capability token per note, read-only, title/content/updated only; attachments served with `?s=<token>` |
| Web | 2,073-line vanilla-JS SPA + 903-line CSS, strict CSP (no CDN, no inline script), no build step, **no service worker** |
| Android | Kotlin/Compose, v1.16, cookie auth, crude offline draft cache, 29-row parity table with web (see appendix) |
| Deploy | Aliyun VPS, plain **HTTP on IP:3000**, ICP filing pending for `funshare.site`, Caddy config ready |

Three facts that constrain every idea below:

1. **Zero dependencies and a strict CSP** (`script-src 'self'`) mean no CDN libraries. Mermaid/Prism/Marked must be
   vendored, or hand-written.
2. **The whole DB is re-serialised to one JSON file on every write** (`server.js:157-175`). Anything that writes on
   a cadence — revision history, audit log, view counters, review state — must live in **sidecar files**, not in
   `db`, or one big vault makes every login expensive. This is the single most important architectural rule for
   this brainstorm.
3. **A v1.16 APK is already shipped** and talks to this API. The server cannot change response shapes unilaterally.
   Add a capability list to `GET /api/session` and version-aware behaviour before touching `/api/notes` contracts.

---

## Tier 0 — "Features" that are really safety (do these first)

These are not glamorous, but they are the highest-value items on the list, because everything else sits on top of
them.

| # | Add | Why it is Tier 0 | Effort |
|---|---|---|---|
| 0.1 | **Trash / soft delete + restore** | Delete is a permanent array filter today (`server.js:725-730`) and the delete icon sits one tap from pin (`public/index.html:103`). One mis-click is unrecoverable. | M |
| 0.2 | **Revision history (sidecar `data/history/<noteId>.jsonl`)** | Autosave + full-replacement `PUT` (`server.js:717`) means one bad save destroys content with no diff and no undo. Android and web already race each other. Sidecar keeps `notes.json` small. | M |
| 0.3 | **Optimistic concurrency (`rev` + 409 + "keep both" copy)** | Two tabs or phone+laptop edits: last write silently wins (`server.js:715-724`). This is the bug users discover right after trusting you with real notes. | S–M |
| 0.4 | **Corrupt-DB quarantine + rolling snapshots** | If `notes.json` fails to parse the server starts **empty** (`server.js:149-151`), registration opens, and the next save writes over the original (`server.js:157-175`). Rename the bad file and refuse to boot; snapshot `notes.json` + `uploads/` on a timer and keep N rotations. | S |
| 0.5 | **Fix the Android data-loss and privacy defects** | (a) offline edits to *existing* notes are silently discarded on next sync; (b) the session cookie is attached to **any** host, including third-party images in preview, leaking the cookie; (c) cached notes/drafts survive sign-out and can bleed into another account. Details in `docs/brainstorm/android-analysis.md` §3.6. | S–M |
| 0.6 | **HTTPS + real domain** | On `http://IP:3000` the session cookie is never `Secure`, the password crosses the network in clear text on first run, and WeChat may refuse to open share links. Moving the ECS to HK/Singapore is a one-day workaround for the ICP wait. Unblocks every privacy claim and the share story. | S (ops) |
| 0.7 | **Repo hygiene: remove the signing key** | `android-app/keystore/funshare-release.jks` sits in the tree with its password in plaintext in `app/build.gradle.kts:23,25` (and `android-app/README.md`). There is no `.git` yet — a first `git add -A` publishes the key that authorises update-installs of your app. Also 17 APKs (~188 MB) and `local.properties`. Fix `.gitignore` now, before the repo exists. | S |

**Why 0.1–0.4 beat any new feature:** a note app's entire value proposition is "my notes will still be there".
Right now the answers are "no undo", "no history", "no conflict warning", and "a corrupt file means an empty
server". Fix those four and the product feels categorically more serious.

---

## Tier 1 — One-week wins (almost all client-side, no server change)

### Web / general

| # | Add | Why it punches above its weight | Effort |
|---|---|---|---|
| 1.1 | **`[[wikilinks]]` + backlinks panel** | All notes are already in memory (`public/app.js:626`); the inline renderer has a clean insertion point (`app.js:286`). Turns a flat list into a wiki, enables Obsidian-compatible export, costs ~1 day. **Best value/effort on this page.** | S |
| 1.2 | **Server-rendered `<head>` for share pages (+ OG image, QR code)** | Share pages are served as the SPA shell (`server.js:900-901`), so chat clients see no title/description/thumbnail — every shared link looks like spam. ~80 lines in the `/share/` branch fixes **every existing and future share at once**. Add a hand-rolled QR (~150 lines, no deps) to the share modal for phone-to-phone handoff. | S |
| 1.3 | **Command palette (Ctrl+K)** | Ctrl+K currently only focuses search (`app.js:2008`). A palette that jumps to any note and runs any action is the highest-leverage keyboard feature a notes app can have. | M |
| 1.4 | **Daily notes / journal** | "Today" button + date navigation; needs **no schema change**, just `POST /api/notes` with a `YYYY-MM-DD` title and a `daily` tag. The "on this day" resurfacing card is a bonus that makes old notes feel alive. | S–M |
| 1.5 | **Outline / TOC with heading anchors** | The renderer already parses every heading level+text (`app.js:365`); emitting slugs is a dozen lines. Instant deep links. | S |
| 1.6 | **Callouts (`> [!NOTE]`) + code-block copy button** | Blockquote handling is already recursive (`app.js:375`); fence rendering already knows the language (`app.js:354`) and a `copyText()` helper exists. Two features, one afternoon. | S |
| 1.7 | **Tag chips in rendered notes + tag autocomplete + global tag list** | Tag filter machinery already exists (`app.js:1024`); tags are free text today with no autocomplete. Makes tags actually usable without any schema work. | S |
| 1.8 | **Sort selector + focus mode + print stylesheet + per-note `.md` download** | All four are tiny, all four are visible quality-of-life upgrades. Print CSS answers "export to PDF" with the browser's own save-as-PDF. | S each |
| 1.9 | **Accessibility + keyboard pass** | Note cards and folder rows are non-focusable `<div>`s (`app.js:977`, `app.js:682`), modals have no focus trap, save status has no `aria-live`, muted text is ~2.4:1 contrast. A real accessibility floor is a differentiator for a "private" tool. | S–M |
| 1.10 | **Dark-mode pre-paint script** | A same-origin `public/theme.js` in `<head>` kills the white flash for dark-theme users without violating CSP. | S |

### Android (highest daily value per day of work)

| # | Add | Why | Effort |
|---|---|---|---|
| 1.11 | **Share-sheet capture target** (`ACTION_SEND` / `ACTION_PROCESS_TEXT` → new note) | Share a link or selected text from any app straight into a note. The single most valuable mobile feature, and it needs **no server change** — reuse the existing upload pipeline. | S |
| 1.12 | **Biometric app lock + `FLAG_SECURE`** | One screen of code; turns "my private notes" from a claim into a property. | S |
| 1.13 | **Fix backup exposure** | `allowBackup=true` with no `dataExtractionRules` means the plaintext session cookie and the whole note cache are eligible for Google/D2D backup. | S |
| 1.14 | **Quick-settings tile, launcher shortcuts, proper share-out** | Each is a small manifest+intent job; they make the app feel native rather than a wrapped web page. | S each |
| 1.15 | **Reuse existing share link instead of rotating it** | The app has no way to *show* a share URL; tapping Share POSTs and rotates the token (`server.js:738-742`), breaking links already sent to people. Parse `share` into the model and add copy/view. | S |

---

## Tier 2 — Server features worth their migration cost

| # | Add | Why now, why server-side | Effort |
|---|---|---|---|
| 2.1 | **Delta sync: `GET /api/notes?since=&summary=1` + tombstones** | `GET /api/notes` ships every note's full content on every load (`server.js:691-696`). This is the scaling wall for the phone, for real search, and for any offline story. Keep the no-parameter shape for the shipped APK. | M |
| 2.2 | **API tokens (`Authorization: Bearer`) + optional CORS allowlist** | Auth is cookie-only, so no CLI, no bookmarklet, no web clipper, no third-party client. Tokens are the substrate for capture; hash them at rest (sessions are currently plaintext in the JSON file). | M |
| 2.3 | **Share controls: expiry, password, per-recipient links, view counts** | `note.share = {token, createdAt}` is all-or-nothing: you can revoke everyone or nobody, forever. `note.shares[]` with label+expiry+password makes "revoke Li's link" possible without building an ACL. View counts go in a sidecar, never in `notes.json`. | M |
| 2.4 | **Per-account storage quota + attachment manager** | 25 MB per file, unlimited files, 100 accounts, and disk exhaustion only logs an error (`server.js:170`) — which loses writes for *everyone*. The metadata is already recorded (`server.js:605`), so accounting is ~20 lines. Add `GET/DELETE /api/uploads` and a startup reconciliation. | M |
| 2.5 | **Markdown + ZIP export / import** | The only export is a client-built JSON blob with no attachments and there is no import at all. Portability is the escape hatch a self-hoster needs before trusting a tool with years of notes. Note `.md` uploads are currently accepted-but-unservable (`server.js:41` vs `:210`) — fix that first. | M–L |
| 2.6 | **Batch endpoint (`POST /api/notes/batch`) + bulk UI** | No way to multi-select, batch-move, batch-tag or batch-delete. The client can only loop, producing partial failures. | M |
| 2.7 | **Tags as first-class entities** | Tags are free strings; renaming/merging means rewriting every note and there is no tag list endpoint. | M |
| 2.8 | **ETags / 304 on list + share** | Cheap bandwidth/CPU win that pairs with delta sync. | S |
| 2.9 | **Session/device list + revoke** | "Sign out everywhere" exists but there is no "which devices am I signed in on". Sessions only store `{uid, exp}`, so add user-agent/created-at. | S |

---

## Tier 3 — Strategic bets (pick at most two)

**3.1 The publishing layer — lean into what "Funshare" already means.** Share links are the one capability
competitors charge for or gate behind accounts. Build on Tier 1.2: a served share page that looks designed,
per-recipient links with expiry/password, QR, view counts, comments from anonymous readers scoped to a token, and
optionally "publish a folder as a mini-site" with an index page and RSS. This is the axis where a self-hosted
server beats Obsidian Publish and avoids Notion's slow, chrome-heavy pages in mainland China.

**3.2 Scoped AI — one note at a time, your key, proxied by the server.** CSP `connect-src 'self'` means a browser
cannot call OpenAI directly, so the server must proxy — which is convenient, because the key then never reaches a
browser. Summarize / ask-this-note / auto-tag a *single* note, with explicit per-action consent and a
local-Ollama path as the privacy answer. Cheap to build and demo-worthy; do **not** build vault-wide RAG.

**3.3 Offline-first with an operation log ("dumber than CRDT").** The honest version of sync for three clients on
flaky networks: local outbox, `?since=` deltas, paragraph-granular merge, every merge undoable via Tier 0.2. This
is the largest engineering item in the list; only worth it once delta sync and history exist.

**3.4 Sealed notes (per-note E2E).** Encrypt a note client-side, put the key in the URL **fragment** (browsers
never send it to the server) and the server stores ciphertext it cannot read. Feasible here specifically because
markdown already renders client-side. Excellent for the privacy story; kills OG previews and search for those
notes, and there is no key recovery — design the UX accordingly.

**3.5 Cross-account sharing (shared notebooks, "shared with me").** Real demand for a family/team instance, but it
is the riskiest item on this list: every note lookup needs an ownership/ACL check, and one missed `userId` filter
leaks someone else's notes. Do it only after Tier 0, and consider capability links + comments as the safer 80%.

---

## Do not build (and why)

- **Real-time collaborative editing (CRDT/OT).** Incompatible with whole-file JSON persistence, 10× the cost of
  everything else here, and nobody co-edits a personal vault with three friends. Capability links + comments cover
  the actual social need.
- **Full-vault RAG / embeddings semantic search.** No zero-dependency embedding model, a vector index that is not a
  JSON file, and it contradicts the privacy pitch. Better lexical search (CJK bigrams + ranking + snippets) is an
  afternoon.
- **A Notion-style block editor.** ProseMirror/Tiptap would be the first npm dependency — the thing that defines
  this product. The textarea + hand-written renderer is the honest architecture.
- **A graph view.** Great screenshots, rarely used; backlinks you can read beat nodes you can drag.
- **Native desktop app.** Two clients is already the parity tax; the PWA is the desktop story once it works offline.
- **WeChat bot / 公众号, public SaaS with billing, default full-vault E2E.** Each is gated by ICP/enterprise/
  moderation/on-call realities that a part-time operator should not take on.
- **WeChat-specific link optimisation is pointless before 3.1/0.6** — fix the URL and the `<head>` first.

---

## If you only do five things (my recommendation)

1. **Trash + revision history + `rev`/409 conflicts** (Tier 0.1–0.3). ~1.5 weeks. This is the feature that changes
   how the product *feels*, and every later feature inherits it.
2. **Server-rendered share page head + QR** (Tier 1.2). 1–2 days. Improves every link you have ever sent.
3. **Wikilinks + backlinks + daily notes on the web** (Tier 1.1, 1.4). ~3 days. Biggest perceived leap for the
   least code, and it makes export to Obsidian meaningful.
4. **HTTPS + keystore/.gitignore hygiene + the three Android defects** (Tier 0.5–0.7). Mostly ops, a few days.
   Removes the "will I lose my data / is this safe" objections.
5. **Android share-sheet capture + biometric lock** (Tier 1.11–1.12). ~2 days. Makes the phone app the fastest way
   to capture a thought — i.e. the reason to keep it installed.

That is roughly a month of part-time work and it moves the product from "impressive side project" to "thing I'd
actually trust with my notes".

---

## Decisions that change the answer

1. **Is this your notebook, or your publishing tool?** If publishing, Tier 3.1 gets most of the next quarter.
2. **Is the Android app a first-class client or a companion?** Every feature costs ~1.3–1.5× if it must ship on
   both. That answer decides what gets deferred.
3. **How many real users by year end — 1, 5, or 100?** 1–5 means quotas, invite codes and admin v2 are optional;
   100 turns a pleasant project into unpaid on-call work.
4. **Will note content ever leave the server (AI API, OCR, email)?** If never, delete Tier 3.2 and stop pretending.
5. **Do you want the storage model to stay one JSON file forever?** The rule "cadence writes go to sidecar files"
   keeps it viable; migrate to SQLite only if the file passes ~50 MB or p95 save latency exceeds ~100 ms.

---

## Appendix — evidence documents

| Document | Contents |
|---|---|
| [`docs/brainstorm/backend-analysis.md`](docs/brainstorm/backend-analysis.md) | 25-route API inventory, data model, 15 architectural constraints, 18 backend feature specs, 20-item fragility register (F1–F20) |
| [`docs/brainstorm/web-ui-analysis.md`](docs/brainstorm/web-ui-analysis.md) | Implemented-feature inventory, editor/renderer capabilities and limits, 16 verified UX frictions, 20 web feature specs, 14 "cheap wins", README-vs-code discrepancy table |
| [`docs/brainstorm/android-analysis.md`](docs/brainstorm/android-analysis.md) | 29-row web↔Android parity table, API surface used, platform-capability gaps, 7 client defects (B1–B7), 20 mobile feature specs, signing/test hygiene |
| [`docs/brainstorm/ideation-catalog.md`](docs/brainstorm/ideation-catalog.md) | 8 strategic directions, constraint-physics table, ranked phased roadmap, rejected/deferred ideas with trigger conditions, 3 moonshots, 5 owner decisions |