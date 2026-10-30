'use strict';
/* Wikilink parsing, the link index, and snippets — pure functions from
 * public/links.js, required directly (no server, no DOM). */

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/links');

test('parseWikilinks: plain and labelled links, trimmed', () => {
  assert.deepEqual(
    L.parseWikilinks('See [[ My note ]] and [[Other|the other one]].'),
    [
      { target: 'My note', label: 'My note' },
      { target: 'Other', label: 'the other one' },
    ],
  );
});

test('parseWikilinks: duplicates collapse to the first occurrence', () => {
  const links = L.parseWikilinks('[[Alpha]] then [[alpha|second form]] and [[ ALPHA ]]');
  assert.equal(links.length, 1);
  assert.equal(links[0].target, 'Alpha');
  assert.equal(links[0].label, 'Alpha'); // first-seen label wins
});

test('parseWikilinks: fenced code and inline code are not links', () => {
  assert.deepEqual(L.parseWikilinks('before\n```\n[[Hidden]] and `[[Also hidden]]`\n```\nafter'), []);
  assert.deepEqual(L.parseWikilinks('a `[[X]]` b'), []);
  assert.deepEqual(L.parseWikilinks('```js\n[[X]]\n```\n[[Real]]'), [{ target: 'Real', label: 'Real' }]);
});

test('parseWikilinks: unclosed brackets and empty targets are not links', () => {
  assert.deepEqual(L.parseWikilinks('[[No close'), []);
  assert.deepEqual(L.parseWikilinks('[[ ]]'), []);
  assert.deepEqual(L.parseWikilinks('[[|label only]]'), []);
  assert.deepEqual(L.parseWikilinks(''), []);
});

test('buildLinkIndex + resolveTitle: normalisation and duplicates', () => {
  const notes = [
    { id: 'old', title: 'my   NOTE', content: '', updatedAt: 100 },
    { id: 'new', title: 'My Note', content: 'x', updatedAt: 200 },
  ];
  const idx = L.buildLinkIndex(notes);
  // duplicate titles resolve to the newest updatedAt
  assert.equal(L.resolveTitle(idx, 'MY note'), 'new');
  assert.equal(L.resolveTitle(idx, '  my note '), 'new');
  // normalisation: case, padding, internal whitespace
  assert.equal(L.resolveTitle(idx, 'mY  nOtE'), 'new');
  assert.equal(L.resolveTitle(idx, 'Nope'), null);
});

test('buildLinkIndex: empty titles are excluded from byTitle but keep outbound', () => {
  const notes = [
    { id: 'a', title: '   ', content: 'link to [[Target]]', updatedAt: 1 },
    { id: 't', title: 'Target', content: '', updatedAt: 2 },
  ];
  const idx = L.buildLinkIndex(notes);
  assert.equal(L.resolveTitle(idx, 'Target'), 't');
  assert.deepEqual(idx.outbound.get('a'), ['Target']);
  assert.deepEqual([...idx.inbound.get('t')], ['a']);
});

test('inbound/outbound round-trip: links flow both ways', () => {
  const notes = [
    { id: 'a', title: 'Alpha', content: 'see [[Beta]] here', updatedAt: 10 },
    { id: 'b', title: 'Beta', content: 'back to [[Alpha]] and [[Alpha|again]]', updatedAt: 20 },
    { id: 'c', title: 'Gamma', content: '[[Alpha]] + [[Missing]]', updatedAt: 30 },
  ];
  const idx = L.buildLinkIndex(notes);
  assert.deepEqual(idx.outbound.get('b'), ['Alpha']); // deduplicated
  assert.deepEqual([...idx.inbound.get('a')].sort(), ['b', 'c']);
  assert.equal(idx.inbound.has(L.resolveTitle(idx, 'Missing')), false); // unresolved → no inbound

  const back = L.inboundFor(idx, 'a', notes);
  assert.equal(back.length, 2);
  assert.equal(back[0].id, 'c'); // newest first (c updatedAt 30)
  assert.ok(back[0].snippet.includes('Alpha'), 'snippet mentions the link label');
});

test('inboundFor: self-links and unknown ids are skipped', () => {
  const notes = [{ id: 'a', title: 'A', content: '[[A]] self', updatedAt: 1 }];
  const idx = L.buildLinkIndex(notes);
  assert.deepEqual(L.inboundFor(idx, 'a', notes), []);
  // an inbound id whose note vanished from the list must not crash
  idx.inbound.set('a', new Set(['ghost']));
  assert.deepEqual(L.inboundFor(idx, 'a', notes), []);
});

test('extractSnippet: containment, markdown stripping, length cap', () => {
  const line = 'Some **bold** intro text before the link [[Target|the place]] and quite a lot of trailing text to force a clip';
  const snip = L.extractSnippet(line, 'target', 60);
  assert.ok(snip.length <= 60, `snippet ≤ 60, got ${snip.length}`);
  assert.ok(snip.includes('the place'), 'window covers the link label');
  assert.ok(snip.startsWith('...') || snip.endsWith('...'), 'clipped ends carry ... markers');
  assert.equal(snip.includes('**'), false, 'markdown stripped');

  const fence = 'para\n```\n[[Target]]\n```\nplain [[Target]] line';
  const s2 = L.extractSnippet(fence, 'Target');
  assert.equal(s2, 'plain Target line'); // fenced hit ignored, inline one used

  assert.equal(L.extractSnippet('nothing here', 'Target'), '');
});

test('extractSnippet: label from plain target when unlabelled', () => {
  assert.equal(L.extractSnippet('see [[Target]] now', 'target'), 'see Target now');
});

test('parseWikilinks: links across many lines keep first-seen order', () => {
  const links = L.parseWikilinks('[[B]]\n[[A]]\n[[B|b2]]');
  assert.deepEqual(links.map((l) => l.target), ['B', 'A']);
});
