'use strict';
/* NotesGallery — the browser pure module from public/gallery.js, plus
 * parity tests against the server copy in lib/gallery.js. */

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../public/gallery');
const serverGallery = require('../lib/gallery');

test('parity: PALETTE identical to the server copy', () => {
  assert.deepEqual(G.PALETTE, serverGallery.PALETTE);
  assert.equal(G.PALETTE.length, 12);
});

test('parity: fallbackTitle agrees on a sample table', () => {
  const samples = [
    'Simple ASCII sentence. And another one that follows it.',
    'One sentence with no terminator at all',
    '中文内容没有任何句号也没有空格这是一段很长很长的文字用来验证按字符截断的行为是否完全一致而且还要更长一些',
    'Emoji start 🎉 party time 🥳 with more text after the emoji so it truncates',
    'word ',                       // trims to empty-ish
    '',
    'A single verylongwordwithoutanyspacesatallthatkeepsgoingandgoingandgoingandgoing on and on',
    'Trailing punctuation...?!',
    'Mixed 中文 and english words in one sentence.',
    '2026-10-31 meeting notes',
  ];
  for (const s of samples) {
    assert.strictEqual(
      G.fallbackTitle(s),
      serverGallery.fallbackTitle(s),
      `fallbackTitle disagrees on: ${JSON.stringify(s.slice(0, 40))}`,
    );
  }
  // and both honor maxWords
  assert.strictEqual(G.fallbackTitle('a b c d e f g h i j k', 3), serverGallery.fallbackTitle('a b c d e f g h i j k', 3));
});

test('fallbackTitle: sentence, word cap, ellipsis rules', () => {
  assert.equal(G.fallbackTitle('First sentence here. Second.'), 'First sentence here…');
  assert.equal(G.fallbackTitle('Exactly two words'), 'Exactly two words');
  assert.equal(G.fallbackTitle('one two three four five six seven eight nine ten'), 'one two three four five six seven eight nine…');
  assert.equal(G.fallbackTitle(''), 'Untitled card');
  assert.equal(G.fallbackTitle(null), 'Untitled card');
});

test('previewText: word-boundary cut, CJK, surrogate pairs, no cut', () => {
  assert.equal(G.previewText('short text'), 'short text');
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const p = G.previewText(words, 40);
  assert.ok(p.length < words.length);
  assert.ok(p.endsWith('…'));
  assert.ok(!p.slice(0, -1).endsWith(' '), 'does not end mid-word');
  assert.ok(p.split(' ').every((w) => words.includes(w.replace('…', '')) || w === '…' || words.includes(w)), 'only whole words');
  // CJK: character-budgeted cut
  const cjk = '字'.repeat(300);
  const cp = G.previewText(cjk, 50);
  assert.equal(Array.from(cp).length, 51); // 50 chars + ellipsis
  // surrogate pair never split: 90 emoji, cut at 40 chars → 40 emoji + …
  const emoji = '🎉'.repeat(90);
  const ep = G.previewText(emoji, 40);
  assert.equal(Array.from(ep).length, 41);
  assert.ok(ep.endsWith('🎉…') || ep.endsWith('…'));
});

test('normalizeTags: strings, arrays, dedupe, cap, #, CJK comma', () => {
  assert.deepEqual(G.normalizeTags('#Work, ideas,, work'), ['Work', 'ideas']);
  assert.deepEqual(G.normalizeTags('a b a B'), ['a', 'b']);
  assert.deepEqual(G.normalizeTags(['x', '#Y', ' x ', '']), ['x', 'Y']);
  assert.deepEqual(G.normalizeTags('唯一，标签，唯一'), ['唯一', '标签']);
  const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
  assert.equal(G.normalizeTags(many).length, 10);
  const long = G.normalizeTags(['x'.repeat(50)]);
  assert.equal(long[0].length, 32);
  assert.deepEqual(G.normalizeTags(null), []);
  assert.deepEqual(G.normalizeTags('   '), []);
});

test('newCard: defaults, normalization, palette guard', () => {
  const c = G.newCard({ title: '  T  ', content: ' body ', tags: '#a, b', color: 'nope' });
  assert.equal(c.title, 'T');
  assert.equal(c.content, 'body');
  assert.deepEqual(c.tags, ['a', 'b']);
  assert.ok(G.isPaletteKey(c.color));
  assert.notEqual(c.id, G.newCard({}).id);
  const fixed = G.newCard({ color: 'teal', id: 'kept' });
  assert.equal(fixed.color, 'teal');
  assert.equal(fixed.id, 'kept');
});

