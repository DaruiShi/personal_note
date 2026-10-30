'use strict';
/* Timeline notes on the server: creation + mirror contract, the Android
 * write guard, validation codes, history round-trip, trash/share, session
 * features, and the /api/timeline/parse endpoint against a mock LLM. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const tl = require('../lib/timeline');
const { startServer, register, req } = require('./helpers');

function item(date, text, createdAt) {
  return { date, text, ...(createdAt != null ? { createdAt, updatedAt: createdAt } : {}) };
}

test('create: echo has ids, sorted dates, exact markdown mirror', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tlcreate');
    const r = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'Trip log',
      kind: 'timeline',
      content: 'client content that must be ignored',
      timeline: { items: [item('2026-10-30', 'second day'), item('2026-10-29', 'first day')] },
      tags: [], pinned: false,
    });
    assert.equal(r.status, 201);
    const note = r.data.note;
    assert.equal(note.kind, 'timeline');
    assert.match(note.timeline.items[0].id, /^[0-9a-f-]{36}$/);
    assert.deepEqual(note.timeline.items.map((i) => i.date), ['2026-10-29', '2026-10-30']);
    assert.equal(note.timeline.items[0].text, 'first day');
    // the mirror is the exact contract — assert the whole string
    assert.equal(note.content, '## 2026-10-29\n- [ ] first day\n\n## 2026-10-30\n- [ ] second day');
    // GET /api/notes includes kind + timeline
    const list = await req(server.base, cookie, 'GET', '/api/notes');
    const mine = list.data.notes.find((n) => n.id === note.id);
    assert.equal(mine.kind, 'timeline');
    assert.equal(mine.timeline.items.length, 2);
    // GET /api/notes/:id too
    const one = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.equal(one.status, 200);
    assert.equal(one.data.note.timeline.items.length, 2);
  } finally {
    await server.stop();
  }
});

test('PUT with stale rev -> 409 conflict, timeline unchanged', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tlstale');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'tl', kind: 'timeline', timeline: { items: [item('2026-10-30', 'one')] }, tags: [], pinned: false,
    });
    const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'tl', kind: 'timeline', rev: note.rev + 5,
      timeline: { items: [item('2026-10-30', 'one'), item('2026-10-31', 'two')] },
      tags: [], pinned: false,
    });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'conflict');
    const after = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.equal(after.data.note.timeline.items.length, 1);
    assert.equal(after.data.note.rev, note.rev);
  } finally {
    await server.stop();
  }
});

test('PUT without timeline -> 409 code timeline (Android guard), nothing changes', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tlguard');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'guarded', kind: 'timeline', timeline: { items: [item('2026-10-30', 'kept')] }, tags: [], pinned: false,
    });
    // exactly what the Android app sends: no kind, no timeline, just content
    const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'guarded', content: '## 2026-10-30\n- overwritten mirror', tags: [], pinned: false, rev: note.rev,
    });
    assert.equal(r.status, 409);
    assert.equal(r.data.code, 'timeline');
    assert.equal(r.data.error, 'This timeline note can only be edited in the web app');
    const after = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.equal(after.data.note.content, '## 2026-10-30\n- [ ] kept');
    assert.equal(after.data.note.rev, note.rev);
    // and no history entry was written
    const h = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
    assert.equal(h.data.revisions.length, 0);
  } finally {
    await server.stop();
  }
});

test('validation: invalid date, non-string text, too many items, invalid kind', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tlvalid');
    const mk = (timeline) => req(server.base, cookie, 'POST', '/api/notes', {
      title: 'v', kind: 'timeline', timeline, tags: [], pinned: false,
    });
    let r = await mk({ items: [item('2026-02-30', 'nope')] });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_item_date');
    assert.equal(r.data.index, 0);

    r = await mk({ items: [{ date: '2026-10-30', text: 42 }] });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_item_text');

    r = await mk({ items: Array.from({ length: tl.MAX_ITEMS + 1 }, (_, i) => item('2026-10-30', `i${i}`)) });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'too_many_items');

    r = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'v', kind: 'sketch', content: 'x', tags: [], pinned: false,
    });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_kind');

    // valid edit with a current rev goes through and regenerates the mirror
    const { data: { note } } = await mk({ items: [item('2026-10-30', 'one')] });
    const put = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'v', kind: 'timeline', rev: note.rev, tags: [], pinned: false,
      timeline: { items: [item('2026-10-30', 'one'), item('2026-10-31', 'two')] },
    });
    assert.equal(put.status, 200);
    assert.equal(put.data.note.content, '## 2026-10-30\n- [ ] one\n\n## 2026-10-31\n- [ ] two');
  } finally {
    await server.stop();
  }
});

test('history: snapshots kind + timeline and restores items, not just the mirror', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tlhist');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'h', kind: 'timeline', timeline: { items: [item('2026-10-29', 'a')] }, tags: [], pinned: false,
    });
    const second = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'h', kind: 'timeline', rev: note.rev, tags: [], pinned: false,
      timeline: { items: [item('2026-10-29', 'a'), item('2026-10-30', 'b')] },
    });
    assert.equal(second.status, 200);
    const rev2 = second.data.note.rev;

    // the pre-edit snapshot (rev 1) carries kind + items
    const h = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history/${note.rev}`);
    assert.equal(h.status, 200);
    assert.equal(h.data.revision.noteKind, 'timeline');
    assert.equal(h.data.revision.timeline.items.length, 1);

    // restore it: items come back, mirror regenerated from them
    const restore = await req(server.base, cookie, 'POST',
      `/api/notes/${note.id}/history/${note.rev}/restore`, { rev: rev2 });
    assert.equal(restore.status, 200);
    assert.equal(restore.data.note.timeline.items.length, 1);
    assert.equal(restore.data.note.timeline.items[0].text, 'a');
    assert.equal(restore.data.note.content, '## 2026-10-29\n- [ ] a');
    assert.equal(restore.data.note.kind, 'timeline');
  } finally {
    await server.stop();
  }
});

test('trash + restore + share keep working through the mirror', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tlshare');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'shared tl', kind: 'timeline', timeline: { items: [item('2026-10-29', 'x'), item('2026-10-30', 'y')] },
      tags: [], pinned: false,
    });
    // share
    const sh = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/share`);
    const pub = await fetch(`${server.base}/api/share/${sh.data.share.token}`);
    const pubData = await pub.json();
    assert.equal(pub.status, 200);
    assert.ok(pubData.content.includes('## 2026-10-29'), 'share content has the date heading');
    // trash: the share now refuses
    await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
    const gone = await fetch(`${server.base}/api/share/${sh.data.share.token}`);
    assert.equal(gone.status, 404);
    // restore: the note comes back as a timeline with its items
    const back = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/restore`);
    assert.equal(back.status, 200);
    assert.equal(back.data.note.kind, 'timeline');
    assert.equal(back.data.note.timeline.items.length, 2);
  } finally {
    await server.stop();
  }
});

test('time ranges order items within a date and ride through the mirror', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tltime');
    // untimed first in the payload; the comparator must re-order by start,
    // untimed last, and explicit order must win over time
    const r = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'day plan', kind: 'timeline',
      timeline: { items: [
        item('2026-10-30', 'untimed later'),
        { ...item('2026-10-30', 'afternoon block'), start: '14:00', end: '16:00' },
        { ...item('2026-10-30', 'morning run'), start: '07:30' },
        { ...item('2026-10-30', 'pinned first'), order: 0 },
      ] },
      tags: [], pinned: false,
    });
    assert.equal(r.status, 201);
    const items = r.data.note.timeline.items;
    assert.deepEqual(items.map((i) => i.text), ['pinned first', 'morning run', 'afternoon block', 'untimed later']);
    assert.deepEqual(items.map((i) => [i.start, i.end]), [
      [null, null], ['07:30', null], ['14:00', '16:00'], [null, null],
    ]);
    assert.equal(items[0].order, 0);
    assert.equal(r.data.note.content,
      '## 2026-10-30\n' +
      '- [ ] pinned first\n' +
      '- [ ] 07:30 morning run\n' +
      '- [ ] 14:00-16:00 afternoon block\n' +
      '- [ ] untimed later');

    // drag-style rewrite: explicit order overrides time
    const reordered = items.map((i) => ({ ...i }));
    reordered.sort((a, b) => (a.text === 'untimed later' ? -1 : b.text === 'untimed later' ? 1 : 0));
    const put = await req(server.base, cookie, 'PUT', `/api/notes/${r.data.note.id}`, {
      title: 'day plan', kind: 'timeline', rev: r.data.note.rev,
      timeline: { items: reordered.map((i, idx) => ({ ...i, order: idx })) },
      tags: [], pinned: false,
    });
    assert.equal(put.status, 200);
    assert.equal(put.data.note.timeline.items[0].text, 'untimed later');
    assert.ok(put.data.note.content.startsWith('## 2026-10-30\n- [ ] untimed later'));
    assert.ok(put.data.note.content.includes('- [ ] 07:30 morning run'));
  } finally {
    await server.stop();
  }
});

test('invalid time ranges are rejected with invalid_item_time', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tltime2');
    const mk = (extra) => req(server.base, cookie, 'POST', '/api/notes', {
      title: 't', kind: 'timeline',
      timeline: { items: [{ date: '2026-10-30', text: 'x', ...extra }] },
      tags: [], pinned: false,
    });
    let r = await mk({ start: '9am' });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_item_time');
    r = await mk({ start: '25:00' });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_item_time');
    r = await mk({ end: '10:00' }); // end without start
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_item_time');
    r = await mk({ start: '16:00', end: '14:00' }); // end before start
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'invalid_item_time');
    // valid single time passes and a non-integer order coerces to null
    r = await mk({ start: '09:05', order: 'nope' });
    assert.equal(r.status, 201);
    assert.equal(r.data.note.timeline.items[0].start, '09:05');
    assert.equal(r.data.note.timeline.items[0].order, null);
  } finally {
    await server.stop();
  }
});

test('session advertises timeline features', async () => {
  const server = await startServer();
  try {
    const s = await req(server.base, '', 'GET', '/api/session');
    assert.equal(s.data.features.timeline, true);
    assert.equal(s.data.features.timelineParse, false); // no config in tests by default
  } finally {
    await server.stop();
  }
});

test('checking an item persists done and the mirror renders task bullets', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'tldone');
    const { data: { note } } = await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'chores', kind: 'timeline',
      timeline: { items: [item('2026-10-30', 'wash dishes'), item('2026-10-30', 'buy milk')] },
      tags: [], pinned: false,
    });
    // client sends the item back with done: true (ids round-trip stably)
    const items = note.timeline.items.map((i) => ({ ...i, done: i.text === 'wash dishes' }));
    const put = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'chores', kind: 'timeline', rev: note.rev, timeline: { items }, tags: [], pinned: false,
    });
    assert.equal(put.status, 200);
    const saved = put.data.note.timeline.items;
    assert.deepEqual(saved.map((i) => [i.text, i.done]), [['wash dishes', true], ['buy milk', false]]);
    assert.equal(put.data.note.content,
      '## 2026-10-30\n- [x] wash dishes\n- [ ] buy milk');
    // and it survives a reload of the store
    const back = await req(server.base, cookie, 'GET', `/api/notes/${note.id}`);
    assert.equal(back.data.note.timeline.items[0].done, true);
  } finally {
    await server.stop();
  }
});

/* ------------------------------------------------------------ parse + mock LLM */

