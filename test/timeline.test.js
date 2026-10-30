'use strict';
/* NotesTimeline — the browser pure module from public/timeline.js, required
 * directly. Date helpers from public/links.js are passed in as arguments
 * where needed (the module never imports them). */

const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../public/timeline');
const L = require('../public/links');

const it = (date, text, createdAt) => ({ id: 'x' + Math.random().toString(36).slice(2), date, text, createdAt, updatedAt: createdAt });
const addDays = L.addDays;

test('TIME_PRESETS: four valid, non-overlapping, ordered ranges', () => {
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  assert.equal(T.TIME_PRESETS.length, 4);
  for (const p of T.TIME_PRESETS) {
    assert.match(p.start, hhmm);
    assert.match(p.end, hhmm);
    assert.ok(p.end > p.start, `${p.label}: end after start`);
    assert.ok(p.label.length > 0);
  }
  // ordered by start, no overlaps
  const starts = T.TIME_PRESETS.map((p) => p.start);
  assert.deepEqual(starts, [...starts].sort());
  for (let i = 1; i < T.TIME_PRESETS.length; i++) {
    assert.ok(T.TIME_PRESETS[i].start >= T.TIME_PRESETS[i - 1].end, 'adjacent presets do not overlap');
  }
});

test('sortItems: date ascending, then createdAt', () => {
  const sorted = T.sortItems([
    it('2026-10-30', 'late day', 9),
    it('2026-10-29', 'second created', 5),
    it('2026-10-29', 'first created', 2),
  ]);
  assert.deepEqual(sorted.map((s) => s.text), ['first created', 'second created', 'late day']);
});

test('sortItems: within a date, order wins, then start time, untimed last', () => {
  const at = (date, text, start, createdAt, order) =>
    ({ ...it(date, text, createdAt), ...(start ? { start } : {}), ...(order != null ? { order } : {}) });
  const sorted = T.sortItems([
    at('2026-10-30', 'untimed', null, 1),
    at('2026-10-30', 'afternoon', '14:00', 2),
    at('2026-10-30', 'morning', '07:30', 3),
    at('2026-10-30', 'dragged up', '16:00', 4, 0),
  ]);
  assert.deepEqual(sorted.map((s) => s.text), ['dragged up', 'morning', 'afternoon', 'untimed']);
});

test('insertItem slots by time (untimed last) and renumbers the date', () => {
  let items = [
    { ...it('2026-10-30', 'morning', 1), start: '09:00' },
    { ...it('2026-10-30', 'evening', 2), start: '18:00' },
  ];
  items = T.insertItem(items, { ...T.makeItem('2026-10-30', 'noon', 3), start: '12:00' });
  let day = T.sortItems(items.filter((i) => i.date === '2026-10-30'));
  assert.deepEqual(day.map((i) => i.text), ['morning', 'noon', 'evening']);
  assert.deepEqual(day.map((i) => i.order), [0, 1, 2]);
  // untimed newcomer goes to the end of the date
  items = T.insertItem(items, T.makeItem('2026-10-30', 'whenever', 4));
  day = T.sortItems(items.filter((i) => i.date === '2026-10-30'));
  assert.equal(day[day.length - 1].text, 'whenever');
  // a timed newcomer slots among the TIMED siblings only — dragged untimed
  // items keep their positions and are never compared by time
  items = T.moveWithinDate(items, items.find((i) => i.text === 'evening').id,
    items.find((i) => i.text === 'morning').id); // drag evening above morning
  items = T.insertItem(items, { ...T.makeItem('2026-10-30', 'afternoon', 5), start: '13:00' });
  assert.deepEqual(T.sortItems(items).map((i) => i.text),
    ['evening', 'morning', 'noon', 'afternoon', 'whenever']);
  // inserting into another date renumbers only that date
  const oct30 = T.sortItems(items.filter((i) => i.date === '2026-10-30')).map(({ id, order }) => [id, order]);
  items = T.insertItem(items, { ...it('2026-10-29', 'other day', 9), order: 4 });
  assert.deepEqual(
    T.sortItems(items.filter((i) => i.date === '2026-10-29')).map((i) => [i.text, i.order]),
    [['other day', 0]]);
  assert.deepEqual(oct30, T.sortItems(items.filter((i) => i.date === '2026-10-30')).map(({ id, order }) => [id, order]));
});

