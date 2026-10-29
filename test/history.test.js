'use strict';
/* Revision history: sidecar entries, summaries, full reads, restore, the
 * 50-entry cap, and prune safety for history/trash-referenced uploads. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { startServer, register, req, uploadPng, createNote } = require('./helpers');

let server, cookie;

test.before(async () => {
  server = await startServer();
  cookie = await register(server.base, 'historian');
});

test.after(async () => {
  await server.stop();
});

const put = (id, content, rev) =>
  req(server.base, cookie, 'PUT', `/api/notes/${id}`, {
    title: 'T', content, tags: [], pinned: false, ...(rev !== undefined ? { rev } : {}),
  });

test('an accepted edit appends an entry; the 60-second floor skips the next', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  await put(note.id, 'v2', 1);
  await put(note.id, 'v3', 2);

  const list = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
  assert.equal(list.status, 200);
  assert.equal(list.data.revisions.length, 1, 'rapid second edit must be floored');
  assert.equal(list.data.revisions[0].kind, 'edit');
  assert.equal(list.data.revisions[0].rev, 1);
  // summaries carry no full content
  assert.equal('content' in list.data.revisions[0], false);
  assert.equal(list.data.revisions[0].preview, 'v1');
});

test('history lives in a sidecar, never in notes.json', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  await put(note.id, 'v2', note.rev);
  const file = path.join(server.dataDir, 'history', `${note.id}.jsonl`);
  const raw = await fsp.readFile(file, 'utf8');
  assert.ok(raw.includes('"kind":"edit"'), 'sidecar must hold the entry');

  const db = JSON.parse(await fsp.readFile(path.join(server.dataDir, 'notes.json'), 'utf8'));
  assert.equal('history' in db, false);
  assert.equal('revisions' in db, false);
  const stored = db.notes.find((n) => n.id === note.id);
  assert.ok(stored);
  assert.equal('history' in stored, false);
  assert.equal('revisions' in stored, false);
});

test('a revision is fetched in full by rev', async () => {
  const note = await createNote(server.base, cookie, 'original-text');
  await put(note.id, 'changed-text', note.rev);
  const list = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
  const { rev } = list.data.revisions[0];

  const full = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history/${rev}`);
  assert.equal(full.status, 200);
  assert.equal(full.data.revision.content, 'original-text');

  const missing = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history/999`);
  assert.equal(missing.status, 404);
});

test('restoring an old revision appends a restore entry and changes the note', async () => {
  const note = await createNote(server.base, cookie, 'old-version');
  await put(note.id, 'new-version', note.rev); // rev 1 -> 2, edit entry holds 'old-version'
  const noteAfter = (await req(server.base, cookie, 'GET', '/api/notes')).data.notes.find((n) => n.id === note.id);

  const r = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/history/1/restore`, { rev: noteAfter.rev });
  assert.equal(r.status, 200);
  assert.equal(r.data.note.content, 'old-version');
  assert.equal(r.data.note.rev, noteAfter.rev + 1);

  const list = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
  const restore = list.data.revisions.find((x) => x.kind === 'restore');
  assert.ok(restore, 'restore must be undoable via a restore entry');
});

test('history-restore honours the rev conflict rule', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  await put(note.id, 'v2', note.rev);
  const r = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/history/1/restore`, { rev: 999 });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'conflict');
  const still = (await req(server.base, cookie, 'GET', '/api/notes')).data.notes.find((n) => n.id === note.id);
  assert.equal(still.content, 'v2');
});

test('the 50-entry cap trims the oldest lines', async () => {
  const note = await createNote(server.base, cookie, 'cap-test');
  const file = path.join(server.dataDir, 'history', `${note.id}.jsonl`);
  // Seed 55 stale entries directly (old ts so the floor does not apply).
  const old = Date.now() - 3600 * 1000;
  const seed = Array.from({ length: 55 }, (_, i) =>
    JSON.stringify({ ts: old + i, rev: i + 1, kind: 'edit', title: 'T', content: `seed-${i}`, tags: [], pinned: false, folderId: null, bytes: 8, hash: `seedhash${i}` }));
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, seed.join('\n') + '\n');

  await put(note.id, 'fresh-edit', note.rev); // appends entry #56 -> trim to 50

  const lines = (await fsp.readFile(file, 'utf8')).split('\n').filter((l) => l.trim());
  assert.equal(lines.length, 50);
  // The newest entry is an "edit" = the state before the update (cap-test).
  const last = JSON.parse(lines[lines.length - 1]);
  assert.equal(last.kind, 'edit');
  assert.equal(last.content, 'cap-test');
  const live = (await req(server.base, cookie, 'GET', '/api/notes')).data.notes.find((n) => n.id === note.id);
  assert.equal(live.content, 'fresh-edit');
  assert.equal(lines.includes(seed[0]), false, 'oldest seeded line must be gone');
  assert.equal(lines.includes(seed[5]), false, 'trimmed with it (6 oldest dropped)');
  assert.equal(lines.includes(seed[6]), true, 'the 7th-oldest is the oldest kept');
});

test('pruning keeps uploads referenced by history or by a trashed note', async () => {
  // F1: referenced only by a history entry (the note moved on).
  const f1 = await uploadPng(server.base, cookie);
  const a = await createNote(server.base, cookie, `with ${f1}`);
  await put(a.id, 'no reference any more', a.rev); // history entry still holds f1

  // F2: referenced only by a trashed note.
  const f2 = await uploadPng(server.base, cookie);
  const b = await createNote(server.base, cookie, `keep ${f2}`);
  await req(server.base, cookie, 'DELETE', `/api/notes/${b.id}`);

  // F3: referenced by nothing.
  const f3 = await uploadPng(server.base, cookie);

  // Trigger a prune by purging an unrelated note.
  const c = await createNote(server.base, cookie, 'sacrificial');
  await req(server.base, cookie, 'DELETE', `/api/notes/${c.id}`);
  const purged = await req(server.base, cookie, 'POST', `/api/notes/${c.id}/purge`);
  assert.equal(purged.status, 200);

  const exists = async (url) => {
    try {
      await fsp.stat(path.join(server.dataDir, 'uploads', url.slice('/uploads/'.length)));
      return true;
    } catch {
      return false;
    }
  };
  assert.equal(await exists(f1), true, 'history-referenced upload must survive');
  assert.equal(await exists(f2), true, 'trash-referenced upload must survive');
  assert.equal(await exists(f3), false, 'orphan upload must be pruned');
});

test('a missing history file lists as empty, never a 500', async () => {
  const note = await createNote(server.base, cookie, 'no-history-yet');
  const list = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
  assert.equal(list.status, 200);
  assert.deepEqual(list.data.revisions, []);
});
