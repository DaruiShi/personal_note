'use strict';
/* Phase A: server-rendered <head> for /share/<token> — OG/Twitter tags,
 * canonical, noindex, escaping, PUBLIC_BASE_URL handling. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, register, req, uploadPng, createNote } = require('./helpers');

let server, cookie;

test.before(async () => {
  server = await startServer();
  cookie = await register(server.base, 'sharer');
});

test.after(async () => {
  await server.stop();
});

const share = async (noteId) => {
  const r = await req(server.base, cookie, 'POST', `/api/notes/${noteId}/share`);
  assert.equal(r.status, 200);
  return r.data.share.token;
};

async function getShare(token) {
  const res = await fetch(`${server.base}/share/${token}`);
  return { status: res.status, headers: res.headers, html: await res.text() };
}

test('a live share link returns the shell with a full head', async () => {
  const note = await createNote(server.base, cookie, 'Hello **world** from the share test.');
  note.title = 'My shared note';
  await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'My shared note', content: note.content, tags: [], pinned: false, rev: note.rev,
  });
  const token = await share(note.id);
  const { status, headers, html } = await getShare(token);

  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /^text\/html/);
  assert.equal(headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  assert.equal(headers.get('cache-control'), 'no-store');

  // exactly one <title> and one description
  assert.equal((html.match(/<title>/g) || []).length, 1);
  assert.equal((html.match(/name="description"/g) || []).length, 1);
  assert.ok(html.includes('<title>My shared note — Notes</title>'), 'title with em dash');
  assert.ok(html.includes('property="og:title" content="My shared note"'));
  assert.ok(html.includes('property="og:description"'));
  assert.ok(html.includes(`property="og:url" content="${server.base}/share/${token}"`));
  assert.ok(html.includes(`<link rel="canonical" href="${server.base}/share/${token}"`)); // Host-derived origin
  assert.ok(html.includes('name="robots" content="noindex, nofollow, noarchive"'));
  assert.ok(html.includes('property="article:modified_time"'));
});

test('a note with an uploaded image gets og:image pointing at the token-authorised upload', async () => {
  const url = await uploadPng(server.base, cookie);
  const note = await createNote(server.base, cookie, `pic ![a pic](${url}) and text`);
  const token = await share(note.id);
  const { html } = await getShare(token);
  const m = html.match(/property="og:image" content="([^"]+)"/);
  assert.ok(m, 'og:image present');
  assert.ok(m[1].startsWith(server.base + '/uploads/'), 'absolute');
  assert.ok(m[1].endsWith(`?s=${token}`), 'share token appended');
  assert.match(m[1], /\/uploads\/[a-f0-9]{32}\.png\?s=[a-f0-9]{32}$/);
  assert.ok(html.includes('property="og:image:alt" content="a pic"'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
});

test('a note without an image has no og:image (no default shipped)', async () => {
  const note = await createNote(server.base, cookie, 'just text, no images');
  const token = await share(note.id);
  const { html } = await getShare(token);
  assert.equal(/property="og:image"/.test(html), false);
  assert.ok(html.includes('name="twitter:card" content="summary"'));
});

test('a hostile title produces inert HTML', async () => {
  const note = await createNote(server.base, cookie, 'content');
  await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: '</title><script>alert(1)</script>', content: 'content', tags: [], pinned: false, rev: note.rev,
  });
  const token = await share(note.id);
  const { html } = await getShare(token);
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.ok(html.includes('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped form present');
});

test('the description is markdown-stripped, single-line and bounded', async () => {
  const md = [
    '# Heading',
    '```js\nconst x = 1;\n```',
    'Some **bold** and *italic* and `code` text.',
    '- a list item',
    '> a quote',
    '[a link](https://example.com)',
    '| a | b |',
    '| --- | --- |',
    ...Array.from({ length: 20 }, (_, i) => `plain sentence number ${i} with several words`),
  ].join('\n');
  const note = await createNote(server.base, cookie, md);
  const token = await share(note.id);
  const { html } = await getShare(token);
  const m = html.match(/name="description" content="([^"]*)"/);
  assert.ok(m);
  assert.ok(m[1].length <= 163, `at most 160 chars plus ellipsis, got ${m[1].length}`);
  assert.ok(!/[#`[\]|\*]/.test(m[1]), 'no markdown residue');
  assert.ok(!m[1].includes('\n'), 'single line');
});

test('unknown, revoked, trashed and malformed tokens all 404 with noindex', async () => {
  const unknown = await getShare('a'.repeat(32));
  assert.equal(unknown.status, 404);
  assert.ok(unknown.html.includes('noindex'));
  assert.equal((unknown.html.match(/<title>/g) || []).length, 1);
  assert.equal(/property="og:/.test(unknown.html), false, 'no OG tags on 404');

  const note = await createNote(server.base, cookie, 'to revoke');
  const token = await share(note.id);
  await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}/share`);
  assert.equal((await getShare(token)).status, 404);

  const note2 = await createNote(server.base, cookie, 'to trash');
  const token2 = await share(note2.id);
  await req(server.base, cookie, 'DELETE', `/api/notes/${note2.id}`);
  assert.equal((await getShare(token2)).status, 404);

  const bad = await fetch(`${server.base}/share/not-a-token`);
  assert.equal(bad.status, 404);
  assert.ok((await bad.text()).includes('noindex'));
});

test('PUBLIC_BASE_URL makes og:url and og:image absolute on that origin', async () => {
  const s2 = await startServer({ env: { PUBLIC_BASE_URL: 'https://example.test/' } });
  try {
    const c2 = await register(s2.base, 'sharer2');
    const url = await uploadPng(s2.base, c2);
    const note = await createNote(s2.base, c2, `![x](${url})`);
    const r = await req(s2.base, c2, 'POST', `/api/notes/${note.id}/share`);
    const token = r.data.share.token;
    const res = await fetch(`${s2.base}/share/${token}`);
    const html = await res.text();
    assert.ok(html.includes(`property="og:url" content="https://example.test/share/${token}"`));
    assert.match(html, /property="og:image" content="https:\/\/example\.test\/uploads\/[a-f0-9]{32}\.png\?s=/);
    // the configured origin is also exposed to the SPA
    const sess = await req(s2.base, '', 'GET', '/api/session');
    assert.equal(sess.data.publicBaseUrl, 'https://example.test');
  } finally {
    await s2.stop();
  }
});

test('GET /api/session exposes publicBaseUrl (null when unset)', async () => {
  const r = await req(server.base, '', 'GET', '/api/session');
  assert.equal(r.status, 200);
  assert.ok('publicBaseUrl' in r.data);
  assert.equal(r.data.publicBaseUrl, null);
});
