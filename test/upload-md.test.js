'use strict';
/* Markdown (and other text) attachments through share links: the upload
 * keeps its .md/.markdown extension, the owner can always fetch it, and an
 * anonymous visitor can fetch it only with the share token of a note that
 * references it. Also guards the prune: a referenced .md file must survive
 * a server restart (pruneOrphanUploads runs at boot). */

const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer, register, req } = require('./helpers');

async function uploadMd(base, cookie, fileName, body) {
  const res = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'text/markdown', 'X-File-Name': encodeURIComponent(fileName) },
    body,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('markdown upload keeps its .md extension and serves to the owner', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'mdup1');
    const body = '# Notes\n\nSome **markdown** content.';
    const up = await uploadMd(server.base, cookie, 'notes.md', body);
    assert.equal(up.status, 201);
    assert.match(up.data.url, /^\/uploads\/[a-f0-9]{32}\.md$/);

    // owner: plain fetch, no token needed
    const own = await fetch(`${server.base}${up.data.url}`, { headers: { Cookie: cookie } });
    assert.equal(own.status, 200);
    assert.equal(await own.text(), body);
  } finally {
    await server.stop();
  }
});

test('share link: anonymous fetch needs the token of the referencing note', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'mdup2');
    const up = await uploadMd(server.base, cookie, 'notes.md', '# shared doc');
    const name = up.data.url.slice('/uploads/'.length);
    await req(server.base, cookie, 'POST', '/api/notes', {
      title: 'with attachment',
      content: `Read the [notes.md](${up.data.url}).`,
      tags: [], pinned: false,
    });

    // anonymous, no token -> the exact reported symptom
    const bare = await fetch(`${server.base}${up.data.url}`);
    assert.equal(bare.status, 401);

    // anonymous with the share token of the referencing note -> download
    const list = await req(server.base, cookie, 'GET', '/api/notes');
    const note = list.data.notes.find((n) => n.content.includes(name));
    const share = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/share`);
    const token = share.data.share.token;

    const good = await fetch(`${server.base}${up.data.url}?s=${token}`);
    assert.equal(good.status, 200);
    assert.equal(await good.text(), '# shared doc');

    // wrong token -> still locked
    const bad = await fetch(`${server.base}${up.data.url}?s=${'f'.repeat(32)}`);
    assert.equal(bad.status, 401);
  } finally {
    await server.stop();
  }
});

test('prune keeps a referenced .md file across a restart', async () => {
  const server = await startServer();
  const dataDir = server.dataDir;
  const cookie = await register(server.base, 'mdup3');
  const up = await uploadMd(server.base, cookie, 'notes.md', '# survive');
  await req(server.base, cookie, 'POST', '/api/notes', {
    title: 'has md', content: `[notes.md](${up.data.url})`, tags: [], pinned: false,
  });
  await server.stop();

  // a fresh boot runs pruneOrphanUploads; the referenced file must survive
  const server2 = await startServer({ dataDir });
  try {
    const again = await fetch(`${server2.base}${up.data.url}`);
    // unauthenticated: 401 proves the FILE is still there (a pruned file
    // would 404 at the name check… and 404 only comes after auth, so a
    // signed-in check is the strong one)
    assert.equal(again.status, 401);
    const login = await fetch(`${server2.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mdup3', password: 'testpassword1' }),
    });
    const c2 = login.headers.get('set-cookie').split(';')[0];
    const own = await fetch(`${server2.base}${up.data.url}`, { headers: { Cookie: c2 } });
    assert.equal(own.status, 200);
    assert.equal(await own.text(), '# survive');
  } finally {
    await server2.stop();
  }
});

test('.markdown uploads keep their full extension', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'mdup4');
    const up = await uploadMd(server.base, cookie, 'notes.markdown', '# long ext');
    assert.equal(up.status, 201);
    assert.match(up.data.url, /^\/uploads\/[a-f0-9]{32}\.markdown$/);
    const own = await fetch(`${server.base}${up.data.url}`, { headers: { Cookie: cookie } });
    assert.equal(own.status, 200);
  } finally {
    await server.stop();
  }
});
