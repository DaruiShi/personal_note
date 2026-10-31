'use strict';
/* Citations over HTTP: rename records aliases, aliases are read-only to
 * clients, history restores them, loadDb normalises junk. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { startServer, register, req } = require('./helpers');

async function mkNote(base, cookie, title) {
  const r = await req(base, cookie, 'POST', '/api/notes', { title, content: `body of ${title}`, tags: [], pinned: false });
  if (r.status !== 201) throw new Error(`create failed: HTTP ${r.status}`);
  return r.data.note;
}

test('rename records the previous title as an alias; twice keeps both', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'cit1');
    const note = await mkNote(server.base, cookie, 'Original');
    const r1 = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'Renamed once', content: note.content, tags: [], pinned: false, rev: note.rev,
    });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.data.note.aliases, ['Original']);

    const r2 = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'Renamed twice', content: note.content, tags: [], pinned: false, rev: r1.data.note.rev,
    });
    assert.deepEqual(r2.data.note.aliases, ['Original', 'Renamed once']);

    // GET /api/notes returns them (whole note objects)
    const list = await req(server.base, cookie, 'GET', '/api/notes');
    const mine = list.data.notes.find((n) => n.id === note.id);
    assert.deepEqual(mine.aliases, ['Original', 'Renamed once']);
  } finally {
    await server.stop();
  }
});

test('a PUT carrying aliases has no effect; a no-rename PUT records nothing', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'cit2');
    const note = await mkNote(server.base, cookie, 'Victim');
    const target = await mkNote(server.base, cookie, 'Target');
    // try to hijack: claim the other note's title as an alias via the body
    const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: note.title, content: note.content, tags: [], pinned: false, rev: note.rev,
      aliases: ['Target', 'Injected'],
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.note.aliases, undefined);

    // a same-title PUT (no rename) also records nothing
    const r2 = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: note.title, content: 'edited body', tags: [], pinned: false, rev: r.data.note.rev,
    });
    assert.equal(r2.data.note.aliases, undefined);
  } finally {
    await server.stop();
  }
});

test('history restore brings aliases back', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'cit3');
    const note = await mkNote(server.base, cookie, 'First');
    const renamed = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
      title: 'Second', content: note.content, tags: [], pinned: false, rev: note.rev,
    });
    // history/1 snapshots the PRE-rename state (no aliases); restoring it
    // drops aliases, exactly like restoring a pre-timeline revision
    const back1 = await req(server.base, cookie, 'POST',
      `/api/notes/${note.id}/history/1/restore`, { rev: renamed.data.note.rev });
    assert.equal(back1.status, 200);
    assert.equal(back1.data.note.aliases, undefined);

    // the 'restore' entry written by that restore snapshots the POST-rename
    // state — aliases included — and restore entries always append (no 60s
    // floor like 'edit' entries have)
    const h = await req(server.base, cookie, 'GET',
      `/api/notes/${note.id}/history/${back1.data.note.rev - 1}`);
    assert.equal(h.status, 200);
    assert.deepEqual(h.data.revision.aliases, ['First']);
    // restoring THAT revision brings the aliases back with it
    const restore = await req(server.base, cookie, 'POST',
      `/api/notes/${note.id}/history/${back1.data.note.rev - 1}/restore`, { rev: back1.data.note.rev });
    assert.equal(restore.status, 200);
    assert.deepEqual(restore.data.note.aliases, ['First']);
  } finally {
    await server.stop();
  }
});

test('junk aliases in notes.json are normalised on load', async () => {
  const server = await startServer();
  const dataDir = server.dataDir;
  const cookie0 = await register(server.base, 'cit4');
  await mkNote(server.base, cookie0, 'Junk carrier');
  // wait for the debounced saveDb to flush before killing the process
  const dbFile0 = path.join(dataDir, 'notes.json');
  for (let i = 0; i < 50; i++) {
    try {
      if (JSON.parse(await fsp.readFile(dbFile0, 'utf8')).notes.length) break;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  await server.stop();

  // inject junk aliases directly into the store, then boot a fresh server
  const dbFile = dbFile0;
  const db = JSON.parse(await fsp.readFile(dbFile, 'utf8'));
  db.notes[0].aliases = [' good ', '', 'GOOD', 42, null, 'kept'];
  await fsp.writeFile(dbFile, JSON.stringify(db));

  const server2 = await startServer({ dataDir });
  try {
    // log back in as the original owner (register would 409 on the name)
    const login = await fetch(`${server2.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'cit4', password: 'testpassword1' }),
    });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const list = await req(server2.base, cookie, 'GET', '/api/notes');
    const mine = list.data.notes.find((n) => n.aliases != null);
    assert.ok(mine, 'the injected note booted with aliases');
    // deduped case-insensitively keeping the last spelling, junk dropped
    // dedupe keeps the MOST RECENT spelling ('GOOD' came last)
    assert.deepEqual(mine.aliases, ['GOOD', 'kept']);
  } finally {
    await server2.stop();
  }
});
