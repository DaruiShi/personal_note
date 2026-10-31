'use strict';
/* Compatibility: the shipped Android APK (v1.16) must keep working —
 * GET /api/notes keeps its {notes: [...]} shape with the original fields,
 * PUT still accepts a body with no rev, and /api/session advertises the
 * new capabilities. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, register, req, createNote } = require('./helpers');

let server, cookie;

test.before(async () => {
  server = await startServer();
  cookie = await register(server.base, 'legacy');
});

test.after(async () => {
  await server.stop();
});

test('GET /api/notes keeps its shape and fields', async () => {
  await createNote(server.base, cookie, 'legacy body');
  const r = await req(server.base, cookie, 'GET', '/api/notes');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.notes));
  for (const n of r.data.notes) {
    for (const field of ['id', 'title', 'content', 'tags', 'pinned', 'createdAt', 'updatedAt', 'rev']) {
      assert.ok(field in n, `note.${field} missing`);
    }
  }
});

test('PUT with a legacy body (no rev, no folderId) still works', async () => {
  const note = await createNote(server.base, cookie, 'legacy');
  const r = await req(server.base, cookie, 'PUT', `/api/notes/${note.id}`, {
    title: 'T', content: 'legacy edit', tags: ['a'], pinned: true,
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.note.content, 'legacy edit');
  assert.equal(r.data.note.pinned, true);
  assert.equal(r.data.note.folderId, note.folderId, 'folder untouched when field absent');
});

test('DELETE returns ok (the legacy client ignores the new fields)', async () => {
  const note = await createNote(server.base, cookie, 'bye');
  const r = await req(server.base, cookie, 'DELETE', `/api/notes/${note.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('/api/session advertises the new features', async () => {
  const r = await req(server.base, '', 'GET', '/api/session');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.features, { trash: true, history: true, conflicts: true, qr: true, timeline: true, timelineParse: false, gallery: true, gallerySuggest: false });
  assert.equal(typeof r.data.trashRetentionDays, 'number');
});
