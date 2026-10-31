/* NotesGallery — pure browser logic for gallery notes: the colour palette,
 * card CRUD and reordering (immutable), tag normalisation, text previews,
 * and the deterministic fallback title. UMD like public/links.js: sets
 * window.NotesGallery and, when module exists, module.exports for
 * node:test. No DOM access, no imports; PALETTE and fallbackTitle must
 * stay byte-compatible with lib/gallery.js (there is a parity test).
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotesGallery = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const PALETTE = [
    'amber', 'rose', 'violet', 'indigo', 'sky', 'teal',
    'emerald', 'lime', 'orange', 'fuchsia', 'slate', 'sand',
  ];
  const PALETTE_SET = new Set(PALETTE);

  const isPaletteKey = (k) => PALETTE_SET.has(k);

  /**
   * Deterministic title from content — byte-for-byte the same behaviour as
   * lib/gallery.js (parity-tested): first sentence, first maxWords words
   * (first 24 characters when the sentence has no spaces), an ellipsis only
   * when something was cut, never empty.
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
   * One-line preview: whitespace collapsed, cut on a word boundary when one
   * sits in the last ~40% of the budget, ellipsis only when truncated, and
   * never inside a surrogate pair (characters are counted, not UTF-16
   * units).
   */
  function previewText(content, maxChars = 180) {
    const s = String(content == null ? '' : content).replace(/\s+/g, ' ').trim();
    if (!s) return '';
    const chars = Array.from(s);
    if (chars.length <= maxChars) return s;
    let cut = chars.slice(0, maxChars).join('');
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.6) cut = cut.slice(0, lastSpace);
    return cut.replace(/[\s…]+$/, '') + '…';
  }

  const MAX_TAGS = 10;
  const MAX_TAG_LEN = 32;

  /** Array or comma/space/#-separated string -> clean tag array. */
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

  let tmpSeq = 0;

  /** New card with a temporary id (the server assigns a UUID on save). */
  function newCard({ title = '', content = '', tags = [], color, now = Date.now(), id } = {}) {
    return {
      id: id || 'g:' + (++tmpSeq).toString(36) + Math.random().toString(36).slice(2, 8),
      title: String(title || '').trim(),
      content: String(content || '').trim(),
      tags: normalizeTags(tags),
      color: isPaletteKey(color) ? color : PALETTE[Math.floor(Math.random() * PALETTE.length)],
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Patch one card (bumping updatedAt); returns a new array. */
  function updateCard(items, id, patch) {
    return (items || []).map((c) =>
      c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c);
  }

  function removeCard(items, id) {
    return (items || []).filter((c) => c.id !== id);
  }

  /** Move one card to an index (clamped); returns a new array. */
  function reorder(items, fromId, toIndex) {
    const list = [...(items || [])];
    const from = list.findIndex((c) => c.id === fromId);
    if (from < 0) return list;
    list.splice(from, 1);
    const to = Math.max(0, Math.min(Math.trunc(toIndex) || 0, list.length));
    list.splice(to, 0, items[from]);
    return list;
  }

  /** Keyboard/button path: move a card delta positions (clamped). */
  function moveBy(items, id, delta) {
    const list = items || [];
    const from = list.findIndex((c) => c.id === id);
    if (from < 0 || !delta) return list;
    return reorder(list, id, from + delta);
  }

  /**
   * Merge an AI suggestion into a card: only fields that were requested and
   * are still empty are filled — a title the user typed is never
   * overwritten.
   */
  function applySuggestion(items, id, { title, tags } = {}) {
    return (items || []).map((c) => {
      if (c.id !== id) return c;
      const patch = {};
      if (title && !c.title.trim()) patch.title = title;
      if (Array.isArray(tags) && tags.length && c.tags.length === 0) patch.tags = tags;
      if (!Object.keys(patch).length) return c;
      return { ...c, ...patch, updatedAt: Date.now() };
    });
  }

  /** { total, tagCount, colors } for the gallery toolbar. */
  function summary(items) {
    const list = items || [];
    const tags = new Set();
    const colors = new Set();
    for (const c of list) {
      colors.add(c.color);
      for (const t of c.tags || []) tags.add(t.toLowerCase());
    }
    return { total: list.length, tagCount: tags.size, colors: colors.size };
  }

  return {
    PALETTE, isPaletteKey, fallbackTitle, previewText, normalizeTags,
    newCard, updateCard, removeCard, reorder, moveBy, applySuggestion, summary,
  };
});