async function withMockLlm(handler, test) {
  const mock = http.createServer(handler);
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const port = mock.address().port;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tl-cfg-'));
  const cfgFile = path.join(dir, 'config.json');
  const cfg = {
    llm: {
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'MiniMax-M3.1-Flash',
      apiKey: 'test-key-do-not-log',
      timeoutMs: 800,
      maxInputChars: 50,
      maxItemsPerRequest: 200,
      requestsPerHourPerUser: 2,
    },
  };
  await fsp.writeFile(cfgFile, JSON.stringify(cfg));
  try {
    await test({ cfgFile, cfg });
  } finally {
    mock.close();
  }
}

function minimaxBody(content) {
  return JSON.stringify({ choices: [{ message: { content } }], usage: {}, base_resp: { status_code: 0, status_msg: 'ok' } });
}

test('parse endpoint: not configured -> 503; mock LLM happy path -> 200', async () => {
  const bare = await startServer();
  try {
    const cookie = await register(bare.base, 'tlparse1');
    const r = await req(bare.base, cookie, 'POST', '/api/timeline/parse', { text: 'x', today: '2026-10-30' });
    assert.equal(r.status, 503);
    assert.equal(r.data.code, 'llm_not_configured');
  } finally {
    await bare.stop();
  }

  let captured = null; // { auth, body } of the request our client sent
  await withMockLlm((rq, rs) => {
    let raw = '';
    rq.on('data', (c) => { raw += c; });
    rq.on('end', () => {
      captured = { auth: rq.headers.authorization || '', body: JSON.parse(raw) };
      rs.writeHead(200, { 'Content-Type': 'application/json' });
      rs.end(minimaxBody('```json\n{"items":[{"date":"2026-10-28","start":"09:00","end":"10:30","text":"昨天的事"},{"date":"2026-10-30","start":"25:99","text":"bad clock dropped","guessed":true},{"date":"2026-10-30","text":"today thing","guessed":true}]}\n```'));
    });
  }, async ({ cfgFile }) => {
    const server = await startServer({ env: { CONFIG_FILE: cfgFile } });
    try {
      const cookie = await register(server.base, 'tlparse2');
      const r = await req(server.base, cookie, 'POST', '/api/timeline/parse', {
        text: '昨天的事\ntoday thing', today: '2026-10-30',
      });
      assert.equal(r.status, 200);
      assert.equal(r.data.model, 'MiniMax-M3.1-Flash');
      assert.deepEqual(r.data.items, [
        { date: '2026-10-28', start: '09:00', end: '10:30', text: '昨天的事', guessed: false },
        { date: '2026-10-30', start: null, end: null, text: 'bad clock dropped', guessed: true },
        { date: '2026-10-30', start: null, end: null, text: 'today thing', guessed: true },
      ]);
      // what our client actually sent upstream: Bearer auth, the configured
      // model, and NO thinking field (MiniMax-M3.1-Flash rejects
      // thinking.type "disabled" with a 400 — never send it unconfigured)
      assert.match(captured.auth, /^Bearer test-key-do-not-log$/);
      assert.equal(captured.body.model, 'MiniMax-M3.1-Flash');
      assert.equal('thinking' in captured.body, false);
      assert.equal(captured.body.max_completion_tokens, 4096);
      assert.equal(captured.body.temperature, 0.1);
    } finally {
      await server.stop();
    }
  });
});

