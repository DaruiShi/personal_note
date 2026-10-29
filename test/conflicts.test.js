'use strict';
/* Conflict detection: rev on create, rev-checked PUT, legacy PUT, and the
 * rejected payload landing in history. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, register, req, createNote } = require('./helpers');

let server, cookie;

test.before(async () => {
  server = await startServer();
  cookie = await register(server.base, 'conflicter');
});

test.after(async () => {
  await server.stop();
});

test('a new note starts at rev 1 with deletedAt null', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  assert.equal(note.rev, 1);
  assert.equal(note.deletedAt, null);
});

test('PUT with the current rev succeeds and bumps it', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'v2', tags: [], pinned: false, folderId: null, rev: note.rev,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.note.rev, 2);
  assert.equal(r.data.note.content, 'v2');
});

test('PUT with a stale rev returns 409 conflict and the current note', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  const ok = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'v2', tags: [], pinned: false, rev: 1,
  });
  assert.equal(ok.status, 200);
  const stale = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'loser-payload', tags: [], pinned: false, rev: 1,
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.code, 'conflict');
  assert.equal(stale.data.note.rev, 2);
  assert.equal(stale.data.note.content, 'v2');
});

test('PUT with a non-numeric rev returns 400', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'x', tags: [], pinned: false, rev: 'one',
  });
  assert.equal(r.status, 400);
});

test('PUT without rev still succeeds (legacy client)', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'legacy-write', tags: [], pinned: false,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.note.content, 'legacy-write');
  assert.equal(r.data.note.rev, 2);
});

test('the losing payload is stored in history as kind "rejected"', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'v2', tags: [], pinned: false, rev: 1,
  });
  const stale = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'my-precious-loser-text', tags: [], pinned: false, rev: 1,
  });
  assert.equal(stale.status, 409);

  const list = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history`);
  assert.equal(list.status, 200);
  const rejected = list.data.revisions.find((x) => x.kind === 'rejected');
  assert.ok(rejected, 'history must contain a rejected entry');
  assert.equal(rejected.preview, 'my-precious-loser-text');

  const full = await req(server.base, cookie, 'GET', `/api/notes/${note.id}/history/${rejected.rev}`);
  assert.equal(full.status, 200);
  assert.equal(full.data.revision.kind, 'rejected');
  assert.equal(full.data.revision.content, 'my-precious-loser-text');
});

test('PUT against a trashed note returns 409 trashed', async () => {
  const note = await createNote(server.base, cookie, 'v1');
  await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
  const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'x', tags: [], pinned: false, rev: 1,
  });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'trashed');
  assert.equal(r.data.note.deletedAt != null, true);
});