test('moveWithinDate reorders and renumbers (drag-and-drop)', () => {
  let items = [
    { ...it('2026-10-30', 'a', 1), order: 0 },
    { ...it('2026-10-30', 'b', 2), order: 1 },
    { ...it('2026-10-30', 'c', 3), order: 2 },
  ];
  const idA = items[0].id;
  const idB = items[1].id;
  // drag a before nothing (to the end)
  items = T.moveWithinDate(items, idA, null);
  assert.deepEqual(T.sortItems(items).map((i) => i.text), ['b', 'c', 'a']);
  // drag a back before b
  items = T.moveWithinDate(items, idA, idB);
  assert.deepEqual(T.sortItems(items).map((i) => i.text), ['a', 'b', 'c']);
  assert.deepEqual(T.sortItems(items).map((i) => i.order), [0, 1, 2]);
  // a no-op move changes nothing
  const before = JSON.stringify(T.sortItems(items).map(({ id, order }) => [id, order]));
  const after = JSON.stringify(T.sortItems(T.moveWithinDate(items, idA, idA)).map(({ id, order }) => [id, order]));
  assert.equal(before, after);
});

test('updateItemTime re-slots by the new time and clears send it last', () => {
  let items = [
    { ...it('2026-10-30', 'morning', 1), start: '09:00', order: 0 },
    { ...it('2026-10-30', 'evening', 2), start: '18:00', order: 1 },
  ];
  const morningId = items[0].id;
  // move morning to 20:00 -> after evening
  items = T.updateItemTime(items, morningId, '20:00', null);
  assert.deepEqual(T.sortItems(items).map((i) => i.text), ['evening', 'morning']);
  // clear the time -> untimed last
  items = T.updateItemTime(items, morningId, null, null);
  const day = T.sortItems(items);
  assert.deepEqual(day.map((i) => i.text), ['evening', 'morning']);
  assert.equal(day[1].start, null);
});

test('groupByDate: ascending groups with sorted items', () => {
  const groups = T.groupByDate([
    it('2026-10-30', 'b', 2),
    it('2026-10-29', 'x', 1),
    it('2026-10-30', 'a', 1),
  ]);
  assert.deepEqual(groups.map((g) => g.date), ['2026-10-29', '2026-10-30']);
  assert.deepEqual(groups[1].items.map((i) => i.text), ['a', 'b']);
});

test('pageDates: union of item dates, today and visited, sorted unique', () => {
  const dates = T.pageDates(
    [it('2026-10-20', 'a'), it('2026-10-22', 'b'), it('2026-10-20', 'c')],
    '2026-10-30',
    ['2026-11-01', '2026-10-30', 'not-a-date', ''],
  );
  assert.deepEqual(dates, ['2026-10-20', '2026-10-22', '2026-10-30', '2026-11-01']);
});

test('visiblePages: window around index, placeholders elsewhere (first/last edges)', () => {
  const dates = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  // first index: window covers 0..2
  assert.deepEqual(T.visiblePages(dates, 0), [
    { date: 'a', placeholder: false }, { date: 'b', placeholder: false }, { date: 'c', placeholder: false },
    { date: 'd', placeholder: true }, { date: 'e', placeholder: true }, { date: 'f', placeholder: true },
    { date: 'g', placeholder: true },
  ]);
  // last index: window covers 4..6
  assert.deepEqual(T.visiblePages(dates, 6), [
    { date: 'a', placeholder: true }, { date: 'b', placeholder: true }, { date: 'c', placeholder: true },
    { date: 'd', placeholder: true }, { date: 'e', placeholder: false }, { date: 'f', placeholder: false },
    { date: 'g', placeholder: false },
  ]);
  // custom radius
  const tight = T.visiblePages(dates, 3, 0);
  assert.deepEqual(tight.map((p) => p.placeholder), [true, true, true, false, true, true, true]);
});

test('makeItem: temp id, trimmed text, timestamps, starts not done', () => {
  const m = T.makeItem('2026-10-30', '  hello  ', 1234);
  assert.ok(m.id.startsWith('tmp:'));
  assert.equal(m.text, 'hello');
  assert.equal(m.done, false);
  assert.equal(m.createdAt, 1234);
  assert.equal(m.updatedAt, 1234);
  // ids are unique across calls
  assert.notEqual(T.makeItem('2026-10-30', 'x').id, T.makeItem('2026-10-30', 'x').id);
});

test('toggleDone flips one item, immutably, bumping updatedAt', () => {
  const a = it('2026-10-30', 'one', 1);
  const b = it('2026-10-30', 'two', 2);
  const flipped = T.toggleDone([a, b], a.id);
  assert.equal(flipped[0].done, true);
  assert.equal(a.done, undefined); // original untouched
  assert.equal(flipped[1].done, undefined); // sibling untouched
  assert.ok(flipped[0].updatedAt >= a.updatedAt);
  const back = T.toggleDone(flipped, a.id);
  assert.equal(back[0].done, false);
});

