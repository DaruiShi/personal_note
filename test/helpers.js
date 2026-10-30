'use strict';
/* Shared harness: spawn the server against a fresh temp DATA_DIR, wait for
 * it to answer /api/session, register an account, and talk to the HTTP API. */

const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

async function startServer(opts = {}) {
  const dataDir = opts.dataDir || await fsp.mkdtemp(path.join(os.tmpdir(), 'notes-test-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    // CONFIG_FILE defaults to a missing path so a developer's real
    // ./config.json (with a live API key) never leaks into tests; suites
    // that need one pass their own via opts.env.
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      CONFIG_FILE: path.join(dataDir, 'config-absent.json'),
      ...(opts.env || {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 15000;
  for (;;) {
    try {
      const res = await fetch(`${base}/api/session`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error('server did not become ready');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    child,
    base,
    dataDir,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return; // already exited
      child.kill();
      await new Promise((r) => child.on('exit', r));
    },
  };
}

async function register(base, username) {
  const res = await fetch(`${base}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'testpassword1' }),
  });
  if (res.status !== 201) throw new Error(`register failed: HTTP ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

// Cookie-authenticated JSON request; resolves to { status, data }.
async function req(base, cookie, method, p, body, headers = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Upload a minimal PNG (magic bytes only — the server sniffs, not trusts).
async function uploadPng(base, cookie) {
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('test-payload'),
  ]);
  const res = await fetch(`${base}/api/uploads`, {
    method: 'POST',
    headers: { Cookie: cookie, 'Content-Type': 'image/png', 'X-File-Name': 't.png' },
    body: png,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status !== 201) throw new Error(`upload failed: HTTP ${res.status}`);
  return data.url; // /uploads/<hash>.png
}

async function createNote(base, cookie, content = 'hello') {
  const r = await req(base, cookie, 'POST', '/api/notes', { title: 'T', content, tags: [], pinned: false });
  if (r.status !== 201) throw new Error(`createNote failed: HTTP ${r.status}`);
  return r.data.note;
}

module.exports = { startServer, register, req, uploadPng, createNote };
