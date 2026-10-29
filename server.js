#!/usr/bin/env node
/**
 * Personal Notes — a tiny self-hosted, multi-account note-taking app.
 *
 * Zero npm dependencies: Node.js standard library only (Node >= 18).
 * Storage is a single JSON file (data/notes.json) written atomically.
 *
 * Accounts:
 *   - The first account created on a fresh install becomes the admin.
 *   - The admin can manage users and open/close registration.
 *   - Notes are scoped per account; sessions are per-account tokens.
 *   - Legacy single-password data is migrated to an "admin" account on load.
 *
 * Environment variables:
 *   PORT        listen port                     (default 3000)
 *   HOST        listen address                  (default 0.0.0.0)
 *   DATA_DIR    data directory                  (default ./data)
 *   TRUST_PROXY set to 1 when behind nginx/Caddy so X-Forwarded-For is honored
 */
'use strict';

const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

/* ------------------------------------------------------------------ config */

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'notes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

const SESSION_COOKIE = 'notes_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BODY_LIMIT = 2 * 1024 * 1024;             // 2 MB
const UPLOAD_LIMIT = 25 * 1024 * 1024;          // 25 MB per uploaded file
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const UPLOAD_EXT_RE = 'png|jpe?g|gif|webp|pdf|docx?|pptx?|xlsx?|txt|csv|zip|odt|odp|ods';
const UPLOAD_NAME_RE = new RegExp(`^[a-f0-9]{32}\\.(${UPLOAD_EXT_RE})$`);
const SHARE_TOKEN_RE = /^[a-f0-9]{32}$/;
const MAX_NOTES_PER_USER = 5000;
const MAX_FOLDERS_PER_USER = 100;
const MAX_USERS = 100;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MS = 15 * 60 * 1000;
const REGISTER_MAX_PER_HOUR = 5;

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: https: http:; connect-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* -------------------------------------------------------------------- data */

let db = { users: [], sessions: {}, settings: { registrationOpen: true }, notes: [], folders: [], uploads: {} };

