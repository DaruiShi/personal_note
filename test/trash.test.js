'use strict';
/* Trash: soft delete, listing, share refusal while trashed, restore, purge,
 * empty trash, idempotent delete. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { startServer, register, req, uploadPng, createNote } = require('./helpers');

let server, cookie;

test.before(async () => {
  server = await startServer();
  cookie = await register(server.base, 'trashy');
});

test.after(async () => {
  await server.stop();
});

test('DELETE hides the note from /api/notes and lists it in /api/trash', async () => {
  const note = await createNote(server.base, cookie, 'to-trash');
  const del = await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
  assert.equal(del.status, 200);
  assert.equal(typeof del.data.deletedAt, 'number');

  const live = await req(server.base, cookie, 'GET', '/api/notes');
  assert.equal(live.data.notes.some((n) => n.id === note.id), false);

  const trash = await req(server.base, cookie, 'GET', '/api/trash');
  const found = trash.data.notes.find((n) => n.id === note.id);
  assert.ok(found, 'trashed note must appear in /api/trash');
  assert.equal(found.deletedAt != null, true);
  assert.equal(found.rev >= 2, true, 'trash bumps rev');
  assert.equal(trash.data.total, trash.data.notes.length);
});

test('deleting twice is idempotent', async () => {
  const note = await createNote(server.base, cookie, 'twice');
  const first = await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
  const second = await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.data.deletedAt, first.data.deletedAt);
});

test('a trashed note loses its share link and upload access', async () => {
  const url = await uploadPng(server.base, cookie);
  const note = await createNote(server.base, cookie, `see ${url}`);
  const share = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/share`);
  const token = share.data.share.token;

  const before = await req(server.base, cookie, 'GET', `/api/share/${token}`);
  assert.equal(before.status, 200);
  const upBefore = await fetch(`${server.base}${url}?s=${token}`);
  assert.equal(upBefore.status, 200);

  await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);

  const after = await req(server.base, cookie, 'GET', `/api/share/${token}`);
  assert.equal(after.status, 404);
  const upAfter = await fetch(`${server.base}${url}?s=${token}`);
  assert.equal(upAfter.status, 401);
});

test('restore brings the note back with rev incremented', async () => {
  const note = await createNote(server.base, cookie, 'restore-me');
  await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
  const r = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/restore`);
  assert.equal(r.status, 200);
  assert.equal(r.data.note.deletedAt, null);
  assert.equal(r.data.note.rev, note.rev + 2, 'trash +1, restore +1');

  const live = await req(server.base, cookie, 'GET', '/api/notes');
  assert.equal(live.data.notes.some((n) => n.id === note.id), true);
  const trash = await req(server.base, cookie, 'GET', '/api/trash');
  assert.equal(trash.data.notes.some((n) => n.id === note.id), false);

  // idempotent: restoring a live note returns it unchanged
  const again = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/restore`);
  assert.equal(again.status, 200);
  assert.equal(again.data.note.rev, r.data.note.rev);
});

test('purge removes the note from db and deletes its history file', async () => {
  const note = await createNote(server.base, cookie, 'purge-me');
  await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'v2', tags: [], pinned: false, rev: note.rev,
  });
  const histFile = path.join(server.dataDir, 'history', `${note.id}.jsonl`);
  const beforeTrash = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
  assert.ok(beforeTrash.data.revisions.length >= 1);
  assert.equal((await fsp.stat(histFile)).isFile(), true);

  await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
  const r = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/purge`);
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);

  const trash = await req(server.base, cookie, 'GET', '/api/trash');
  assert.equal(trash.data.notes.some((n) => n.id === note.id), false);
  await assert.rejects(() => fsp.stat(histFile));
});

test('empty trash purges every trashed note', async () => {
  const a = await createNote(server.base, cookie, 'a');
  const b = await createNote(server.base, cookie, 'b');
  await req(server.base, cookie, 'DELETE', `/api/notes/${a.id}`);
  await req(server.base, cookie, 'DELETE', `/api/notes/${b.id}`);

  const r = await req(server.base, cookie, 'POST', '/api/trash/empty');
  assert.equal(r.status, 200);
  assert.equal(r.data.purged >= 2, true);

  const trash = await req(server.base, cookie, 'GET', '/api/trash');
  assert.equal(trash.data.total, 0);
  const histDir = path.join(server.dataDir, 'history');
  const files = await fsp.readdir(histDir).catch(() => []);
  assert.equal(files.includes(`${a.id}.jsonl`), false);
  assert.equal(files.includes(`${b.id}.jsonl`), false);
});
