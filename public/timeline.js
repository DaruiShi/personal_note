/* NotesTimeline — pure browser logic for timeline notes: sorting, grouping,
 * page math for the horizontal date scroller, immutable item edits, merging
 * parsed pastes, and the local fallback date parser.
 *
 * UMD like public/links.js: sets window.NotesTimeline and, when module
 * exists, module.exports so node:test can require it directly. Date helpers
 * (localDateKey / parseDateKey / addDays from NotesLinks) are never imported
 * — functions that need them take them as arguments, so this module can be
 * loaded and tested alone.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NotesTimeline = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* ------------------------------------------------------------ ordering */

  /** By date ascending, then createdAt (stable for same-ms siblings). */
  function sortItems(items) {
    return [...(items || [])].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0));
  }

  /** [{ date, items }] with dates ascending; items sorted within each group. */
  function groupByDate(items) {
    const map = new Map();
    for (const it of sortItems(items)) {
      if (!map.has(it.date)) map.set(it.date, []);
      map.get(it.date).push(it);
    }
    return [...map.entries()].map(([date, list]) => ({ date, items: list }));
  }

  /** Sorted unique union of item dates, today, and every visited date. */
  function pageDates(items, today, visited) {
    const key = /^\d{4}-\d{2}-\d{2}$/;
    const set = new Set((items || []).map((i) => i.date));
    if (today) set.add(today);
    for (const v of visited || []) if (typeof v === 'string' && key.test(v)) set.add(v);
    return [...set].sort();
  }

  /**
   * [{ date, placeholder }] over the whole dates array: pages within
   * index ± radius render, everything else is a spacer so the scroller
   * keeps its geometry while only a window is materialised.
   */
  function visiblePages(dates, index, radius = 2) {
    return (dates || []).map((date, i) => ({
      date,
      placeholder: !(i >= index - radius && i <= index + radius),
    }));
  }

  /* -------------------------------------------------------- item editing */

  let tmpSeq = 0;
  /** New item with a temporary id; the server assigns a UUID on save. */
  function makeItem(date, text, now = Date.now()) {
    return {
      id: 'tmp:' + (++tmpSeq).toString(36) + Math.random().toString(36).slice(2, 8),
      date,
      text: String(text || '').trim(),
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Replace one item's text (bumping updatedAt); returns a new array. */
  function updateItemText(items, id, text) {
    return (items || []).map((it) =>
      it.id === id ? { ...it, text: String(text || '').trim(), updatedAt: Date.now() } : it);
  }

  /** Move one item to another date; returns a new array. */
  function moveItem(items, id, date) {
    return (items || []).map((it) =>
      it.id === id ? { ...it, date, updatedAt: Date.now() } : it);
  }

  /** Drop one item; returns a new array. */
  function removeItem(items, id) {
    return (items || []).filter((it) => it.id !== id);
  }

  /**
   * Append parsed items, skipping an incoming item when an existing one has
   * the same date and the same whitespace-normalised text — a double confirm
   * or a retry must not duplicate rows. Incoming items get fresh temp ids.
   */
  function mergeParsed(existing, incoming) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const have = new Set((existing || []).map((i) => `${i.date}\u0000${norm(i.text)}`));
    const out = [...(existing || [])];
    const now = Date.now();
    for (const it of incoming || []) {
      const key = `${it.date}\u0000${norm(it.text)}`;
      if (have.has(key)) continue;
      have.add(key);
      out.push(makeItem(it.date, it.text, now));
    }
    return out;
  }

  /* ---------------------------------------------------- fallback parser */

  const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})(?=[\s:：,，\-—]|$)/;
  const MD_RE = /^(\d{1,2})\/(\d{1,2})(?=[\s:：,，\-—]|$)/;
  const CN_MD_RE = /^(\d{1,2})月(\d{1,2})[日号](?=[\s:：,，\-—]|$)/;
  const REL_RE = /^(今天|昨天|前天)(?=[\s:：,，\-—]|$)/;
  const WEEK_RE = /^(?:星期|周)([一二三四五六日天])(?=[\s:：,，\-—]|$)/;
  const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

  function isRealDate(y, m, d) {
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  const pad2 = (n) => String(n).padStart(2, '0');

  /**
   * Deterministic local parser for when the LLM is unavailable: one item per
   * non-empty line; a leading date token selects the date, otherwise today.
   * `today` is a YYYY-MM-DD key; `addDays` is NotesLinks.addDays. The
   * matched token (and one separator) is stripped from the text.
   */
  function parseFallback(text, today, addDays) {
    const src = String(text || '');
    if (!src.trim()) return [];
    const [ty, tm, td] = today.split('-').map(Number);
    const todayDow = new Date(ty, tm - 1, td).getDay();
    const out = [];
    for (const raw of src.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      let date = today;
      let rest = line;
      let matched = false;
      let m;
      if ((m = line.match(ISO_RE)) && isRealDate(+m[1], +m[2], +m[3])) {
        date = m[0]; rest = line.slice(m[0].length); matched = true;
      } else if ((m = line.match(CN_MD_RE)) && +m[1] >= 1 && +m[1] <= 12 && isRealDate(ty, +m[1], +m[2])) {
        date = `${ty}-${pad2(+m[1])}-${pad2(+m[2])}`; rest = line.slice(m[0].length); matched = true;
      } else if ((m = line.match(MD_RE)) && +m[1] >= 1 && +m[1] <= 12 && isRealDate(ty, +m[1], +m[2])) {
        date = `${ty}-${pad2(+m[1])}-${pad2(+m[2])}`; rest = line.slice(m[0].length); matched = true;
      } else if ((m = line.match(REL_RE))) {
        date = m[1] === '今天' ? today : m[1] === '昨天' ? addDays(today, -1) : addDays(today, -2);
        rest = line.slice(m[0].length); matched = true;
      } else if ((m = line.match(WEEK_RE))) {
        // the most recent past occurrence of that weekday (today counts)
        const target = WEEKDAYS[m[1]];
        const back = (todayDow - target + 7) % 7;
        date = back === 0 ? today : addDays(today, -back);
        rest = line.slice(m[0].length); matched = true;
      }
      const cleaned = rest.replace(/^[\s:：,，\-—]+/, '').trim();
      out.push({ date, text: (cleaned || line).trim(), guessed: !matched });
    }
    return out;
  }

  /* ------------------------------------------------------------ summary */

  /** { total, dates, first, last } for the timeline header. */
  function summarize(items) {
    const list = items || [];
    const dates = [...new Set(list.map((i) => i.date))].sort();
    return {
      total: list.length,
      dates: dates.length,
      first: dates[0] || null,
      last: dates[dates.length - 1] || null,
    };
  }

  return {
    sortItems, groupByDate, pageDates, visiblePages,
    makeItem, updateItemText, moveItem, removeItem, mergeParsed,
    parseFallback, summarize,
  };
});
