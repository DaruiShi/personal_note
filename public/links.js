/* NotesLinks — wikilink parsing, the note-to-note link index, and daily-note
 * date helpers. Pure functions only: no DOM, no app state, no network, so
 * node --test can require this file directly (app.js consumes the global).
 *
 * Wikilink syntax: [[Note title]] and [[Note title|label]]. Links inside
 * fenced code blocks (```) or inline code spans (`...`) are not links.
 * Daily notes are plain notes whose title is exactly YYYY-MM-DD.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotesLinks = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const WIKILINK_RE = /\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g;
  // Mirrors the renderer's fence tokens (app.js): ```lang opens, ``` closes.
  const FENCE_RE = /^```[\w+#-]*\s*$/;

  /* ------------------------------------------------------- title matching */

  // Normalisation used for title matching: trim, lowercase, collapse runs
  // of internal whitespace to single spaces.
  function titleKey(title) {
    return String(title == null ? '' : title).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /* -------------------------------------------------------- wikilink scan */

  // Deduplicated { target, label } list in first-occurrence order; targets
  // that differ only by case/whitespace are the same link. Code regions
  // (fenced blocks, inline spans) are excluded, mirroring the renderer.
  function parseWikilinks(text) {
    const src = String(text == null ? '' : text).replace(/\r\n?/g, '\n');
    const seen = new Set();
    const out = [];
    let inFence = false;
    for (const line of src.split('\n')) {
      if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
      if (inFence) continue;
      // wikilinks inside inline code are literal text: blank the spans
      const noCode = line.replace(/`[^`\n]*`/g, '``');
      WIKILINK_RE.lastIndex = 0;
      let m;
      while ((m = WIKILINK_RE.exec(noCode))) {
        const target = m[1].trim();
        if (!target) continue;
        const key = titleKey(target);
        if (seen.has(key)) continue;
        seen.add(key);
        const explicit = m[2] != null && m[2].trim() !== '';
        const label = (m[2] != null ? m[2].trim() : '') || target;
        out.push({ target, label, explicit });
      }
    }
    return out;
  }

  /* -------------------------------------------------------- link index */

  // { byTitle: Map<titleKey, noteId>, byAlias: Map<titleKey, noteId>,
  //   outbound: Map<noteId, target[]>, inbound: Map<noteId, Set<noteId>> }
  // byTitle resolves duplicate titles to the newest updatedAt; notes with
  // empty titles are excluded from byTitle but still contribute outbound
  // links. Self-links do not create inbound entries.
  //
  // byAlias maps RENAME aliases (server-managed previous titles) the same
  // way — a real title always beats an alias, a note's own current title is
  // never its alias, and alias-vs-alias collisions pick the newest note —
  // so a citation written before a rename keeps resolving and backlinks
  // keep flowing. Lookup order is always byTitle first, then byAlias.
  function buildLinkIndex(notes) {
    const list = Array.isArray(notes) ? notes : [];
    const byTitle = new Map();
    const titled = list.filter((n) => n && titleKey(n.title) !== '');
    titled.sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0)); // newest wins
    for (const n of titled) byTitle.set(titleKey(n.title), n.id);

    const byAlias = new Map();
    const aliased = list
      .filter((n) => n && Array.isArray(n.aliases))
      .sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0)); // newest wins
    for (const n of aliased) {
      for (const a of n.aliases) {
        const key = titleKey(a);
        if (!key || key === titleKey(n.title)) continue;
        if (byTitle.has(key)) continue; // a real title always beats an alias
        byAlias.set(key, n.id);
      }
    }

    const resolveKey = (key) => {
      if (key == null) return null;
      const id = byTitle.get(key);
      return id != null ? id : (byAlias.get(key) != null ? byAlias.get(key) : null);
    };

    const outbound = new Map();
    const inbound = new Map();
    for (const n of list) {
      const targets = parseWikilinks(n && n.content).map((l) => l.target);
      outbound.set(n.id, targets);
      for (const t of targets) {
        const tid = resolveKey(titleKey(t));
        if (tid == null || tid === n.id) continue;
        if (!inbound.has(tid)) inbound.set(tid, new Set());
        inbound.get(tid).add(n.id);
      }
    }
    return { byTitle, byAlias, outbound, inbound };
  }

  function resolveTitle(index, target) {
    if (!index) return null;
    const key = titleKey(target);
    const id = index.byTitle.get(key);
    if (id != null) return id;
    const aid = index.byAlias && index.byAlias.get(key);
    return aid != null ? aid : null;
  }

  // Full citation info — the target note's CURRENT title and kind, so a
  // reader never sees the stale pre-rename name. kind is
  // 'markdown' | 'timeline' | 'gallery'.
  function resolveCitation(index, notes, target) {
    const id = resolveTitle(index, target);
    if (id == null) return null;
    const note = (Array.isArray(notes) ? notes : []).find((x) => x && x.id === id);
    if (!note) return null;
    return { id, title: note.title, kind: note.kind || 'markdown' };
  }

  /**
   * Picker candidates for a query: exact title, title starts-with, title
   * contains, then alias contains; ties broken by updatedAt descending.
   * An empty query returns the most recently updated notes. Each row is
   * { id, title, kind, updatedAt, matchedBy: 'title' | 'alias' }.
   */
  function citeCandidates(index, notes, query, limit = 8) {
    const list = (Array.isArray(notes) ? notes : []).filter((x) => x && titleKey(x.title) !== '');
    const q = titleKey(query);
    const scored = [];
    for (const x of list) {
      const t = titleKey(x.title);
      let score = null;
      let matchedBy = 'title';
      if (!q) score = 4;
      else if (t === q) score = 3;
      else if (t.startsWith(q)) score = 2;
      else if (t.includes(q)) score = 1;
      else if (Array.isArray(x.aliases) && x.aliases.some((a) => titleKey(a).includes(q))) {
        score = 0;
        matchedBy = 'alias';
      }
      if (score != null) scored.push({ x, score, matchedBy });
    }
    scored.sort((a, b) => (b.score - a.score) || ((b.x.updatedAt || 0) - (a.x.updatedAt || 0)));
    return scored.slice(0, limit).map(({ x, matchedBy }) => ({
      id: x.id,
      title: x.title,
      kind: x.kind || 'markdown',
      updatedAt: x.updatedAt || 0,
      matchedBy,
    }));
  }

  /**
   * The citation text for a note — { text: '[[Title]]' } when the title can
   * be cited, or { text: '', blocked: true, reason } when it is empty or
   * contains '[', ']' or '|' (the citation syntax itself), because such a
   * target could never resolve. Never mangles the title.
   */
  function citationFor(note) {
    const title = note && typeof note.title === 'string' ? note.title.trim() : '';
    if (!title || /[\[\]|]/.test(title)) {
      return { text: '', blocked: true, reason: 'Title contains [ ] or |' };
    }
    return { text: '[[' + title + ']]' };
  }

  /**
   * Render plain text (timeline items, gallery cards) with live citations:
   * HTML-escape the WHOLE string first, then replace [[Target]] /
   * [[Target|label]] with the same anchor markup the markdown renderer
   * emits. Everything outside citations stays escaped — this is the only
   * new place that builds link HTML, so it is tested against XSS payloads.
   * An unterminated [[ is left as literal (escaped) text.
   */
  function citeify(text, resolve) {
    const esc = String(text == null ? '' : text)
      .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    // escape AFTER escaping: the brackets themselves are not escaped, so
    // the citation pattern can still be matched on the escaped string
    return esc.replace(/\[\[([^\[\]|\n]+?)(?:\|([^\[\]\n]+?))?\]\]/g, (full, rawTarget, rawLabel) => {
      const target = String(rawTarget).trim();
      if (!target) return full;
      const label = (rawLabel != null ? String(rawLabel).trim() : '') || target;
      const id = typeof resolve === 'function' ? resolve(target) : null;
      if (id) return '<a class="wikilink" href="#" data-wikilink="' + target + '">' + label + '</a>';
      return '<a class="wikilink missing" href="#" data-wikilink="' + target + '" title="Create this note">' + label + '</a>';
    });
  }

  // Notes linking to noteId, newest first, capped at 50. Each row carries a
  // snippet built around the first wikilink that points at noteId.
  function inboundFor(index, noteId, notes) {
    const ids = index && index.inbound.get(noteId);
    if (!ids || ids.size === 0) return [];
    const byId = new Map((Array.isArray(notes) ? notes : []).map((n) => [n.id, n]));
    const rows = [];
    for (const id of ids) {
      if (id === noteId) continue;
      const n = byId.get(id);
      if (!n) continue;
      let target = null;
      for (const t of index.outbound.get(id) || []) {
        const tid = index.byTitle.get(titleKey(t));
        const aid = index.byAlias && index.byAlias.get(titleKey(t));
        if (tid === noteId || aid === noteId) { target = t; break; }
      }
      rows.push({ id, title: n.title, snippet: extractSnippet(n.content, target, 90), at: n.updatedAt || 0 });
    }
    rows.sort((a, b) => b.at - a.at);
    return rows.slice(0, 50).map(({ id, title, snippet }) => ({ id, title, snippet }));
  }

  /* ----------------------------------------------------------- snippets */

  // Markdown → one line of plain text (fences, backticks, images, links,
  // wikilinks, headings, quotes, list markers, emphasis, table pipes).
  function stripMarkdown(s) {
    return String(s == null ? '' : s)
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[\[([^\[\]|]+)(?:\|([^\[\]]+))?\]\]/g, (_, t, l) => (l || t).trim())
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s{0,3}([-*+]|\d+[.)])\s+/gm, '')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)([^*_]+)\1/g, '$2')
      .replace(/~~([^~]+)~~/g, '$1')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // One line of plain text around the first [[...]] whose target matches
  // targetTitle; '...' markers when the window is clipped. Always ≤ maxChars.
  function extractSnippet(content, targetTitle, maxChars = 90) {
    const max = Math.max(20, maxChars | 0);
    const key = titleKey(targetTitle);
    if (key === '') return '';
    const src = String(content == null ? '' : content).replace(/\r\n?/g, '\n');
    let label = null;
    let line = null;
    let inFence = false;
    for (const l of src.split('\n')) {
      if (FENCE_RE.test(l)) { inFence = !inFence; continue; }
      if (inFence) continue;
      const noCode = l.replace(/`[^`\n]*`/g, '``');
      WIKILINK_RE.lastIndex = 0;
      let m;
      while ((m = WIKILINK_RE.exec(noCode))) {
        const t = m[1].trim();
        if (t && titleKey(t) === key) { label = (m[2] != null ? m[2].trim() : '') || t; line = l; break; }
      }
      if (label !== null) break;
    }
    if (label === null) return '';
    const plain = stripMarkdown(line);
    if (!plain) return '';
    if (plain.length <= max) return plain;
    const idx = Math.max(0, plain.indexOf(label));
    let start = Math.max(0, idx - Math.floor(max / 3));
    if (start + max < plain.length) start = Math.max(0, Math.min(start, plain.length - max));
    let win = plain.slice(start, start + max);
    win = (start > 0 ? '...' : '') + win.trim();
    if (start + max < plain.length) win += '...';
    return win.slice(0, max);
  }

  /* ------------------------------------------------------- daily dates */

  // YYYY-MM-DD from LOCAL date components. Never toISOString(): it shifts
  // to UTC and loses the local day in timezones ahead of Greenwich.
  function localDateKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // A Date at local midnight for exactly-YYYY-MM-DD keys that are real
  // calendar dates (2026-02-30 → null; years outside 1970-2999 → null).
  function parseDateKey(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [y, m, d] = key.split('-').map(Number);
    if (y < 1970 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
  }

  // Date#setDate does the calendar math, so month/year/DST boundaries are
  // the platform's problem, never ours. Returns a canonical key or null.
  function addDays(key, delta) {
    const d = parseDateKey(key);
    if (!d || !Number.isFinite(delta)) return null;
    d.setDate(d.getDate() + delta);
    return localDateKey(d);
  }

  function isDateTitle(title) {
    return parseDateKey(String(title == null ? '' : title).trim()) !== null;
  }

  function formatDayLabel(key) {
    const d = parseDateKey(key);
    if (!d) return String(key == null ? '' : key);
    return d.toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  }

  return {
    resolveCitation, citeCandidates, citationFor, citeify,
    parseWikilinks, buildLinkIndex, titleKey, resolveTitle, inboundFor,
    extractSnippet, localDateKey, parseDateKey, addDays, isDateTitle, formatDayLabel,
  };
});
