# Vibe-coding prompt — share-page `<head>` (link previews) + QR codes

Paste everything between the `====` markers into your coding agent.

**Important for you, the human:** Phase A is the whole user-visible win (every share link stops looking like spam).
Phase B (QR) is additive and riskier - if it fights back, ship Phase A alone and set `features.qr: false`. Do not let
a QR bug block the head feature.

====

## Task

Today `/share/<token>` returns the SPA shell (`server.js:1233`), so crawlers and chat clients see no title, no
description and no image - every shared link unfurls as a blank URL. Fix that by serving a server-rendered
`<head>` for every share page. Then add a QR code so the link can be handed to a phone without typing.

Two independent phases. Phase A must be complete, tested and shippable on its own before Phase B starts.

### Phase A - server-rendered share `<head>`

Goal: `GET /share/<32-hex-token>` responds with the existing SPA shell but with a real `<title>`, a description,
Open Graph / Twitter Card tags, an absolute canonical URL, and `noindex` - all built from the note behind the token.

### Phase B - QR code

Goal: `GET /share/<32-hex-token>/qr.svg` returns a scannable QR code of the absolute share URL, and the share modal
in the web app displays it.

## Hard constraints - violate none of them

- **Zero npm dependencies.** Node standard library only. Do not add a single entry to `dependencies`.
- **No inline `<script>`, no CDN.** CSP is `default-src 'self'; img-src 'self' data: https: http:; style-src 'self';
  script-src 'self'` (`server.js:69-75`). A server-rendered `<head>` needs no script, so this is fine - keep it that way.
- **Do not server-render the note body.** The markdown renderer lives only in `public/app.js`. The body stays
  client-rendered; only `<head>` is server-rendered. Duplicating the renderer in Node is out of scope.
- **Share pages must never be indexable.** `noindex,nofollow,noarchive` in both a `<meta>` tag and an
  `X-Robots-Tag` header. A capability URL that Google indexes is a privacy incident.
- **Never change the shape of `GET /api/share/:token`** (`server.js:642-647`) - the SPA depends on it.
- **No new top-level `db` collection.** `loadDb` (`server.js:120-131`) rebuilds `db` from a whitelist and silently
  drops unknown keys. Nothing here needs persistence, so add none.
- **Reuse the existing test harness** in `test/helpers.js` (`startServer`, `register`, `req`, `createNote`,
  `uploadPng`) rather than writing a new one.

## Phase A - implementation

### A1. Public origin resolution

Add a `PUBLIC_BASE_URL` environment variable (e.g. `https://funshare.site`). It must be **optional**:

- If set and it parses to an `http:`/`https:` URL, use it with any trailing `/` stripped.
- If set and invalid, log one warning at startup and fall back to derivation.
- If unset, derive per request: scheme from the first value of `X-Forwarded-Proto`, else
  `req.socket.encrypted ? 'https' : 'http'`; host from the `Host` header, accepted only if it matches
  `/^[A-Za-z0-9.\-]+(:\d{1,5})?$/` and is at most 253 chars - otherwise fall back to `localhost:${PORT}`.
  Never interpolate a raw `Host` header into HTML without that validation.
- Log one startup warning when `PUBLIC_BASE_URL` is unset: absolute links will follow the request host.

Expose the resolved origin to the SPA by adding `publicBaseUrl` (string) to the `GET /api/session` response
(`server.js:628-638`), next to the existing `features` object. It may be `null` when unset.

### A2. Cache the shell once at startup

Read `public/index.html` into memory at startup (reuse the existing startup sequence, after `loadDb`). If the read
fails, log a warning and behave exactly as today (`serveStatic(res, '/')` for `/share/`). Do not read it per request.

Add a `renderShareHead(note, origin, token)` function that returns the meta-tag block and the document title. Keep
it a pure function of its inputs so it is unit-testable.

### A3. Route behaviour

Replace the `pathname.startsWith('/share/')` branch (`server.js:1233`, inside `route()` at `server.js:1223-1235`)

- with an exact match on `/^\/share\/([a-f0-9]{32})$/`. For that path:
  - Look the note up by `n.share.token === token` **and** `n.deletedAt == null` (same predicate as
    `server.js:644-645`).
  - Found, healthy: respond **200** with the shell whose `<head>` carries the per-note tags.
  - Unknown / revoked / trashed / malformed token: respond **404** with the shell too (so the SPA still renders its
    friendly "Note unavailable" message), but with a generic title, `noindex`, and no OG tags.
