'use strict';
/* Retention: the startup sweep purges notes past trashRetentionDays and
 * keeps fresher ones. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { startServer, register, req, createNote } = require('./helpers');

test('startup sweep purges only expired trash', async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const cookie = await register(server.base, 'retainer');

  const stale = await createNote(server.base, cookie, 'stale');
  const fresh = await createNote(server.base, cookie, 'fresh');
  await req(server.base, cookie, 'DELETE', `/api/notes/${stale.id}`);
  await req(server.base, cookie, 'DELETE', `/api/notes/${fresh.id}`);
  // saveDb() is queued and async — wait until both deletions are on disk
  // before killing the server, or the reboot would see stale data.
  const dbFile = path.join(server.dataDir, 'notes.json');
  let persisted = false;
  for (let i = 0; i < 50; i++) {
    const onDisk = JSON.parse(await fsp.readFile(dbFile, 'utf8'));
    const both = onDisk.notes.filter((n) => n.id === stale.id || n.id === fresh.id);
    if (both.length === 2 && both.every((n) => n.deletedAt != null)) { persisted = true; break; }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(persisted, 'both deletions must reach notes.json before the restart');
  await server.stop();

  // Backdate one note past a 1-day retention window.
  const db = JSON.parse(await fsp.readFile(dbFile, 'utf8'));
  db.settings.trashRetentionDays = 1;
  const s = db.notes.find((n) => n.id === stale.id);
  s.deletedAt = Date.now() - 3 * 86400000;
  await fsp.writeFile(dbFile, JSON.stringify(db));

  // Restart on the same data dir: loadDb + the startup sweep run again.
  const reboot = await startServer({ dataDir: server.dataDir });
  t.after(() => reboot.stop());

  // Give the fire-and-forget sweep a moment, then check.
  for (let i = 0; i < 50; i++) {
    const trash = await req(reboot.base, cookie, 'GET', '/api/trash');
    if (trash.data.notes.length === 1) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const trash = await req(reboot.base, cookie, 'GET', '/api/trash');
  assert.equal(trash.data.total, 1, 'only the fresh trashed note remains');
  assert.equal(trash.data.notes[0].id, fresh.id);

  const histFile = path.join(server.dataDir, 'history', `${stale.id}.jsonl`);
  await assert.rejects(() => fsp.stat(histFile), 'purged note loses its history file');

  const notes = await req(reboot.base, cookie, 'GET', '/api/notes');
  assert.equal(notes.data.notes.some((n) => n.id === stale.id), false);
});
