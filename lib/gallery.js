'use strict';
/* Gallery notes — server-side pure logic, modelled on lib/timeline.js.
 * Stdlib only, covered by node:test. A gallery note's cards live in
 * note.gallery.items; note.content is a derived markdown mirror, never a
 * source of truth. Failures come back as { ok:false, code, message, index? }
 * result objects that server.js converts to HTTP responses.
 */

const crypto = require('crypto');

const GALLERY_KIND = 'gallery';
const MAX_ITEMS = 500;
const MAX_TITLE = 200;
const MAX_CONTENT = 4000;
const MAX_TAGS = 10;
const MAX_TAG_LEN = 32;
const MAX_MIRROR_BYTES = 1024 * 1024;
const PALETTE = [
  'amber', 'rose', 'violet', 'indigo', 'sky', 'teal',
  'emerald', 'lime', 'orange', 'fuchsia', 'slate', 'sand',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PALETTE_SET = new Set(PALETTE);

function fail(code, message, index) {
  const out = { ok: false, code, message };
  if (index != null) out.index = index;
  return out;
}

/**
 * Deterministic title from content: first sentence, first maxWords words
 * (first 24 characters when the sentence has no spaces, e.g. CJK), a
 * trailing ellipsis only when something was cut. Never empty. The browser
 * copy in public/gallery.js must behave identically — there is a parity
 * test.
 */
function fallbackTitle(content, maxWords = 9) {
  const s = String(content == null ? '' : content).replace(/\s+/g, ' ').trim();
  if (!s) return 'Untitled card';
  const sm = s.match(/^[^.。!?！？]*[.。!?！？]?/);
  const sentence = (sm && sm[0]) || s;
  const cutSentence = sentence.length < s.length;
  const stripTail = (t) => t.replace(/[.。!?！？…、,，;；:\s]+$/, '').trim();
  if (!sentence.includes(' ')) {
    // no whitespace: CJK-style, count characters (surrogate-safe)
    const chars = Array.from(sentence);
    const cut = cutSentence || chars.length > 24;
    const t = stripTail(chars.slice(0, 24).join(''));
    if (!t) return 'Untitled card';
    return cut ? t + '…' : t;
  }
  const words = sentence.split(' ');
  const cut = cutSentence || words.length > maxWords;
  const t = stripTail(words.slice(0, maxWords).join(' '));
  if (!t) return 'Untitled card';
  return cut ? t + '…' : t;
}

/**
 * The palette key used least among the note's current cards, with `rand`
 * breaking ties — new cards look randomly coloured but never pile onto one
 * hue. Falls back to a random palette key when there are no cards yet.
 * `rand(n)` returns 0..n-1; default crypto.randomInt.
 */
function nextColor(items, rand = (n) => crypto.randomInt(n)) {
  const counts = new Map(PALETTE.map((k) => [k, 0]));
  for (const it of items || []) {
    if (counts.has(it.color)) counts.set(it.color, counts.get(it.color) + 1);
  }
  let min = Infinity;
  for (const n of counts.values()) if (n < min) min = n;
  const least = PALETTE.filter((k) => counts.get(k) === min);
  return least[rand(least.length)];
}

/** Tag pipeline shared by normalisation: strip '#', trim, drop empties,
 *  dedupe case-insensitively (first spelling wins), truncate, cap. */
function normalizeTags(input) {
  const raw = Array.isArray(input)
    ? input.map((t) => t)
    : String(input == null ? '' : input).split(/[,，#\s]+/);
  const seen = new Set();
  const out = [];
  for (let t of raw) {
    if (typeof t !== 'string') continue;
    t = t.replace(/^#+/, '').trim().slice(0, MAX_TAG_LEN);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/**
 * Validate and normalise a client-supplied gallery. `raw` may be
 * { items: [...] } or a bare array. The incoming array order is preserved
 * exactly — it IS the display order. Non-object entries are skipped
 * silently. Returns { ok: true, items, markdown } or
 * { ok: false, code, message, index? }.
 */
function normalizeGallery(raw, opts = {}) {
  const rand = opts.rand || ((n) => crypto.randomInt(n));
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : null);
  if (!items) return fail('invalid_gallery', 'gallery must be { items: [...] }');
  if (items.length > MAX_ITEMS) {
    return fail('too_many_items', `A gallery holds at most ${MAX_ITEMS} cards`);
  }
  const now = Date.now();
  const seenIds = new Set();
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue; // skipped silently
    if (typeof it.content !== 'string' || !it.content.trim()) {
      return fail('invalid_item_content', `Card ${i}: content must be a non-empty string`, i);
    }
    const content = it.content.trim().slice(0, MAX_CONTENT);
    let title = typeof it.title === 'string' ? it.title.trim().slice(0, MAX_TITLE) : '';
    if (!title) title = fallbackTitle(content);
    const tags = normalizeTags(it.tags);
    const color = PALETTE_SET.has(it.color) ? it.color : nextColor(out, rand);
    let id = (typeof it.id === 'string' && UUID_RE.test(it.id) && !seenIds.has(it.id)) ? it.id : crypto.randomUUID();
    seenIds.add(id);
    const createdAt = (typeof it.createdAt === 'number' && Number.isFinite(it.createdAt) && it.createdAt > 0) ? it.createdAt : now;
    const updatedAt = (typeof it.updatedAt === 'number' && Number.isFinite(it.updatedAt) && it.updatedAt > 0) ? it.updatedAt : now;
    out.push({ id, title, content, tags, color, createdAt, updatedAt });
  }
  const md = galleryToMarkdown(out);
  if (Buffer.byteLength(md, 'utf8') > MAX_MIRROR_BYTES) {
    return fail('gallery_too_large', `This gallery's markdown mirror exceeds 1 MiB`);
  }
  return { ok: true, items: out, markdown: md };
}

/**
 * The derived markdown mirror — the exact contract the clients read.
 * One '## title' section per card in array order, the author's paragraphs
 * kept verbatim (only outer whitespace trimmed), an optional 'Tags:' line,
 * cards separated by blank-line/---/blank-line and nothing after the last.
 */
function galleryToMarkdown(items) {
  const parts = (items || []).map((c) => {
    let s = `## ${c.title}\n\n${String(c.content).trim()}`;
    if (c.tags && c.tags.length) s += `\n\nTags: ${c.tags.join(', ')}`;
    return s;
  });
  return parts.join('\n\n---\n\n');
}

module.exports = {
  GALLERY_KIND, MAX_ITEMS, MAX_TITLE, MAX_CONTENT, MAX_TAGS, MAX_TAG_LEN,
  MAX_MIRROR_BYTES, PALETTE,
  fallbackTitle, nextColor, normalizeTags, normalizeGallery, galleryToMarkdown,
};