test('parse endpoint: upstream error body detail reaches the client message', async () => {
  let mode = 'unparsable';
  await withMockLlm((rq, rs) => {
    let body = '';
    rq.on('data', (c) => { body += c; });
    rq.on('end', () => {
      if (mode === 'unparsable') {
        rs.writeHead(200, { 'Content-Type': 'application/json' });
        rs.end(minimaxBody('Sure! Here are your items: - one - two'));
      } else if (mode === 'timeout') {
        setTimeout(() => { try { rs.end(); } catch { /* closed */ } }, 5000);
      } else if (mode === 'balance') {
        rs.writeHead(402, { 'Content-Type': 'application/json' });
        rs.end(JSON.stringify({ type: 'error', error: { type: 'insufficient_balance_error', message: 'insufficient balance (1008)', http_code: '402' } }));
      }
    });
  }, async ({ cfgFile }) => {
    const server = await startServer({ env: { CONFIG_FILE: cfgFile } });
    try {
      const cookie = await register(server.base, 'tlparse3');

      let r = await req(server.base, cookie, 'POST', '/api/timeline/parse', { text: 'abc', today: '2026-10-30' });
      assert.equal(r.status, 502);
      assert.equal(r.data.code, 'llm_unparsable');

      mode = 'timeout';
      r = await req(server.base, cookie, 'POST', '/api/timeline/parse', { text: 'abc', today: '2026-10-30' });
      assert.equal(r.status, 504);
      assert.equal(r.data.code, 'llm_timeout');
      mode = 'balance';

      // the platform's own reason rides along in the error message
      // (fresh user: the two calls above spent this account's hourly budget)
      const cBal = await register(server.base, 'tlparse5');
      r = await req(server.base, cBal, 'POST', '/api/timeline/parse', { text: 'abc', today: '2026-10-30' });
      assert.equal(r.status, 502);
      assert.equal(r.data.code, 'llm_failed');
      assert.ok(r.data.error.includes('insufficient balance (1008)'), r.data.error);
      mode = 'unparsable';

      // that used the 2-per-hour budget; the next is 429 before the call
      r = await req(server.base, cookie, 'POST', '/api/timeline/parse', { text: 'abc', today: '2026-10-30' });
      assert.equal(r.status, 429);
      assert.equal(r.data.code, 'too_many_requests');
      assert.ok(r.data.retryAfter >= 1);

      // a fresh user hits the input cap (maxInputChars 50)
      const c2 = await register(server.base, 'tlparse4');
      r = await req(server.base, c2, 'POST', '/api/timeline/parse', { text: 'x'.repeat(51), today: '2026-10-30' });
      assert.equal(r.status, 413);
      assert.equal(r.data.code, 'input_too_large');
    } finally {
      await server.stop();
    }
  });
});

