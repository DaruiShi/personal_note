'use strict';
/* Gallery notes on the server: creation + exact mirror, ordering, the
 * Android write guard, validation, conflicts, history, trash/share,
 * session features, and /api/gallery/suggest against a mock LLM. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const gl = require('../lib/gallery');
const { startServer, register, req } = require('./helpers');

function card(content, extra = {}) {
  return { content, ...extra };
}

test('create: ids, palette colours, exact markdown mirror', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'gcreate');
    const r = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'Reading list',
      kind: 'gallery',
      content: 'client content that must be ignored',
      gallery: { items: [
        card('First card body.', { title: 'Kept title', tags: ['books'], color: 'teal' }),
        card('Second card body and more.'),
        card('Third 卡片内容。', { title: '第三张', tags: ['a', 'b'] }),
      ] },
      tags: [], pinned: false,
    });
    assert.equal(r.status, 201);
    const note = r.data.note;
    assert.equal(note.kind, 'gallery');
    assert.match(note.gallery.items[0].id, /^[0-9a-f-]{36}$/);
    assert.ok(gl.PALETTE.includes(note.gallery.items[1].color)); // colour assigned
    // the mirror is the exact contract — assert the whole string
    assert.equal(note.content, [
      '## Kept title',
      '',
      'First card body.',
      '',
      'Tags: books',
      '',
      '---',
      '',
      '## Second card body and more',
      '',
      'Second card body and more.',
      '',
      '---',
      '',
      '## 第三张',
      '',
      'Third 卡片内容。',
      '',
      'Tags: a, b',
    ].join('\n'));
    // GET includes kind + gallery
    const one = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.equal(one.data.note.gallery.items.length, 3);
  } finally {
    await server.stop();
  }
});

test('reorder: PUTting a different array order is the new order', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'gorder');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'g', kind: 'gallery',
      gallery: { items: [card('one', { title: 'A' }), card('two', { title: 'B' }), card('three', { title: 'C' })] },
      tags: [], pinned: false,
    });
    const moved = [note.gallery.items[2], note.gallery.items[0], note.gallery.items[1]];
    const put = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'g', kind: 'gallery', rev: note.rev, gallery: { items: moved }, tags: [], pinned: false,
    });
    assert.equal(put.status, 200);
    const after = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.deepEqual(after.data.note.gallery.items.map((c) => c.title), ['C', 'A', 'B']);
    // mirror follows the order
    assert.ok(after.data.note.content.indexOf('## C') < after.data.note.content.indexOf('## A'));
  } finally {
    await server.stop();
  }
});

test('PUT without gallery -> 409 code gallery (Android guard), nothing changes', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'gguard');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'guarded', kind: 'gallery',
      gallery: { items: [card('kept card', { title: 'Kept' })] },
      tags: [], pinned: false,
    });
    const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'guarded', content: '## Kept\n\noverwritten mirror', tags: [], pinned: false, rev: note.rev,
    });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'gallery');
    assert.equal(r.data.error, 'This gallery note can only be edited in the web app');
    const after = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.equal(after.data.note.content, '## Kept\n\nkept card');
    assert.equal(after.data.note.rev, note.rev);
    // no history entry was written
    const h = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
    assert.equal(h.data.revisions.length, 0);
  } finally {
    await server.stop();
  }
});

test('validation: empty content, too many items, unknown colour, tags pipeline', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'gvalid');
    const mk = (gallery) => req(server.base, cookie, 'POST', '/api/notes', {
      title: 'v', kind: 'gallery', gallery, tags: [], pinned: false,
    });
    let r = await mk({ items: [card('ok', { title: 'x' }), card('   ')] });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_item_content');
    assert.equal(r.data.index, 1);

    r = await mk({ items: Array.from({ length: gl.MAX_ITEMS + 1 }, (_, i) => card(`c${i}`)) });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'too_many_items');

    r = await mk({ items: [card('body', { title: 'ok', color: 'hotpink', tags: '#A, b, a, , #c' })] });
    assert.equal(r.status, 201);
    const c = r.data.note.gallery.items[0];
    assert.ok(gl.PALETTE.includes(c.color)); // unknown colour replaced
    assert.deepEqual(c.tags, ['A', 'b', 'c']); // # stripped, deduped, empties dropped

    // empty title fills from content (fallbackTitle)
    r = await mk({ items: [card('The quick brown fox jumps over the lazy dog again and again.')] });
    assert.equal(r.data.note.gallery.items[0].title, 'The quick brown fox jumps over the lazy dog…');
  } finally {
    await server.stop();
  }
});

test('rev conflict on a gallery note -> 409, items unchanged', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'gconf');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'c', kind: 'gallery', gallery: { items: [card('one', { title: 'A' })] }, tags: [], pinned: false,
    });
    const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'c', kind: 'gallery', rev: note.rev + 9,
      gallery: { items: [card('one', { title: 'A' }), card('two')] },
      tags: [], pinned: false,
    });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'conflict');
    const after = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.equal(after.data.note.gallery.items.length, 1);
  } finally {
    await server.stop();
  }
});

test('history: entries carry noteKind gallery; restore brings back items', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'ghist');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'h', kind: 'gallery', gallery: { items: [card('one', { title: 'A' })] }, tags: [], pinned: false,
    });
    const second = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'h', kind: 'gallery', rev: note.rev,
      gallery: { items: [card('one', { title: 'A' }), card('two', { title: 'B' })] },
      tags: [], pinned: false,
    });
    assert.equal(second.status, 200);
    const h = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history/${note.rev}`);
    assert.equal(h.data.revision.noteKind, 'gallery');
    assert.equal(h.data.revision.gallery.items.length, 1);
    const restore = await req(server.base, cookie, 'POST',
      `/api/notes/${note.id}/history/${note.rev}/restore`, { rev: second.data.note.rev });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.note.gallery.items.length, 1);
    assert.equal(restore.data.note.content, '## A\n\none');
    assert.equal(restore.data.note.kind, 'gallery');
  } finally {
    await server.stop();
  }
});

test('trash + restore + share work through the mirror', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'gshare');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'shared gallery', kind: 'gallery',
      gallery: { items: [card('body one', { title: '公开卡片' }), card('body two', { title: 'Second' })] },
      tags: [], pinned: false,
    });
    const sh = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/share`);
    const pub = await fetch(`${server.base}/api/share/${sh.data.share.token}`);
    const pubData = await pub.json();
    assert.equal(pub.status, 200);
    assert.ok(pubData.content.includes('## 公开卡片'), 'share content has the card title');
    assert.ok(pubData.content.includes('## Second'));
    await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
    const gone = await fetch(`${server.base}/api/share/${sh.data.share.token}`);
    assert.equal(gone.status, 404);
    const back = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/restore`);
    assert.equal(back.status, 200);
    assert.equal(back.data.note.gallery.items.length, 2);
  } finally {
    await server.stop();
  }
});

test('session advertises gallery features', async () => {
  const server = await startServer();
  try {
    const s = await req(server.base, '', 'GET', '/api/session');
    assert.equal(s.data.features.gallery, true);
    assert.equal(s.data.features.gallerySuggest, false); // no config in tests by default
  } finally {
    await server.stop();
  }
});

/* --------------------------------------------------- suggest + mock LLM */

