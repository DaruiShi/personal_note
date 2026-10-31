'use strict';
/* lib/alias.js — pure rename-alias helpers. */

const test = require('node:test');
const assert = require('node:assert/strict');
const alias = require('../lib/alias');

const { addAlias, normalizeAliases, MAX_ALIASES } = alias;

test('addAlias: records the old title, trimmed', () => {
  assert.deepEqual(addAlias(undefined, '  Old Name  ', 'New Name'), ['Old Name']);
  assert.deepEqual(addAlias([], 'Old', 'New'), ['Old']);
});

test('addAlias: no-op on identical (case/whitespace) or empty old title', () => {
  assert.deepEqual(addAlias(['kept'], 'New Name', 'new   name'), ['kept']);
  assert.deepEqual(addAlias(['kept'], '   ', 'New'), ['kept']);
  assert.deepEqual(addAlias(['kept'], '', 'New'), ['kept']);
  assert.deepEqual(addAlias(null, null, 'New'), []);
});

test('addAlias: drops an alias equal to the new title', () => {
  // renaming away from B: "B" IS a previous title, so it stays; an alias
  // equal to the NEW title is dropped (it is the live title now)
  assert.deepEqual(addAlias(['B'], 'B', 'A'), ['B']);
  assert.deepEqual(addAlias(['A', 'x'], 'B', 'A'), ['x', 'B']);
});

test('addAlias: dedupes case-insensitively keeping the most recent spelling', () => {
  assert.deepEqual(addAlias(['old spell'], 'Old Spell', 'New'), ['Old Spell']);
});

test('addAlias: caps at the last MAX_ALIASES, keeping the newest', () => {
  const many = Array.from({ length: MAX_ALIASES }, (_, i) => `t${i}`);
  const out = addAlias(many, 'brand new', 'final');
  assert.equal(out.length, MAX_ALIASES);
  assert.equal(out[out.length - 1], 'brand new');
  assert.equal(out[0], 't1'); // t0 fell off the front
});

test('addAlias: never mutates the input array', () => {
  const input = ['a'];
  addAlias(input, 'b', 'c');
  assert.deepEqual(input, ['a']);
});

test('normalizeAliases: junk input, dedupe, cap, trim', () => {
  assert.deepEqual(normalizeAliases(undefined), []);
  assert.deepEqual(normalizeAliases('nope'), []);
  assert.deepEqual(normalizeAliases([' x ', '', 'X', 42, null, {}, 'y']), ['X', 'y']);
  assert.equal(normalizeAliases(Array.from({ length: 80 }, (_, i) => `a${i}`)).length, MAX_ALIASES);
  // keeps the LAST 50
  assert.deepEqual(normalizeAliases(Array.from({ length: 60 }, (_, i) => `a${i}`))[0], 'a10');
});
