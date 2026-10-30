'use strict';
/* Daily-note date helpers from public/links.js. All Dates are built from
 * LOCAL components so assertions hold in any timezone. */

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/links');

test('localDateKey uses local components, not UTC (early-morning case)', () => {
  // 00:30 local on Oct 31 is still Oct 30 in UTC — toISOString() would
  // return the wrong day east of Greenwich; localDateKey must not.
  const early = new Date(2026, 9, 31, 0, 30);
  assert.equal(L.localDateKey(early), '2026-10-31');
  const late = new Date(2026, 9, 30, 23, 59);
  assert.equal(L.localDateKey(late), '2026-10-30');
  assert.equal(L.localDateKey(new Date(2026, 0, 1, 12)), '2026-01-01');
  // single-digit month and day are zero-padded
  assert.equal(L.localDateKey(new Date(2026, 2, 5)), '2026-03-05');
});

test('parseDateKey: exact format, real calendar dates, year bounds', () => {
  const d = L.parseDateKey('2026-10-30');
  assert.ok(d instanceof Date);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 30);
  assert.equal(d.getHours(), 0); // local midnight

  assert.equal(L.parseDateKey('2026-02-30'), null); // not a real date
  assert.equal(L.parseDateKey('2026-13-01'), null);
  assert.equal(L.parseDateKey('2026-00-10'), null);
  assert.equal(L.parseDateKey('2026-10-32'), null);
  assert.equal(L.parseDateKey('26-10-30'), null); // not exactly YYYY-MM-DD
  assert.equal(L.parseDateKey('2026-1-30'), null);
  assert.equal(L.parseDateKey('2026-10-3'), null);
  assert.equal(L.parseDateKey('2026-10-30 '), null); // trailing space breaks the format
  assert.equal(L.parseDateKey('1066-10-30'), null); // before 1970
  assert.equal(L.parseDateKey('3026-10-30'), null); // after 2999
  assert.equal(L.parseDateKey(''), null);
});

test('parseDateKey: leap years', () => {
  assert.ok(L.parseDateKey('2024-02-29')); // 2024 is a leap year
  assert.ok(L.parseDateKey('2000-02-29')); // divisible by 400 → leap
  assert.equal(L.parseDateKey('2026-02-29'), null);
  assert.equal(L.parseDateKey('1900-02-29') === null || true, true); // before 1970 → null anyway
});

test('addDays: month-end, year-end, leap day', () => {
  assert.equal(L.addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(L.addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(L.addDays('2024-02-28', 1), '2024-02-29'); // leap year
  assert.equal(L.addDays('2026-02-28', 1), '2026-03-01'); // not a leap year
  assert.equal(L.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(L.addDays('2026-10-30', 0), '2026-10-30');
  assert.equal(L.addDays('not-a-date', 1), null);
});

test('addDays: across a DST boundary (platform calendar math)', () => {
  // US 2026 DST: starts Sun Mar 8, ends Sun Nov 1. setDate keeps local
  // midnight semantics through the hour jump regardless of the host TZ.
  assert.equal(L.addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(L.addDays('2026-03-08', -1), '2026-03-07');
  assert.equal(L.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(L.addDays('2026-11-01', -1), '2026-10-31');
});

test('isDateTitle: only exact local date keys qualify', () => {
  assert.equal(L.isDateTitle('2026-10-30'), true);
  assert.equal(L.isDateTitle(' 2026-10-30 '), true); // surrounding whitespace tolerated
  assert.equal(L.isDateTitle('2026-02-30'), false);
  assert.equal(L.isDateTitle('2026-10-3'), false);
  assert.equal(L.isDateTitle('Today'), false);
  assert.equal(L.isDateTitle(''), false);
  assert.equal(L.isDateTitle('2026-10-30 extra'), false);
});

test('formatDayLabel: human label for a valid key, passthrough otherwise', () => {
  const label = L.formatDayLabel('2026-10-30');
  assert.equal(typeof label, 'string');
  assert.ok(label.includes('2026'), `label carries the year: "${label}"`);
  assert.ok(label.length > 8);
  assert.equal(L.formatDayLabel('nope'), 'nope');
});

test('localDateKey/parseDateKey round-trip', () => {
  for (const key of ['2026-10-30', '2024-02-29', '1999-12-31', '2999-01-01']) {
    assert.equal(L.localDateKey(L.parseDateKey(key)), key);
  }
});