- Any other `/share/...` path (e.g. `/share/abc`, `/share/`) must also 404 the same way, not 200.
- Keep serving the normal app (`/`) unchanged.
- Keep `Cache-Control: no-store` and add `X-Robots-Tag: noindex, nofollow, noarchive` to these responses.

Write a small helper (e.g. `sendShareShell(res, status, html)`) that sets
`Content-Type: text/html; charset=utf-8`, the cache/robots headers, and `...SECURITY_HEADERS`.

### A4. Tags to emit

Insert into the shell's `<head>`, before `</head>` (the shell's head is `public/index.html:3-13`). Every value below
must be HTML-attribute-escaped (see A6).

- `<title>{title} - Notes</title>` - replace the existing `<title>Notes</title>`, do not append a second title.
  Use exactly the same separator the client uses at `public/app.js:2354` (an em dash, `—`), so the title does not
  visibly change when the SPA boots and overwrites `document.title`.
- `<meta name="description" content="{excerpt}">`
- `<link rel="canonical" href="{absoluteUrl}">`
- `<meta name="robots" content="noindex, nofollow, noarchive">`
- `<meta property="og:type" content="article">`
- `<meta property="og:site_name" content="Notes">`
- `<meta property="og:title" content="{title}">`
- `<meta property="og:description" content="{excerpt}">`
- `<meta property="og:url" content="{absoluteUrl}">`
- `<meta property="og:image" content="{imageUrl}">` and `<meta property="og:image:alt" content="{imageAlt}">` -
  **only when an image is available** (see A5).
- `<meta property="article:modified_time" content="{ISO 8601 of note.updatedAt}">`
- `<meta name="twitter:card" content="summary_large_image">` when an image is available, otherwise `summary`.
- `<meta name="twitter:title">`, `<meta name="twitter:description">`, and `<meta name="twitter:image">` when present.

`{title}` is `note.title` or `Untitled` when empty. `{absoluteUrl}` is `${origin}/share/${token}`.

### A5. Excerpt and image extraction

**Excerpt** (target 160 characters, single line):

1. Strip fenced code blocks, inline backticks, images, link syntax (`[text](url)` -> `text`), raw HTML tags,
   heading hashes, emphasis markers, blockquote markers, list markers, and table pipes/dashes.
2. Collapse all whitespace to single spaces and trim.
3. Truncate to at most 160 characters without splitting a surrogate pair or grapheme cluster (iterate
   `Array.from(text)` or use `Intl.Segmenter`; do not use `String.prototype.slice` on the code-unit index).
4. Append `...` when truncated.
5. If the result is empty, use `A shared note.`

**Image**: find the first image the note references, in this order:

1. `![alt](/uploads/<32hex>.<png|jpg|jpeg|gif|webp>)` - take the URL and the alt text.
2. Any bare `/uploads/<32hex>.<png|jpg|jpeg|gif|webp>` occurrence in the content.

Validate the matched path against `/^\/uploads\/[a-f0-9]{32}\.(png|jpg|jpeg|gif|webp)$/` before using it - the point
is to make `og:image` impossible to point at an arbitrary (or off-site) URL. Build
`{imageUrl} = ${origin}${uploadPath}?s=${token}` so the share token authorises the fetch.

If the note has no image: if `public/og-default.png` exists at startup, use `${origin}/og-default.png`; otherwise
omit `og:image`/`twitter:image` entirely (a compact card with title + description is still a huge improvement over
today). Do not ship a generated placeholder.

### A6. Escaping (this is the security-critical part)

Write one `escapeHtml(value)` that replaces `&`, `<`, `>`, `"` and `'` with entities, and use it for **every**
interpolated value - text nodes and attribute values alike. A note titled
`</title><script>alert(1)</script>` must produce inert HTML. Do not concatenate any un-escaped user string into the
shell. The excerpt, title, alt text and URLs all pass through it.

### A7. Do not regress the share page body

The SPA still fetches `/api/share/<token>`, sets `document.title` (`public/app.js:2354`) and rewrites `/uploads/`
URLs to add `?s=<token>` (`app.js:2361-2368`). Leave that logic alone. Making the server `<title>` match the
client's format keeps the title from flickering; keep the values consistent.

## Phase B - QR code

Only start this once Phase A is green.

### B1. Endpoint

