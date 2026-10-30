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

  const BIG = Number.MAX_SAFE_INTEGER;

  /**
   * Display order within one date: explicit `order` wins (drag-and-drop
   * writes it; absent order sinks), then the start time (untimed last),
   * then createdAt. Mirrors the server's comparator exactly.
   */
  function cmpWithinDate(a, b) {
    return (a.order != null ? a.order : BIG) - (b.order != null ? b.order : BIG) ||
      String(a.start || '99:99').localeCompare(String(b.start || '99:99')) ||
      (a.createdAt || 0) - (b.createdAt || 0);
  }

  /** By date ascending, then the within-date comparator. */
  function sortItems(items) {
    return [...(items || [])].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : cmpWithinDate(a, b));
  }

  /**
   * Renumber the items of one date to order = 0..n-1 in display order and
   * return the new full array (other dates untouched). Callers use this
   * after insertions and drags so the sequence sticks on save.
   */
  function renumberDate(items, date) {
    const ofDate = (items || []).filter((i) => i.date === date).sort(cmpWithinDate);
    const orders = new Map(ofDate.map((it, i) => [it.id, i]));
    return (items || []).map((it) =>
      orders.has(it.id) ? { ...it, order: orders.get(it.id) } : it);
  }

  /**
   * Insert a new item in its date at the policy position — timed items
   * slot among the date's items by start time, untimed items append at
   * the end — then renumber that date so the order persists.
   */
  function insertItem(items, item) {
    const out = [...(items || []), item];
    return renumberByPolicy(out, item);
  }

  // Renumber `item`'s date with the newcomer positioned per policy: after
  // the last TIMED sibling starting at-or-before it; untimed newcomers
  // append at the end. Untimed siblings are never compared by time —
  // their (possibly dragged) order stays put.
  function renumberByPolicy(items, item) {
    const siblings = items.filter((i) => i.date === item.date && i.id !== item.id).sort(cmpWithinDate);
    let idx = siblings.length;
    if (item.start) {
      idx = 0;
      for (let i = 0; i < siblings.length; i++) {
        if (siblings[i].start && siblings[i].start <= item.start) idx = i + 1;
      }
    }
    const ordered = [...siblings.slice(0, idx), item, ...siblings.slice(idx)];
    const orders = new Map(ordered.map((it, i) => [it.id, i]));
    return items.map((it) => (orders.has(it.id) ? { ...it, order: orders.get(it.id) } : it));
  }

  /**
   * Move an item within its date to the position currently held by
   * `beforeId` (or to the end when null), renumbering that date. Moving
   * across dates is moveItem(); this is the drag-and-drop reorder.
   */
  function moveWithinDate(items, id, beforeId) {
    const item = (items || []).find((i) => i.id === id);
    if (!item || id === beforeId) return items || [];
    const siblings = (items || []).filter((i) => i.date === item.date && i.id !== id).sort(cmpWithinDate);
    let idx = siblings.length;
    if (beforeId) {
      const at = siblings.findIndex((i) => i.id === beforeId);
      if (at >= 0) idx = at;
    }
    const ordered = [...siblings.slice(0, idx), item, ...siblings.slice(idx)];
    const orders = new Map(ordered.map((it, i) => [it.id, i]));
    return (items || []).map((it) => (orders.has(it.id) ? { ...it, order: orders.get(it.id), updatedAt: it.id === id ? Date.now() : it.updatedAt } : it));
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

  /**
   * Convenient whole-period ranges for the add/edit time fields. Shared
   * with the Android app (which mirrors this list in NotesTimeline.kt) —
   * keep both in sync.
   */
  const TIME_PRESETS = [
    { label: 'Morning', start: '09:00', end: '12:00' },
    { label: 'Noon', start: '12:00', end: '13:00' },
    { label: 'Afternoon', start: '14:00', end: '18:00' },
    { label: 'Evening', start: '18:00', end: '22:00' },
  ];

  let tmpSeq = 0;
  /** New item with a temporary id; the server assigns a UUID on save. */
  function makeItem(date, text, now = Date.now(), start = null, end = null) {
    return {
      id: 'tmp:' + (++tmpSeq).toString(36) + Math.random().toString(36).slice(2, 8),
      date,
      text: String(text || '').trim(),
      start: start || null,
      end: end || null,
      done: false,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Flip one item's done flag (bumping updatedAt); returns a new array. */
  function toggleDone(items, id) {
    return (items || []).map((it) =>
      it.id === id ? { ...it, done: !it.done, updatedAt: Date.now() } : it);
  }

  /**
   * Set an item's time range and re-slot it in its date by the new start
   * (cleared times send the item to the end, per the untimed-last rule).
   */
  function updateItemTime(items, id, start, end) {
    const item = (items || []).find((i) => i.id === id);
    if (!item) return items || [];
    const changed = { ...item, start: start || null, end: end || null, updatedAt: Date.now() };
    const rest = (items || []).filter((i) => i.id !== id);
    return renumberByPolicy([...rest, changed], changed);
  }

  /** Replace one item's text (bumping updatedAt); returns a new array. */
  function updateItemText(items, id, text) {
    return (items || []).map((it) =>
      it.id === id ? { ...it, text: String(text || '').trim(), updatedAt: Date.now() } : it);
  }

  /** Move one item to another date (policy position there); new array. */
  function moveItem(items, id, date) {
    const item = (items || []).find((i) => i.id === id);
    if (!item) return items || [];
    const changed = { ...item, date, updatedAt: Date.now() };
    const rest = (items || []).filter((i) => i.id !== id);
    return renumberByPolicy([...rest, changed], changed);
  }

  /** Drop one item; returns a new array. */
  function removeItem(items, id) {
    return (items || []).filter((it) => it.id !== id);
  }

  /**
   * Append parsed items, skipping an incoming item when an existing one has
   * the same date and the same whitespace-normalised text — a double confirm
   * or a retry must not duplicate rows. Incoming times ride along; each
   * newcomer slots into its date by start time (untimed last) via insertion.
   */
  function mergeParsed(existing, incoming) {
    const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const have = new Set((existing || []).map((i) => `${i.date}\u0000${norm(i.text)}`));
    let out = [...(existing || [])];
    const now = Date.now();
    for (const it of incoming || []) {
      const key = `${it.date}\u0000${norm(it.text)}`;
      if (have.has(key)) continue;
      have.add(key);
      out = insertItem(out, makeItem(it.date, it.text, now, it.start, it.end));
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
  // leading clock (after the date token): 14:00, 9:30am, 3pm, 2:00-4:30pm,
  // 14:00–16:00, 9am~11am. A bare hour is NOT a clock — to24 rejects it,
  // so "2 people" stays text.
  const CLOCK = '([01]?\\d|2[0-3])(?::([0-5]\\d))?(?:\\s?([ap]))?m?';
  const TIME_RANGE_RE = new RegExp(
    '^' + CLOCK + '(?:\\s*(?:[-–~]|到|至)\\s*' + CLOCK + ')?(?=[\\s:：,，;；.。]|$)',
    'i',
  );

  /** '14' + 'pm' -> 24h 'HH:MM'; null when minutes and marker are both
   *  absent (bare hour) or the pairing is nonsense ("14am"). */
  function to24(hRaw, mRaw, apRaw) {
    if (!mRaw && !apRaw) return null; // a bare number is not a clock
    let h = Number(hRaw);
    const m = mRaw || '00';
    if (apRaw) {
      if (h > 12) return null; // "14am" is not a clock
      const pm = apRaw.toLowerCase() === 'p';
      if (pm && h < 12) h += 12;
      if (!pm && h === 12) h = 0; // 12am == 00:00
    }
    if (h > 23) return null;
    return `${pad2(h)}:${m}`;
  }

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
      // optional leading time range after the date token
      let start = null;
      let end = null;
      const stripped = rest.replace(/^[\s:：,，\-—]+/, '');
      const tm = stripped.match(TIME_RANGE_RE);
      if (tm) {
        const c1 = to24(tm[1], tm[2], tm[3]);
        const c2 = tm[4] != null ? to24(tm[4], tm[5], tm[6]) : null;
        if (c1 && (tm[4] == null || c2) && (!c2 || c2 >= c1)) {
          start = c1;
          end = c2;
          rest = stripped.slice(tm[0].length);
        }
      }
      const cleaned = rest.replace(/^[\s:：,，\-—]+/, '').trim();
      out.push({ date, start, end, text: (cleaned || line).trim(), guessed: !matched });
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
    sortItems, groupByDate, pageDates, visiblePages, TIME_PRESETS,
    makeItem, insertItem, updateItemText, updateItemTime, moveItem, moveWithinDate,
    removeItem, toggleDone, mergeParsed,
    parseFallback, summarize,
  };
});