test('updateItemText / moveItem / removeItem return new arrays, no mutation', () => {
  const a = it('2026-10-30', 'one', 1);
  const b = it('2026-10-30', 'two', 2);
  const items = [a, b];
  const edited = T.updateItemText(items, a.id, 'one!');
  assert.equal(edited[0].text, 'one!');
  assert.equal(items[0].text, 'one'); // original untouched
  assert.ok(edited[0].updatedAt >= a.updatedAt);

  const moved = T.moveItem(items, b.id, '2026-11-02');
  assert.equal(moved[1].date, '2026-11-02');
  assert.equal(items[1].date, '2026-10-30');

  const gone = T.removeItem(items, a.id);
  assert.deepEqual(gone.map((x) => x.id), [b.id]);
  assert.equal(items.length, 2);
});

test('mergeParsed: skips same date+text (whitespace-normalised), idempotent', () => {
  const existing = [it('2026-10-30', 'Buy milk', 1)];
  const incoming = [
    { date: '2026-10-30', text: 'Buy   milk' },      // same after whitespace-normalising
    { date: '2026-10-31', text: 'Buy milk' },         // same text, other date: keep
    { date: '2026-10-30', text: 'Buy bread' },
  ];
  const merged = T.mergeParsed(existing, incoming);
  assert.equal(merged.length, 3);
  // running the same paste again changes nothing
  const again = T.mergeParsed(merged, incoming);
  assert.equal(again.length, 3);
  assert.deepEqual(again.map((x) => x.text).sort(), ['Buy bread', 'Buy milk', 'Buy milk']);
});

test('parseFallback: empty and whitespace pastes return no items', () => {
  assert.deepEqual(T.parseFallback('', '2026-10-30', addDays), []);
  assert.deepEqual(T.parseFallback('   \n  \n', '2026-10-30', addDays), []);
});

test('parseFallback: lines without dates land on today, flagged guessed', () => {
  const out = T.parseFallback('just a thought\nanother one', '2026-10-30', addDays);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.date), ['2026-10-30', '2026-10-30']);
  assert.deepEqual(out.map((o) => o.guessed), [true, true]);
  assert.deepEqual(out.map((o) => o.text), ['just a thought', 'another one']);
});

test('parseFallback: ISO, M/D, M月D日, 今天/昨天/前天, 星期X', () => {
  const out = T.parseFallback([
    '2026-10-24 ISO item',
    '10/20 slash item',
    '10月18日 chinese item',
    '10月16号 other chinese',
    '今天：morning run',
    '昨天 - bought shoes',
    '前天 early start',
    '星期一 gym', // 2026-10-30 is a Friday -> most recent Monday is 10-26
    'plain tail line',
  ].join('\n'), '2026-10-30', addDays);
  assert.deepEqual(out.map((o) => o.date), [
    '2026-10-24', '2026-10-20', '2026-10-18', '2026-10-16',
    '2026-10-30', '2026-10-29', '2026-10-28', '2026-10-26', '2026-10-30',
  ]);
  assert.deepEqual(out.map((o) => o.text), [
    'ISO item', 'slash item', 'chinese item', 'other chinese',
    'morning run', 'bought shoes', 'early start', 'gym', 'plain tail line',
  ]);
  assert.deepEqual(out.map((o) => o.guessed), [
    false, false, false, false, false, false, false, false, true,
  ]);
});

test('parseFallback: same date twice keeps both items', () => {
  const out = T.parseFallback('2026-10-30 first\n2026-10-30 second', '2026-10-30', addDays);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((o) => o.text), ['first', 'second']);
});

test('parseFallback + localDateKey: no UTC drift for a locally-built today', () => {
  // build today from local components (23:59 on Oct 30 anywhere on earth)
  const key = L.localDateKey(new Date(2026, 9, 30, 23, 59));
  const out = T.parseFallback('昨天 thing', key, addDays);
  assert.equal(out[0].date, L.addDays(key, -1));
});

test('summarize: totals and range', () => {
  const s = T.summarize([it('2026-10-30', 'a', 1), it('2026-10-28', 'b', 2), it('2026-10-30', 'c', 3)]);
  assert.deepEqual(s, { total: 3, dates: 2, first: '2026-10-28', last: '2026-10-30' });
  assert.deepEqual(T.summarize([]), { total: 0, dates: 0, first: null, last: null });
});