`GET /share/<32-hex-token>/qr.svg` -> `image/svg+xml; charset=utf-8`, the QR code of the absolute share URL
(`${origin}/share/${token}`). Rules: same token lookup and the same 404 behaviour as A3 when the note is unknown,
revoked, trashed or the token is malformed. `Cache-Control: public, max-age=86400` (the QR for a token never
changes; a revoked token's QR still only encodes a URL that now 404s). Include `...SECURITY_HEADERS`.

Add `qr: true` to the `features` object in `GET /api/session`, and only advertise it if the encoder module loaded
successfully.

### B2. Encoder module

Put it in `lib/qr.js` (create `lib/`), exporting `encode(text, {ecc})` -> `{size, modules}` and
`toSvg(text, opts)` -> SVG string. No DOM, no imports beyond Node built-ins, so `node --test` can require it.

**Strongly preferred: vendor a known-good implementation.** If you have access to a well-tested MIT/0BSD QR encoder
(e.g. Project Nayuki's `qrcodegen` JS port), copy it into `lib/qr.js` verbatim with its license header and adapt the
export. This is not an npm dependency and does not violate the zero-dependency rule. Hand-rolling QR is where this
task most often fails.

**If you must implement it yourself**, follow ISO/IEC 18004 exactly - byte mode, error-correction level **M**,
versions 1-10, automatic version selection, all eight masks with the standard penalty scoring. The constants:

- Size is `17 + 4 * version`. Finder patterns (7x7) at the top-left, top-right and bottom-left; timing patterns on
  row and column 6; the dark module at `(8, size - 8)`.
- Alignment pattern centres: v1 none; v2 `[6,18]`; v3 `[6,22]`; v4 `[6,26]`; v5 `[6,30]`; v6 `[6,34]`;
  v7 `[6,22,38]`; v8 `[6,24,42]`; v9 `[6,26,46]`; v10 `[6,28,50]` (skip centres that collide with a finder).
- ECC M, per version: data codewords `[16,28,44,64,86,108,124,154,182,216]`; EC codewords per block
  `[10,16,26,18,24,16,18,22,22,26]`; block count `[1,1,1,2,2,4,4,4,5,5]`. Version 8 splits `154` data codewords into
  `2x38 + 2x39`; v9 `182` into `3x36 + 2x37`; v10 `216` into `4x43 + 1x44`. Assert internally that
  `sum(blockData) + ecPerBlock * blocks === totalCodewords` for the version you built, and that total codewords
  equal 26/44/70/100/134/172/196/242/292/346 for v1-v10 - a typo in a table should throw, not ship.
- Data bitstream: mode indicator `0100`, character count 8 bits (v1-9) or 16 bits (v10+), UTF-8 payload bytes,
  terminator `0000` (truncated if it does not fit), pad to a byte boundary, then alternate pad bytes `0xEC, 0x11`.
- Reed-Solomon over GF(256) with primitive polynomial `0x11D`; interleave data blocks, then EC blocks; append the
  remainder bits (0 for v1, 7 for v2-6, 0 for v7-10).
- Format information: 15 bits, ECC-M bits `00`, 3 mask bits, BCH(15,5) generator `0x537`, XOR mask `0x5412`, placed
  twice. Version information (v7+): 18-bit BCH(18,6), generator `0x1F25`.
- Mask penalty rules N1=3, N2=3, N3=40, N4=10; pick the lowest total.

If, after doing this, the code does not scan on a real phone, do not ship it: set `features.qr: false`, keep the
endpoint returning 404, and report the failure rather than shipping a broken QR.

### B3. SVG output

One `<rect>` per dark module (or a single path) inside a `viewBox` sized `(size + 8) * scale` for a 4-module quiet
zone, `shape-rendering="crispEdges"`, white background, dark modules `#111`, `role="img"`, and a `<title>` element
reading `QR code for this share link`. No scripts, no external references, no `foreignObject`.

### B4. Share modal UI

In `public/index.html`, inside `#share-modal` (`index.html:190-204`), add a row below `#share-row`:

```html
<div class="share-qr hidden" id="share-qr-row">
  <img id="share-qr" alt="QR code for this share link" width="160" height="160">
  <span class="share-qr-hint">Scan to open on a phone</span>
</div>
```

In `public/app.js`:

- `renderShareModal(note)` (`app.js:2258-2267`): when `note.share` exists, set
  `ui.shareQr.src = '/share/' + note.share.token + '/qr.svg'` and unhide `#share-qr-row`; otherwise clear `src` and
  hide it. Set `img.onerror` to hide the row (graceful degradation if the encoder is disabled).
- The displayed link should use the canonical origin when known:
  `(state.publicBaseUrl || location.origin) + '/share/' + token`. Read `publicBaseUrl` from the `GET /api/session`
  payload wherever session state is stored and keep it in `state`.
- Add the new elements to the `ui` map (`app.js:457-490`) and a small `.share-qr` block in `public/style.css`.

## Tests

Extend `test/helpers.js` so `startServer` accepts an `env` object merged into the spawned child's environment
(today it only accepts `dataDir`, `test/helpers.js:12-18`) - that is how you will test `PUBLIC_BASE_URL`.

Add `test/share-head.test.js`:

1. Create a note, `POST /api/notes/:id/share`, then `GET /share/<token>`: status 200,
   `content-type: text/html`, exactly one `<title>` containing the note title, `og:title`, `og:description`,
   absolute `og:url`, `<link rel="canonical">`, `robots` `noindex`, and `X-Robots-Tag` header.
2. Note content with an uploaded PNG (`uploadPng` helper) -> `og:image` is absolute, ends with `?s=<token>`, and the
   path matches `/uploads/<32hex>.png`.
3. Note without an image -> no `og:image` tag.
4. Title `</title><script>alert(1)</script>` -> response contains no literal `<script>alert(1)</script>` and does
   contain the escaped form.
5. Description is at most ~163 characters and contains no `#`, `**`, `[`, `]` or backticks.
6. Unknown token, revoked token, trashed note (`DELETE /api/notes/:id` first), and `/share/not-a-token` -> all 404,
   all with `noindex`.
7. Server started with `PUBLIC_BASE_URL=https://example.test` -> `og:url` and `og:image` start with that origin.
8. `GET /api/session` includes a `publicBaseUrl` key and `features.qr`.

Add `test/qr.test.js`:

1. `lib/qr.js` encodes `https://example.test/share/<32hex>` and the result has size `17 + 4*version` with
   `size >= 21`.
2. Structural assertions: three finder patterns present at the three corners, timing patterns alternating on row/col
   6, dark module set at `(8, size-8)`, quiet zone absent from the matrix (rendered only in the SVG).
3. Round-trip: read the data codewords back out of the matrix (invert the chosen mask, read the zigzag, de-interleave,
   drop the EC blocks) and assert the decoded payload equals the input. This is the test that catches placement and
   masking bugs - do not skip it.
4. `toSvg()` returns a string starting with `<svg`, containing `viewBox` and `<title>`, and no `<script`.
5. `GET /share/<token>/qr.svg` -> 200, `image/svg+xml`, body starts with `<svg`; unknown token -> 404.

Run `node --test` - all the existing suites (`compat`, `conflicts`, `history`, `retention`, `trash`) must still pass.

## Docs and deploy

- `README.md`: add the two features to the Features list; add `PUBLIC_BASE_URL` to the configuration table; add a
  short "Link previews" note explaining that the origin must be set for correct absolute URLs behind a proxy, and
  that share pages are deliberately `noindex`.
- `deploy/notes.service`: add a commented `#Environment=PUBLIC_BASE_URL=https://notes.example.com` next to the
  existing `Environment=` lines.
- `deploy/DEPLOY-ALIYUN.md`: one line in the Caddy/proxy section tying `PUBLIC_BASE_URL` to the chosen domain.

## Definition of done

- `node --test` passes, including the existing suites.
- Opening a real share link in a chat client (Telegram, WeChat, Slack, iMessage - whichever you have) produces a
  titled card with a description and, when the note has an image, a thumbnail.
- `view-source` of a share page shows the OG tags; the page still renders and the app still works normally.
- The share modal shows a QR that a phone camera opens successfully (scan it for real, do not assume).
- No `dependencies` added; no inline script; no change to `GET /api/share/:token`; nothing new in `notes.json`.

## Do not

- Do not make share pages indexable, cacheable by search engines, or discoverable by omitting the robots tags.
- Do not server-render the markdown body or duplicate the renderer in Node.
- Do not put the raw `Host` header or any user string into HTML without `escapeHtml`.
- Do not build a default OG image generator; omit `og:image` when there is none.
- Do not let Phase B block Phase A - if QR does not scan, disable it via `features.qr: false` and ship the head.
- Do not refactor unrelated code or reformat untouched functions. Keep the diff scoped to these two features.

====