'use strict';
/* Citation aliases — server-side pure helpers. An alias is a title a note
 * was previously called; citations written before a rename keep resolving
 * through it. Aliases are recorded only by the server on rename and can
 * never be written by a client. Stdlib only, covered by node:test.
 */

const MAX_ALIASES = 50;

// Same normalisation public/links.js uses for title matching.
function titleKey(title) {
  return String(title == null ? '' : title).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Record `oldTitle` as an alias of a note now called `newTitle`.
 * Pure — returns a NEW array, never mutates. Rules:
 *   - no-op when the old and new titles match case/whitespace-insensitively
 *     or the old title is empty;
 *   - drops any alias equal to the new title (it is the live title now);
 *   - dedupes case-insensitively keeping the most recent spelling;
 *   - keeps at most the last MAX_ALIASES entries.
 */
function addAlias(aliases, oldTitle, newTitle) {
  const old = String(oldTitle == null ? '' : oldTitle).trim();
  const newKey = titleKey(newTitle);
  if (!old || titleKey(old) === newKey) return normalizeAliases(aliases);
  const out = [];
  for (const a of normalizeAliases(aliases)) {
    if (titleKey(a) === newKey || titleKey(a) === titleKey(old)) continue;
    out.push(a);
  }
  out.push(old);
  return out.slice(-MAX_ALIASES);
}

/**
 * Normalise a raw aliases value (hand-edited notes.json, history payloads):
 * keep trimmed non-empty strings, dedupe case-insensitively keeping the
 * most recent spelling, cap at the last MAX_ALIASES. Always returns an
 * array (possibly empty).
 */
function normalizeAliases(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const a of raw) {
    if (typeof a !== 'string') continue;
    const t = a.trim();
    if (!t) continue;
    const key = titleKey(t);
    if (seen.has(key)) {
      // keep the most recent spelling: drop the old entry first
      const at = out.findIndex((v) => titleKey(v) === key);
      if (at >= 0) out.splice(at, 1);
    }
    seen.add(key);
    out.push(t);
    if (out.length > MAX_ALIASES) out.shift();
  }
  return out;
}

module.exports = { MAX_ALIASES, addAlias, normalizeAliases, titleKey };
