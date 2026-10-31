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
      { target: 'My note', label: 'My note', explicit: false },
      { target: 'Other', label: 'the other one', explicit: true },
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
  assert.deepEqual(L.parseWikilinks('```js\n[[X]]\n```\n[[Real]]'), [{ target: 'Real', label: 'Real', explicit: false }]);
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

/* ---------------------------------------------- aliases and citations */

test('alias resolution: a citation written before a rename still resolves', () => {
  const notes = [
    { id: 'a', title: 'New Name', aliases: ['Old Name', 'Middle'], content: '', updatedAt: 10 },
    { id: 'b', title: 'Citer', content: 'see [[Old Name]]', updatedAt: 5 },
  ];
  const idx = L.buildLinkIndex(notes);
  assert.equal(L.resolveTitle(idx, 'Old Name'), 'a');
  assert.equal(L.resolveTitle(idx, 'middle'), 'a'); // case/whitespace-insensitive
  assert.equal(L.resolveTitle(idx, 'New Name'), 'a');
  // citation info carries the CURRENT title
  assert.deepEqual(L.resolveCitation(idx, notes, 'Old Name'), { id: 'a', title: 'New Name', kind: 'markdown' });
  assert.equal(L.resolveCitation(idx, notes, 'Nope'), null);
});

test('a real title always beats an alias; alias-vs-alias picks the newest', () => {
  const idx = L.buildLinkIndex([
    { id: 'real', title: 'Shared', content: '', updatedAt: 1 },
    { id: 'other', title: 'Other', aliases: ['Shared'], content: '', updatedAt: 99 },
  ]);
  assert.equal(idx.byAlias.has(L.titleKey('Shared')), false);
  assert.equal(L.resolveTitle(idx, 'Shared'), 'real');

  const coll = L.buildLinkIndex([
    { id: 'old', title: 'A', aliases: ['Ghost'], content: '', updatedAt: 1 },
    { id: 'new', title: 'B', aliases: ['Ghost'], content: '', updatedAt: 50 },
  ]);
  assert.equal(coll.byAlias.get('ghost'), 'new');
});

test('a note never aliases its own current title', () => {
  const idx = L.buildLinkIndex([{ id: 'n', title: 'Title', aliases: ['Title', 'title'], content: '', updatedAt: 1 }]);
  assert.equal(idx.byAlias.size, 0);
});

test('inbound backlinks flow through an alias', () => {
  const notes = [
    { id: 'a', title: 'New', aliases: ['Old'], content: '', updatedAt: 10 },
    { id: 'b', title: 'Citer', content: 'x [[Old]] y', updatedAt: 5 },
  ];
  const idx = L.buildLinkIndex(notes);
  assert.deepEqual([...idx.inbound.get('a')], ['b']);
  const rows = L.inboundFor(idx, 'a', notes);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].snippet, 'x Old y'); // snippet found via the alias-written link
});

test('citeCandidates ranking: exact, starts, contains, alias; limit; empty query', () => {
  const notes = [
    { id: '1', title: 'Alpha', content: '', updatedAt: 1 },
    { id: '2', title: 'Beta alpha', content: '', updatedAt: 2 },
    { id: '3', title: 'Gamma', aliases: ['alpha draft'], content: '', updatedAt: 3 },
    { id: '4', title: 'Not a match', content: '', updatedAt: 9 },
  ];
  const idx = L.buildLinkIndex(notes);
  const rows = L.citeCandidates(idx, notes, 'alpha');
  assert.deepEqual(rows.map((r) => r.id), ['1', '2', '3']); // exact > starts > alias
  assert.equal(rows[2].matchedBy, 'alias');
  // limit
  assert.equal(L.citeCandidates(idx, notes, '').length, 4); // empty = recent, all
  assert.equal(L.citeCandidates(idx, notes, '', 2).length, 2);
  const recent = L.citeCandidates(idx, notes, '');
  assert.deepEqual(recent.map((r) => r.updatedAt), [9, 3, 2, 1]); // newest first
});

test('citationFor: rejects titles containing brackets or pipe, never mangles', () => {
  assert.deepEqual(L.citationFor({ title: 'Fine Title' }), { text: '[[Fine Title]]' });
  for (const bad of ['Brack[et]', 'Close]', 'Pipe|', '  ', '']) {
    const r = L.citationFor({ title: bad });
    assert.equal(r.blocked, true, JSON.stringify(bad));
    assert.equal(r.text, '');
    assert.ok(r.reason);
  }
  assert.equal(L.citationFor(null).blocked, true);
});

test('parseWikilinks reports whether the label was explicit', () => {
  const plain = L.parseWikilinks('[[Target]]')[0];
  assert.equal(plain.explicit, false);
  assert.equal(plain.label, 'Target');
  const labelled = L.parseWikilinks('[[Target|shown]]')[0];
  assert.equal(labelled.explicit, true);
  assert.equal(labelled.label, 'shown');
});

test('regression: title-only citations from before aliases still resolve', () => {
  const idx = L.buildLinkIndex([
    { id: 'x', title: 'Plain Note', content: 'self [[Plain Note]] [[Other]]', updatedAt: 1 },
    { id: 'y', title: 'Other', content: '', updatedAt: 2 },
  ]);
  assert.equal(L.resolveTitle(idx, 'Plain Note'), 'x');
  assert.equal(L.resolveTitle(idx, 'other'), 'y');
  assert.deepEqual([...idx.inbound.get('y')], ['x']);
});

test('citeify: escapes everything, links only citations, survives XSS payloads', () => {
  const resolve = (t) => (t === 'Known' ? 'id1' : null);
  const out = L.citeify('see [[Known]] and [[Missing|x]] plus <script>alert(1)</script>', resolve);
  assert.equal(out,
    'see <a class="wikilink" href="#" data-wikilink="Known">Known</a> and ' +
    '<a class="wikilink missing" href="#" data-wikilink="Missing" title="Create this note">x</a> ' +
    'plus &lt;script&gt;alert(1)&lt;/script&gt;');
  // an injection right after a citation stays escaped
  assert.equal(L.citeify('[[a]]<img onerror=x>', resolve),
    '<a class="wikilink missing" href="#" data-wikilink="a" title="Create this note">a</a>&lt;img onerror=x&gt;');
  // unterminated [[ is literal text
  assert.equal(L.citeify('unterminated [[Nope', resolve), 'unterminated [[Nope');
  // ampersands and tags outside citations stay escaped
  assert.equal(L.citeify('plain & <b>text</b>', resolve), 'plain &amp; &lt;b&gt;text&lt;/b&gt;');
  // a label containing markup is escaped inside the anchor
  assert.equal(L.citeify('[[Known|<i>lbl</i>]]', resolve),
    '<a class="wikilink" href="#" data-wikilink="Known">&lt;i&gt;lbl&lt;/i&gt;</a>');
});