async function withMockLlm(handler, t) {
  const mock = http.createServer(handler);
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const port = mock.address().port;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'g-cfg-'));
  const cfgFile = path.join(dir, 'config.json');
  await fsp.writeFile(cfgFile, JSON.stringify({
    llm: {
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'MiniMax-M3.1-Flash',
      apiKey: 'test-key-do-not-log',
      timeoutMs: 800,
      maxInputChars: 50,
      maxItemsPerRequest: 200,
      requestsPerHourPerUser: 30,
      suggestPerHourPerUser: 2,
    },
  }));
  try {
    await t(cfgFile);
  } finally {
    mock.close();
  }
}

function minimaxBody(content) {
  return JSON.stringify({ choices: [{ message: { content } }], usage: {}, base_resp: { status_code: 0, status_msg: 'ok' } });
}

test('suggest: 503 unconfigured; mock happy path cleans and returns; body carries only the card content', async () => {
  const bare = await startServer();
  try {
    const cookie = await register(bare.base, 'gsug1');
    const r = await req(bare.base, cookie, 'POST', '/api/gallery/suggest', { content: 'x' });
    assert.equal(r.status, 503);
    assert.equal(r.data.code, 'llm_not_configured');
  } finally {
    await bare.stop();
  }

  let captured = null; // the upstream request our client sent
  await withMockLlm((rq, rs) => {
    let raw = '';
    rq.on('data', (c) => { raw += c; });
    rq.on('end', () => {
      captured = { auth: rq.headers.authorization || '', body: JSON.parse(raw) };
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(minimaxBody('```json\n{"title":"\\"卡片的一个标题.\\"","tags":["#Work","work","想法","Notes","tips","more","extra"]}\n```'));
    });
  }, async (cfgFile) => {
    const server = await startServer({ env: { CONFIG_FILE: cfgFile } });
    try {
      const cookie = await register(server.base, 'gsug2');
      const r = await req(server.base, cookie, 'POST', '/api/gallery/suggest', {
        content: '卡片正文内容 only this', need: { title: true, tags: true }, maxTags: 5,
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.model, 'MiniMax-M3.1-Flash');
      // quotes stripped, trailing period stripped, tags: # stripped, deduped
      // case-insensitively, capped at maxTags 5
      assert.equal(r.data.title, '卡片的一个标题');
      assert.deepEqual(r.data.tags, ['work', '想法', 'notes', 'tips', 'more']);
      // the upstream request carried ONLY the card content and Bearer auth
      assert.match(captured.auth, /^Bearer test-key-do-not-log$/);
      const msgs = captured.body.messages;
      assert.equal(msgs.length, 2);
      assert.equal(msgs[1].role, 'user');
      assert.equal(msgs[1].content, '卡片正文内容 only this');
      assert.equal(captured.body.thinking, undefined); // never sent unconfigured
      // the response carries no key
      assert.equal(JSON.stringify(r.data).includes('test-key'), false);
    } finally {
      await server.stop();
    }
  });
});

test('suggest: unparsable -> 502, oversized -> 413, empty -> 400, rate limit -> 429, need filters', async () => {
  let mode = 'ok';
  await withMockLlm((rq, rs) => {
    let raw = '';
    rq.on('data', (c) => { raw += c; });
    rq.on('end', () => {
      if (mode === 'ok') {
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(minimaxBody('{"title":"Fine title","tags":["a","b"]}'));
      } else if (mode === 'unparsable') {
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(minimaxBody('Sure! Here is a title: something.'));
      }
    });
  }, async (cfgFile) => {
    const server = await startServer({ env: { CONFIG_FILE: cfgFile } });
    try {
      const cookie = await register(server.base, 'gsug3');

      let r = await req(server.base, cookie, 'POST', '/api/gallery/suggest', { content: 'abc' });
      assert.equal(r.status, 200);
      assert.equal(r.data.title, 'Fine title');

      // need: tags only -> no title in response
      r = await req(server.base, cookie, 'POST', '/api/gallery/suggest', { content: 'abc', need: { title: false } });
      assert.equal(r.status, 200);
      assert.equal('title' in r.data, false);
      assert.deepEqual(r.data.tags, ['a', 'b']);

      mode = 'unparsable';
      const cUnparsable = await register(server.base, 'gsug5'); // fresh budget: the calls above spent gsug3's
      r = await req(server.base, cUnparsable, 'POST', '/api/gallery/suggest', { content: 'abc' });
      assert.equal(r.status, 502);
      assert.equal(r.data.code, 'llm_unparsable');
      mode = 'ok';

      // body validation (fresh budget — the rate gate runs before it)
      const cVal = await register(server.base, 'gsug6');
      r = await req(server.base, cVal, 'POST', '/api/gallery/suggest', { content: '   ' });
      assert.equal(r.status, 400);
      assert.equal(r.data.code, 'empty_content');
      r = await req(server.base, cVal, 'POST', '/api/gallery/suggest', { content: 'x'.repeat(4001) });
      assert.equal(r.status, 413);
      assert.equal(r.data.code, 'content_too_large');

      // the budget is 2/hour: two ok calls above were the fresh user's;
      // wait — need-only counts too. Use a second user for the rate check.
      const c2 = await register(server.base, 'gsug4');
      await req(server.base, c2, 'POST', '/api/gallery/suggest', { content: 'one' });
      await req(server.base, c2, 'POST', '/api/gallery/suggest', { content: 'two' });
      r = await req(server.base, c2, 'POST', '/api/gallery/suggest', { content: 'three' });
      assert.equal(r.status, 429);
      assert.equal(r.data.code, 'too_many_requests');
      assert.ok(r.data.retryAfter >= 1);
    } finally {
      await server.stop();
    }
  });
});

test('lib/gallery unit: normalizeGallery order, fallbackTitle, nextColor determinism', () => {
  const seq = [0, 0, 0];
  let i = 0;
  const rand = (n) => { const v = [0, 1, 0][i++ % 3] % Math.max(n, 1); return v; };
  const r = gl.normalizeGallery({
    items: [
      card('Body one.', { title: '  Kept  ', tags: '#A, a, b', color: 'rose' }),
      card('Second body'), // no title, no colour
      card('第三卡片，没有句号。', { color: 'rose' }),
      'junk', null,
    ],
  }, { rand });
  assert.ok(r.ok);
  assert.equal(r.items.length, 3); // junk skipped silently
  assert.equal(r.items[0].title, 'Kept');
  assert.deepEqual(r.items[0].tags, ['A', 'b']);
  assert.equal(r.items[1].title, 'Second body'); // short content = whole title, no ellipsis
  assert.notEqual(r.items[1].color, 'rose'); // least-used colour
  assert.equal(r.items[2].color, 'rose'); // now least-used again after one rose
  // mirror exactness
  assert.equal(gl.galleryToMarkdown(r.items), r.markdown);
  // fallbackTitle edge
  assert.equal(gl.fallbackTitle('Hi'), 'Hi');
  assert.equal(gl.fallbackTitle('x'.repeat(100)), Array.from('x'.repeat(100)).slice(0, 24).join('') + '…');
});
