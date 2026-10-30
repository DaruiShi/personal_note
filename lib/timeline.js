'use strict';
/* Timeline notes — server-side pure logic. Stdlib only, covered by node:test.
 *
 * A timeline note is a note with kind === 'timeline' whose items live in
 * note.timeline.items; note.content is a derived markdown mirror, never a
 * source of truth. All validation happens here so the write handlers in
 * server.js stay thin. Failures come back as { ok: false, code, message }
 * result objects; server.js converts them to HTTP responses.
 */

const crypto = require('crypto');

const TIMELINE_KIND = 'timeline';
const MAX_ITEMS = 5000;
const MAX_ITEM_TEXT = 4000;
const MAX_MIRROR_BYTES = 1024 * 1024;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 'YYYY-MM-DD' that is also a real calendar date (2026-02-30 fails). */
function isDateKey(s) {
  if (typeof s !== 'string' || !DATE_KEY_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function fail(code, message, index) {
  const out = { ok: false, code, message };
  if (index != null) out.index = index;
  return out;
}

/**
 * Validate and normalise a client-supplied timeline. `raw` may be
 * { items: [...] } or a bare array. Returns { ok: true, items } with:
 *   - items sorted by date, then createdAt, then arrival order (stable);
 *   - ids kept when UUID-shaped and unique, regenerated otherwise;
 *   - text trimmed, non-empty, truncated to MAX_ITEM_TEXT;
 *   - createdAt/updatedAt defaulting to now when absent or non-numeric.
 * Or { ok: false, code, message, index? } for the caller to convert.
 */
function normalizeTimeline(raw) {
  const items = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.items) ? raw.items : null);
  if (!items) return fail('invalid_timeline', 'timeline must be { items: [...] }');
  if (items.length > MAX_ITEMS) {
    return fail('too_many_items', `A timeline holds at most ${MAX_ITEMS} items`);
  }
  const now = Date.now();
  const seenIds = new Set();
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') return fail('invalid_item', 'Timeline items must be objects', i);
    if (!isDateKey(it.date)) {
      return fail('invalid_item_date', `Item ${i}: date must be a real YYYY-MM-DD date`, i);
    }
    if (typeof it.text !== 'string') {
      return fail('invalid_item_text', `Item ${i}: text must be a string`, i);
    }
    const text = it.text.trim().slice(0, MAX_ITEM_TEXT);
    if (!text) return fail('invalid_item_text', `Item ${i}: text must not be empty`, i);
    let id = (typeof it.id === 'string' && UUID_RE.test(it.id) && !seenIds.has(it.id)) ? it.id : crypto.randomUUID();
    seenIds.add(id);
    const createdAt = (typeof it.createdAt === 'number' && Number.isFinite(it.createdAt)) ? it.createdAt : now;
    const updatedAt = (typeof it.updatedAt === 'number' && Number.isFinite(it.updatedAt)) ? it.updatedAt : now;
    out.push({ id, date: it.date, text, createdAt, updatedAt });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt));
  const md = timelineToMarkdown(out);
  if (Buffer.byteLength(md, 'utf8') > MAX_MIRROR_BYTES) {
    return fail('timeline_too_large', `This timeline's markdown mirror exceeds 1 MiB`);
  }
  return { ok: true, items: out, markdown: md };
}

/**
 * The derived markdown mirror — the exact contract the clients read.
 * Dates ascending as `## YYYY-MM-DD`, one `- text` bullet per item ordered
 * by createdAt, a blank line between dates. Newlines inside an item's text
 * collapse to spaces so the mirror stays valid markdown.
 */
function timelineToMarkdown(items) {
  const byDate = new Map();
  for (const it of items || []) {
    if (!byDate.has(it.date)) byDate.set(it.date, []);
    byDate.get(it.date).push(it);
  }
  const dates = [...byDate.keys()].sort();
  const parts = [];
  for (const d of dates) {
    const rows = byDate.get(d)
      .slice()
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((it) => `- ${String(it.text).replace(/\s*\n\s*/g, ' ')}`);
    parts.push(`## ${d}\n${rows.join('\n')}`);
  }
  return parts.join('\n\n');
}

/** Number of items (after validation this is just the array length). */
function itemCount(items) {
  return Array.isArray(items) ? items.length : 0;
}

/** Sorted unique date keys of the items. */
function datesOf(items) {
  if (!Array.isArray(items)) return [];
  return [...new Set(items.map((it) => it.date))].sort();
}

module.exports = {
  TIMELINE_KIND, MAX_ITEMS, MAX_ITEM_TEXT, MAX_MIRROR_BYTES,
  isDateKey, normalizeTimeline, timelineToMarkdown, itemCount, datesOf,
};