test('updateCard / removeCard are immutable', () => {
  const a = G.newCard({ title: 'a', id: 'a' });
  const b = G.newCard({ title: 'b', id: 'b' });
  const items = [a, b];
  const updated = G.updateCard(items, 'a', { title: 'A!' });
  assert.equal(updated[0].title, 'A!');
  assert.equal(items[0].title, 'a');
  assert.ok(updated[0].updatedAt >= a.updatedAt);
  assert.deepEqual(G.removeCard(items, 'a').map((c) => c.id), ['b']);
});

test('reorder to start, end, same index; clamped', () => {
  const items = [1, 2, 3, 4].map((n) => G.newCard({ title: `c${n}`, id: `c${n}` }));
  const ids = (l) => l.map((c) => c.id);
  assert.deepEqual(ids(G.reorder(items, 'c3', 0)), ['c3', 'c1', 'c2', 'c4']);
  assert.deepEqual(ids(G.reorder(items, 'c1', 3)), ['c2', 'c3', 'c4', 'c1']);
  assert.deepEqual(ids(G.reorder(items, 'c2', 1)), ['c1', 'c2', 'c3', 'c4']); // same place
  assert.deepEqual(ids(G.reorder(items, 'c2', 99)), ['c1', 'c3', 'c4', 'c2']); // clamped
  assert.deepEqual(ids(G.reorder(items, 'zz', 0)), ['c1', 'c2', 'c3', 'c4']); // unknown id: no-op
});

test('moveBy: both directions and clamping', () => {
  const items = [1, 2, 3].map((n) => G.newCard({ title: `c${n}`, id: `c${n}` }));
  const ids = (l) => l.map((c) => c.id);
  assert.deepEqual(ids(G.moveBy(items, 'c1', 1)), ['c2', 'c1', 'c3']);
  assert.deepEqual(ids(G.moveBy(items, 'c3', -2)), ['c3', 'c1', 'c2']);
  assert.deepEqual(ids(G.moveBy(items, 'c1', -5)), ['c1', 'c2', 'c3']); // clamp at start
  assert.deepEqual(ids(G.moveBy(items, 'c3', 5)), ['c1', 'c2', 'c3']); // clamp at end
  assert.deepEqual(ids(G.moveBy(items, 'c2', 0)), ['c1', 'c2', 'c3']); // no-op
});

test('applySuggestion fills only empty requested fields', () => {
  const typed = G.newCard({ title: 'User typed', content: 'x', id: 'c1' });
  const empty = G.newCard({ content: 'x', id: 'c2' });
  let items = [typed, empty];
  items = G.applySuggestion(items, 'c1', { title: 'AI title', tags: ['ai'] });
  assert.equal(items[0].title, 'User typed'); // never overwritten
  assert.deepEqual(items[0].tags, ['ai']);   // tags were empty → filled
  items = G.applySuggestion(items, 'c2', { title: 'AI title', tags: ['ai', 'ai', 'notes'] });
  assert.equal(items[1].title, 'AI title');
  // empty suggestion values fill nothing
  const untouched = G.applySuggestion(items, 'c2', { title: '', tags: [] });
  assert.equal(untouched[1].updatedAt, items[1].updatedAt);
});

test('summary counts cards, distinct tags and colours', () => {
  const s = G.summary([
    G.newCard({ title: 'a', tags: ['x', 'y'], color: 'amber' }),
    G.newCard({ title: 'b', tags: ['X', 'z'], color: 'amber' }),
    G.newCard({ title: 'c', color: 'teal' }),
  ]);
  assert.deepEqual(s, { total: 3, tagCount: 3, colors: 2 });
  assert.deepEqual(G.summary([]), { total: 0, tagCount: 0, colors: 0 });
});

test('isPaletteKey', () => {
  assert.equal(G.isPaletteKey('teal'), true);
  assert.equal(G.isPaletteKey('#ff0000'), false);
  assert.equal(G.isPaletteKey('Teal'), false); // keys are lowercase
  assert.equal(G.isPaletteKey(undefined), false);
});