test('lib/timeline unit: isDateKey, normalizeTimeline, mirror determinism', () => {
  assert.ok(tl.isDateKey('2024-02-29'));
  assert.equal(tl.isDateKey('2026-02-30'), false);
  assert.equal(tl.isDateKey('2026-2-3'), false);
  assert.equal(tl.isDateKey('2026-10-3x'), false);

  const keepId = 'a07b8c9d-1111-4222-8333-444455556666';
  const items = [
    { id: keepId, date: '2026-10-02', text: '  padded  ', done: true, createdAt: 5, updatedAt: 5 },
    { date: '2026-10-01', text: 'line one\nline two', createdAt: 3, updatedAt: 3 },
    { date: '2026-10-01', text: 'earlier created later in array', createdAt: 1, updatedAt: 1 },
  ];
  const norm = tl.normalizeTimeline({ items });
  assert.ok(norm.ok);
  assert.equal(norm.items.length, 3);
  assert.equal(norm.items[0].text, 'earlier created later in array'); // date then createdAt
  assert.equal(norm.items[1].text, 'line one\nline two'); // stored raw, only mirror collapses
  assert.equal(norm.items[2].id, keepId); // UUID-shaped ids survive
  assert.equal(norm.items[2].done, true); // done survives
  assert.equal(norm.items[0].done, false); // absent done coerces to false
  // determinism: same input, same bytes
  const again = tl.normalizeTimeline({ items });
  assert.equal(again.markdown, norm.markdown);
  assert.equal(norm.markdown,
    '## 2026-10-01\n- [ ] earlier created later in array\n- [ ] line one line two\n\n## 2026-10-02\n- [x] padded');
  assert.deepEqual(tl.datesOf(norm.items), ['2026-10-01', '2026-10-02']);
  assert.equal(tl.itemCount(norm.items), 3);

  const bad = tl.normalizeTimeline({ items: [{ date: '2026-10-01', text: 'x', id: 'not-a-uuid' }] });
  assert.ok(bad.ok);
  assert.notEqual(bad.items[0].id, 'not-a-uuid'); // non-UUID ids are regenerated
});