function log(...args) {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

const isUserShape = (u) =>
  u && typeof u === 'object' &&
  typeof u.id === 'string' && typeof u.name === 'string' &&
  typeof u.salt === 'string' && typeof u.hash === 'string';

const isNoteShape = (n) => n && typeof n === 'object' && typeof n.id === 'string';
const isFolderShape = (f) =>
  f && typeof f === 'object' && typeof f.id === 'string' && typeof f.userId === 'string' && typeof f.name === 'string';

async function loadDb() {
  try {
    const parsed = JSON.parse(await fsp.readFile(DB_FILE, 'utf8'));
    const users = Array.isArray(parsed.users) ? parsed.users.filter(isUserShape) : [];
    const notes = Array.isArray(parsed.notes) ? parsed.notes.filter(isNoteShape) : [];

    // Migrate the legacy single-password format: the old password becomes an
    // account named "admin" that owns all existing notes. Old sessions are
    // dropped (they carried no account).
    if (!users.length && parsed.auth && parsed.auth.salt && parsed.auth.hash) {
      users.push({
        id: crypto.randomUUID(),
        name: 'admin',
        nameKey: 'admin',
        salt: parsed.auth.salt,
        hash: parsed.auth.hash,
        isAdmin: true,
        createdAt: Date.now(),
      });
      for (const n of notes) n.userId = users[0].id;
      log('Migrated legacy single-account data to the user "admin".');
    }

    db = {
      users,
      sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
      settings: { registrationOpen: !(parsed.settings && parsed.settings.registrationOpen === false) },
      notes,
      folders: Array.isArray(parsed.folders) ? parsed.folders.filter(isFolderShape) : [],
      uploads: parsed.uploads && typeof parsed.uploads === 'object' ? parsed.uploads : {},
    };

    // Keep only well-formed, unexpired sessions that point at a real account.
    const now = Date.now();
    for (const [token, s] of Object.entries(db.sessions)) {
      if (!s || typeof s !== 'object' || typeof s.uid !== 'string' ||
          typeof s.exp !== 'number' || s.exp < now ||
          !db.users.some((u) => u.id === s.uid)) {
        delete db.sessions[token];
      }
    }

    // Notes must belong to a known account; folder references must point at
    // one of the account's own folders.
    db.notes = db.notes.filter((n) =>
      typeof n.userId === 'string' && db.users.some((u) => u.id === n.userId));
    db.folders = db.folders.filter((f) => db.users.some((u) => u.id === f.userId));
    for (const n of db.notes) {
      if (n.folderId != null && !db.folders.some((f) => f.id === n.folderId && f.userId === n.userId)) {
        n.folderId = null;
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Warning: could not parse ${DB_FILE} (${err.message}); starting with an empty store.`);
  }
}

// Coalesce rapid writes into a single atomic write (tmp file + rename).
let saveQueued = false;
let saveRunning = false;
function saveDb() {
  saveQueued = true;
  if (saveRunning) return;
  saveRunning = true;
  (async () => {
    try {
      while (saveQueued) {
        saveQueued = false;
        await fsp.mkdir(DATA_DIR, { recursive: true });
        const tmp = DB_FILE + '.tmp';
        await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
        await fsp.rename(tmp, DB_FILE);
      }
    } catch (err) {
      console.error('Failed to save data file:', err.message);
    }
    saveRunning = false;
  })();
}

/* ------------------------------------------------------------------ accounts */

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64);
  const real = Buffer.from(hash, 'hex');
  return test.length === real.length && crypto.timingSafeEqual(test, real);
}

function findUserByName(name) {
  const key = String(name || '').trim().toLowerCase();
  return db.users.find((u) => (u.nameKey || u.name.toLowerCase()) === key) || null;
}

function removeUser(user) {
  db.users = db.users.filter((u) => u.id !== user.id);
  db.notes = db.notes.filter((n) => n.userId !== user.id);
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.uid === user.id) delete db.sessions[t];
  }
  pruneOrphanUploads();
}

/* ------------------------------------------------------------------ uploads */

const IMAGE_EXTS = ['png', 'jpg', 'gif', 'webp'];
const ZIP_DOC_EXTS = ['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods'];
const OLE_DOC_EXTS = ['doc', 'ppt', 'xls'];
const TEXT_DOC_EXTS = ['txt', 'csv', 'md'];

// Identify a file by magic bytes — never trust the client's file name or
// content type. Returns the canonical extension, or null if unsupported.
function sniffFile(buf, providedExt) {
  if (buf.length < 4) return null;
  const sig = buf.slice(0, 12).toString('latin1');
  if (sig.startsWith('\x89PNG\r\n\x1a\n')) return 'png';
  if (sig.startsWith('\xFF\xD8\xFF')) return 'jpg';
  if (sig.startsWith('GIF87a') || sig.startsWith('GIF89a')) return 'gif';
  if (sig.startsWith('RIFF') && sig.slice(8, 12) === 'WEBP') return 'webp';
  if (sig.startsWith('%PDF-')) return 'pdf';
  // ZIP container: Office Open XML / OpenDocument (trust a plausible name) or plain zip.
  if (sig.startsWith('PK\x03\x04')) {
    return ZIP_DOC_EXTS.includes(providedExt) ? providedExt : 'zip';
  }
  // OLE2 container: legacy Word/PowerPoint/Excel.
  if (buf.length >= 8 && sig.startsWith('\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1')) {
    return OLE_DOC_EXTS.includes(providedExt) ? providedExt : 'doc';
  }
  // Plain text (UTF-8 without NUL or other control bytes).
  if (!buf.includes(0) && !/[\x01-\x08\x0e-\x1f]/.test(buf.toString('latin1'))) {
    return TEXT_DOC_EXTS.includes(providedExt) ? providedExt : 'txt';
  }
  return null;
}

// Recover the original file name from the X-File-Name header. Header values
// may only carry ISO-8859-1, so clients percent-encode the name before
// sending it (encodeURIComponent / URLEncoder). Older Android builds sent raw
// UTF-8 bytes, which Node decodes as latin-1 mojibake — repair that case too.
// decodeURIComponent throws on malformed escapes, so fall back to the raw value.
function decodeUploadName(raw) {
  let name = raw;
  if (name.includes('%')) {
    try {
      name = decodeURIComponent(name);
    } catch {
      // not percent-encoded (or cut short in transit) — keep the raw value
    }
  }
  if (/^[\x00-\xff]*$/.test(name) && /[\x80-\xff]/.test(name)) {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (!fixed.includes('\uFFFD')) name = fixed;
  }
  return name;
}

// Delete upload files that no note references any more. Called after a note
// or an account is deleted.
async function pruneOrphanUploads() {
  try {
    const files = await fsp.readdir(UPLOAD_DIR).catch(() => []);
    if (!files.length) return;
    const refs = new Set();
    const re = new RegExp(`/uploads/([a-f0-9]{32}\\.(?:${UPLOAD_EXT_RE}))`, 'g');
    for (const note of db.notes) {
      let m;
      while ((m = re.exec(note.content))) refs.add(m[1]);
    }
    for (const f of files) {
      if (UPLOAD_NAME_RE.test(f) && !refs.has(f)) {
        await fsp.unlink(path.join(UPLOAD_DIR, f)).catch(() => {});
        delete db.uploads[f];
      }
    }
  } catch (err) {
    console.error('Upload prune failed:', err.message);
  }
}

const adminCount = () => db.users.filter((u) => u.isAdmin === true).length;

const publicUser = (u) => ({ id: u.id, name: u.name, isAdmin: u.isAdmin === true, createdAt: u.createdAt });

/* ------------------------------------------------------------------ sessions */

function clientIp(req) {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > -1) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function isSecure(req) {
  if (req.socket && req.socket.encrypted) return true;
  const proto = req.headers['x-forwarded-proto'];
  return typeof proto === 'string' && proto.split(',')[0].trim() === 'https';
}

function createSession(req, uid) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[token] = { uid, exp: Date.now() + SESSION_TTL_MS };
  return token;
}

function sessionCookie(req, token, maxAgeSec) {
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (isSecure(req)) parts.push('Secure');
  return parts.join('; ');
}

function clearSessionCookie(req) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (isSecure(req)) parts.push('Secure');
  return parts.join('; ');
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE] || null;
  if (!token) return { token: null, user: null };
  const s = db.sessions[token];
  if (!s || s.exp < Date.now()) return { token: null, user: null };
  const user = db.users.find((u) => u.id === s.uid) || null;
  if (!user) return { token: null, user: null };
  return { token, user };
}

/* Brute-force protection, shared by login and register. */
const loginFailures = new Map();

function checkLock(ip) {
  const f = loginFailures.get(ip);
  return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}

function recordFailure(ip) {
  const f = loginFailures.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= LOGIN_MAX_FAILURES) {
    f.until = Date.now() + LOGIN_LOCK_MS;
    f.count = 0;
  }
  loginFailures.set(ip, f);
}

/* Registration throttle: N sign-ups per IP per hour. */
const registerAttempts = new Map();

function registerAllowed(ip) {
  const now = Date.now();
  const arr = (registerAttempts.get(ip) || []).filter((t) => now - t < 60 * 60 * 1000);
  registerAttempts.set(ip, arr);
  if (arr.length >= REGISTER_MAX_PER_HOUR) return false;
  arr.push(now);
  return true;
}

/* -------------------------------------------------------------- validation */

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function sanitizeTags(v) {
  if (!Array.isArray(v)) return [];
  const out = [];
  for (const t of v.slice(0, 50)) {
    if (typeof t !== 'string') continue;
    const s = t.trim().slice(0, 32);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function sanitizeNote(body) {
  return {
    title: str(body.title, 500).trim(),
    content: str(body.content, 1024 * 1024),
    tags: sanitizeTags(body.tags),
    pinned: body.pinned === true,
  };
}

// Map a client-supplied folderId to a folder of this account, or null.
function resolveFolderId(value, user) {
  if (typeof value !== 'string' || !value) return null;
  return db.folders.some((f) => f.id === value && f.userId === user.id) ? value : null;
}

/* ------------------------------------------------------------------ plumbing */

function sendJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, 'Request body too large'));
      req.resume();
      return;
    }
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = (await readBody(req)).toString('utf8');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

/* --------------------------------------------------------------------- api */

async function handleApi(req, res, pathname) {
  const method = req.method;

  if (pathname === '/api/session' && method === 'GET') {
    const { user } = getSession(req);
    return sendJson(res, 200, {
      needsSetup: db.users.length === 0,
      authenticated: !!user,
      user: user ? publicUser(user) : null,
      registrationOpen: db.settings.registrationOpen,
    });
  }

  // Public, read-only view of a shared note. The 128-bit token in the link
  // is the only credential — no session required.
  const shm = pathname.match(/^\/api\/share\/([a-f0-9]{32})$/);
  if (shm && method === 'GET') {
    const note = db.notes.find((n) => n.share && n.share.token === shm[1]);
    if (!note) return sendJson(res, 404, { error: 'This link is no longer valid' });
    return sendJson(res, 200, { title: note.title, content: note.content, updatedAt: note.updatedAt });
  }

  if (pathname === '/api/register' && method === 'POST') {
    const ip = clientIp(req);
    const locked = checkLock(ip);
    if (locked) return sendJson(res, 429, { error: `Too many attempts. Try again in ${locked} minute(s).` });
    if (!registerAllowed(ip)) return sendJson(res, 429, { error: 'Too many registrations from this address. Try again later.' });

    const firstAccount = db.users.length === 0;
    if (!firstAccount && !db.settings.registrationOpen) {
      return sendJson(res, 403, { error: 'Registration is disabled on this server' });
    }
    if (db.users.length >= MAX_USERS) return sendJson(res, 400, { error: 'User limit reached' });

    const body = await readJson(req);
    const username = str(body.username, 64).trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!USERNAME_RE.test(username)) {
      recordFailure(ip);
      return sendJson(res, 400, { error: 'Username must be 3–32 characters (letters, digits, . _ -)' });
    }
    if (password.length < 8 || password.length > 1024) {
      recordFailure(ip);
      return sendJson(res, 400, { error: 'Password must be 8–1024 characters' });
    }
    if (findUserByName(username)) return sendJson(res, 409, { error: 'That username is taken' });

    const { salt, hash } = hashPassword(password);
    const user = {
      id: crypto.randomUUID(),
      name: username,
      nameKey: username.toLowerCase(),
      salt,
      hash,
      isAdmin: firstAccount,
      createdAt: Date.now(),
    };
    db.users.push(user);
    const token = createSession(req, user.id);
    saveDb();
    log(`Account "${username}" registered from ${ip}${firstAccount ? ' (admin)' : ''}`);
    return sendJson(res, 201, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_TTL_MS / 1000) });
  }

  if (pathname === '/api/login' && method === 'POST') {
    const ip = clientIp(req);
    const locked = checkLock(ip);
    if (locked) return sendJson(res, 429, { error: `Too many attempts. Try again in ${locked} minute(s).` });
    const body = await readJson(req);
    const username = str(body.username, 64).trim();
    const password = typeof body.password === 'string' ? body.password : '';
    const user = findUserByName(username);
    if (!user || !verifyPassword(password, user.salt, user.hash)) {
      recordFailure(ip);
      log(`Failed login for "${username}" from ${ip}`);
      return sendJson(res, 401, { error: 'Wrong username or password' });
    }
    loginFailures.delete(ip);
    const token = createSession(req, user.id);
    saveDb();
    log(`Login "${user.name}" from ${ip}`);
    return sendJson(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_TTL_MS / 1000) });
  }

  const { token, user } = getSession(req);

  if (pathname === '/api/logout' && method === 'POST') {
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      saveDb();
    }
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  // Everything below requires a valid session.
  if (!user) return sendJson(res, 401, { error: 'Not authenticated' });

  if (pathname === '/api/logout-all' && method === 'POST') {
    for (const [t, s] of Object.entries(db.sessions)) {
      if (s.uid === user.id) delete db.sessions[t];
    }
    saveDb();
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  if (pathname === '/api/password' && method === 'POST') {
    const body = await readJson(req);
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.next === 'string' ? body.next : '';
    if (!verifyPassword(current, user.salt, user.hash)) {
      return sendJson(res, 403, { error: 'Current password is wrong' });
    }
    if (next.length < 8 || next.length > 1024) {
      return sendJson(res, 400, { error: 'New password must be 8–1024 characters' });
    }
    const { salt, hash } = hashPassword(next);
    user.salt = salt;
    user.hash = hash;
    // Keep only the current session; every other device is signed out.
    for (const [t, s] of Object.entries(db.sessions)) {
      if (s.uid === user.id && t !== token) delete db.sessions[t];
    }
    saveDb();
    log(`Password changed for "${user.name}"`);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/account' && method === 'DELETE') {
    const body = await readJson(req);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!verifyPassword(password, user.salt, user.hash)) {
      return sendJson(res, 403, { error: 'Password is wrong' });
    }
    if (user.isAdmin === true && adminCount() <= 1) {
      return sendJson(res, 400, { error: 'You are the only admin. Promote another user to admin first.' });
    }
    removeUser(user);
    saveDb();
    log(`Account "${user.name}" deleted itself`);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(req) });
  }

  /* ------------------------------------------------------------ uploads */

  if (pathname === '/api/uploads' && method === 'POST') {
    const buf = await readBody(req, UPLOAD_LIMIT);
    if (!buf.length) return sendJson(res, 400, { error: 'Empty upload' });
    // Decode first, then sanitize/truncate: slicing a percent-encoded name
    // first could cut an escape sequence in half and garble the name.
    const original = str(decodeUploadName(String(req.headers['x-file-name'] || '')), 160)
      .replace(/[\r\n"\\/]+/g, ' ').trim();
    const ext = sniffFile(buf, (original.match(/\.([a-z0-9]+)$/i) || [])[1] || '');
    if (!ext) {
      return sendJson(res, 400, { error: 'Unsupported file type (images, PDF, Office documents or plain text only)' });
    }
    const name = crypto.randomBytes(16).toString('hex') + '.' + ext;
    await fsp.mkdir(UPLOAD_DIR, { recursive: true });
    await fsp.writeFile(path.join(UPLOAD_DIR, name), buf);
    db.uploads[name] = { original: original || `file.${ext}`, size: buf.length, by: user.id, at: Date.now() };
    saveDb();
    log(`Upload ${name} (${buf.length} bytes) by "${user.name}"`);
    return sendJson(res, 201, { url: `/uploads/${name}` });
  }

  /* ------------------------------------------------------------ folders */

  if (pathname === '/api/folders' && method === 'GET') {
    // Stored array order (see /api/folders/reorder); pinned-first is a
    // client-side display concern.
    const folders = db.folders
      .filter((f) => f.userId === user.id)
      .map((f) => ({ ...f, noteCount: db.notes.filter((n) => n.userId === user.id && n.folderId === f.id).length }));
    return sendJson(res, 200, { folders });
  }

  if (pathname === '/api/folders' && method === 'POST') {
    if (db.folders.filter((f) => f.userId === user.id).length >= MAX_FOLDERS_PER_USER) {
      return sendJson(res, 400, { error: 'Folder limit reached' });
    }
    const body = await readJson(req);
    const name = str(body.name, 128).trim().slice(0, 64);
    if (!name) return sendJson(res, 400, { error: 'Folder name is required' });
    const dup = db.folders.some((f) => f.userId === user.id && f.name.toLowerCase() === name.toLowerCase());
    if (dup) return sendJson(res, 409, { error: 'A folder with that name already exists' });
    const folder = { id: crypto.randomUUID(), userId: user.id, name, createdAt: Date.now() };
    db.folders.push(folder);
    saveDb();
    return sendJson(res, 201, { folder: { ...folder, noteCount: 0 } });
  }

  // Reorder folders: body { ids: [...] } must be a permutation of this
  // account's folder ids; the array order becomes the stored order.
  if (pathname === '/api/folders/reorder' && method === 'POST') {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : null;
    const mine = db.folders.filter((f) => f.userId === user.id);
    if (!ids || ids.length !== mine.length || new Set(ids).size !== ids.length ||
        !mine.every((f) => ids.includes(f.id))) {
      return sendJson(res, 400, { error: 'ids must be a permutation of your folders' });
    }
    const reordered = ids.map((id) => db.folders.find((f) => f.id === id));
    const others = db.folders.filter((f) => f.userId !== user.id);
    db.folders = [...reordered, ...others];
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  // Pin / unpin a folder. Pinned folders are listed first by the clients.
  const pm = pathname.match(/^\/api\/folders\/([^/]+)\/pin$/);
  if (pm && method === 'POST') {
    const folder = db.folders.find((f) => f.id === pm[1] && f.userId === user.id);
    if (!folder) return sendJson(res, 404, { error: 'Folder not found' });
    const body = await readJson(req);
    folder.pinned = body.pinned === true;
    saveDb();
    return sendJson(res, 200, { folder });
  }

  const fm = pathname.match(/^\/api\/folders\/([^/]+)$/);
  if (fm) {
    const folder = db.folders.find((f) => f.id === fm[1] && f.userId === user.id);
    if (!folder) return sendJson(res, 404, { error: 'Folder not found' });
    if (method === 'PUT') {
      const body = await readJson(req);
      const name = str(body.name, 128).trim().slice(0, 64);
      if (!name) return sendJson(res, 400, { error: 'Folder name is required' });
      const dup = db.folders.some((f) => f.userId === user.id && f.id !== folder.id && f.name.toLowerCase() === name.toLowerCase());
      if (dup) return sendJson(res, 409, { error: 'A folder with that name already exists' });
      folder.name = name;
      saveDb();
      return sendJson(res, 200, { folder });
    }
    if (method === 'DELETE') {
      db.folders = db.folders.filter((f) => f.id !== folder.id);
      for (const n of db.notes) {
        if (n.userId === user.id && n.folderId === folder.id) n.folderId = null;
      }
      saveDb();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ------------------------------------------------------------ notes (per user) */

  if (pathname === '/api/notes' && method === 'GET') {
    const notes = db.notes
      .filter((n) => n.userId === user.id)
      .sort((a, b) => (b.pinned === true) - (a.pinned === true) || b.updatedAt - a.updatedAt);
    return sendJson(res, 200, { notes });
  }

  if (pathname === '/api/notes' && method === 'POST') {
    if (db.notes.filter((n) => n.userId === user.id).length >= MAX_NOTES_PER_USER) {
      return sendJson(res, 400, { error: 'Note limit reached' });
    }
    const body = await readJson(req);
    const clean = sanitizeNote(body);
    const now = Date.now();
    const note = { id: crypto.randomUUID(), userId: user.id, folderId: resolveFolderId(body.folderId, user), ...clean, createdAt: now, updatedAt: now };
    db.notes.push(note);
    saveDb();
    return sendJson(res, 201, { note });
  }

  const m = pathname.match(/^\/api\/notes\/([^/]+)$/);
  if (m) {
    const note = db.notes.find((n) => n.id === m[1] && n.userId === user.id);
    if (!note) return sendJson(res, 404, { error: 'Note not found' });
    if (method === 'PUT') {
      const body = await readJson(req);
      Object.assign(note, sanitizeNote(body), { updatedAt: Date.now() });
      // Only touch the folder when the client sends the field at all —
      // older clients (Android app) that don't know about folders must not
      // accidentally unfile notes.
      if ('folderId' in body) note.folderId = resolveFolderId(body.folderId, user);
      saveDb();
      return sendJson(res, 200, { note });
    }
    if (method === 'DELETE') {
      db.notes = db.notes.filter((n) => n.id !== m[1]);
      saveDb();
      pruneOrphanUploads();
      return sendJson(res, 200, { ok: true });
    }
  }

  // Sharing: create/rotate or revoke the public link.
  const sm = pathname.match(/^\/api\/notes\/([^/]+)\/share$/);
  if (sm && (method === 'POST' || method === 'DELETE')) {
    const note = db.notes.find((n) => n.id === sm[1] && n.userId === user.id);
    if (!note) return sendJson(res, 404, { error: 'Note not found' });
    if (method === 'POST') {
      note.share = { token: crypto.randomBytes(16).toString('hex'), createdAt: Date.now() };
      saveDb();
      log(`Share link created for note ${note.id} by "${user.name}"`);
      return sendJson(res, 200, { share: note.share, url: `/share/${note.share.token}` });
    }
    note.share = null;
    saveDb();
    log(`Share link revoked for note ${note.id} by "${user.name}"`);
    return sendJson(res, 200, { ok: true });
  }

  /* ------------------------------------------------------------ admin */

  if (pathname === '/api/users' && method === 'GET') {
    if (user.isAdmin !== true) return sendJson(res, 403, { error: 'Admin only' });
    const users = db.users.map((u) => ({
      ...publicUser(u),
      noteCount: db.notes.filter((n) => n.userId === u.id).length,
    }));
    return sendJson(res, 200, { users, registrationOpen: db.settings.registrationOpen });
  }

  const um = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (um && method === 'DELETE') {
    if (user.isAdmin !== true) return sendJson(res, 403, { error: 'Admin only' });
    const target = db.users.find((u) => u.id === um[1]);
    if (!target) return sendJson(res, 404, { error: 'User not found' });
    if (target.id === user.id) return sendJson(res, 400, { error: 'Use account deletion to remove your own account' });
    if (target.isAdmin === true && adminCount() <= 1) {
      return sendJson(res, 400, { error: 'Cannot delete the last admin' });
    }
    const name = target.name;
    removeUser(target);
    saveDb();
    log(`Admin "${user.name}" deleted user "${name}"`);
    return sendJson(res, 200, { ok: true });
  }

  const am = pathname.match(/^\/api\/users\/([^/]+)\/admin$/);
  if (am && method === 'POST') {
    if (user.isAdmin !== true) return sendJson(res, 403, { error: 'Admin only' });
    const target = db.users.find((u) => u.id === am[1]);
    if (!target) return sendJson(res, 404, { error: 'User not found' });
    const body = await readJson(req);
    const makeAdmin = body.admin === true;
    if (!makeAdmin && target.isAdmin === true && adminCount() <= 1) {
      return sendJson(res, 400, { error: 'Cannot remove the last admin' });
    }
    target.isAdmin = makeAdmin;
    saveDb();
    log(`Admin "${user.name}" ${makeAdmin ? 'promoted' : 'demoted'} "${target.name}"`);
    return sendJson(res, 200, { user: publicUser(target) });
  }

  if (pathname === '/api/settings/registration' && method === 'POST') {
    if (user.isAdmin !== true) return sendJson(res, 403, { error: 'Admin only' });
    const body = await readJson(req);
    db.settings.registrationOpen = body.open === true;
    saveDb();
    log(`Registration ${db.settings.registrationOpen ? 'opened' : 'closed'} by "${user.name}"`);
    return sendJson(res, 200, { registrationOpen: db.settings.registrationOpen });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* ------------------------------------------------------------------ static */

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
    return;
  }
  let data;
  try {
    data = await fsp.readFile(filePath);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
    return;
  }
  const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(data);
}

/* ------------------------------------------------------------------ uploads */

const UPLOAD_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.zip': 'application/zip',
  '.odt': 'application/vnd.oasis.opendocument.text', '.odp': 'application/vnd.oasis.opendocument.presentation', '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
};

// Serve uploaded files. Two ways in:
//   1. a signed-in session (any file of any note — the UI only links files
//      into the viewer's own notes),
//   2. a valid share token via ?s=<token>, limited to files that the shared
//      note actually references — so a share link exposes its own
//      attachments and images, nothing else.
async function serveUpload(req, res, pathname) {
  const { user } = getSession(req);
  let allowed = !!user;
  if (!allowed) {
    const q = new URL(req.url, `http://${req.headers.host || 'localhost'}`).searchParams.get('s');
    if (q && SHARE_TOKEN_RE.test(q)) {
      const note = db.notes.find((n) => n.share && n.share.token === q);
      const name = pathname.slice('/uploads/'.length);
      if (note && note.content.includes(name)) allowed = true;
    }
  }
  if (!allowed) {
    res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not authenticated');
    return;
  }
  const name = pathname.slice('/uploads/'.length);
  if (!UPLOAD_NAME_RE.test(name)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
    return;
  }
  let data;
  try {
    data = await fsp.readFile(path.join(UPLOAD_DIR, name));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end('Not found');
    return;
  }
  // Names are random and never reused, so caching is safe. Documents open
  // inline where the browser can render them (PDF); downloads get their
  // original name from the link's download attribute.
  res.writeHead(200, {
    'Content-Type': UPLOAD_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': data.length,
    ...SECURITY_HEADERS,
  });
  res.end(data);
}

/* -------------------------------------------------------------------- main */

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
  if (pathname.startsWith('/uploads/')) return serveUpload(req, res, pathname);
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  // /share/<token> is a client-side route — serve the app shell.
  if (pathname.startsWith('/share/')) return serveStatic(res, '/');
  return serveStatic(res, pathname);
}

loadDb().then(() => {
  http
    .createServer((req, res) => {
      route(req, res).catch((err) => {
        const status = err instanceof HttpError ? err.status : 500;
        if (status >= 500) console.error(err);
        if (!res.headersSent) sendJson(res, status, { error: err.message || 'Server error' });
        else res.end();
      });
    })
    .listen(PORT, HOST, () => {
      log(`Notes server listening on http://${HOST}:${PORT}`);
      log(`Data file: ${DB_FILE}`);
      if (db.users.length === 0) log('No accounts yet — open the site in a browser to create the admin account.');
    });
});

process.on('SIGINT', () => {
  log('Shutting down.');
  process.exit(0);
});
