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

// QR encoder (vendored, MIT — see lib/qr.js). A missing or broken module
// disables the QR feature (features.qr: false, 404 on the endpoint) instead
// of taking the server down.
let qr = null;
try {
  qr = require('./lib/qr');
} catch (err) {
  console.warn(`Warning: QR encoder unavailable (${err.message}); share-link QR codes stay disabled.`);
}

/* ------------------------------------------------------------------ config */

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'notes.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// Public origin for absolute share URLs (og:url, og:image, QR codes).
// Optional: when unset, derived per request from X-Forwarded-Proto / Host —
// the Host header is only trusted after strict validation (see requestOrigin).
let publicBaseUrl = null;
{
  const raw = (process.env.PUBLIC_BASE_URL || '').trim();
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'http:' || u.protocol === 'https:') publicBaseUrl = u.origin;
      else console.warn(`Warning: PUBLIC_BASE_URL must be an http(s) URL; ignoring "${raw}".`);
    } catch {
      console.warn(`Warning: PUBLIC_BASE_URL is not a valid URL; ignoring "${raw}".`);
    }
  } else {
    console.warn('Warning: PUBLIC_BASE_URL is not set — absolute links will follow the request Host header.');
  }
}

const HOST_RE = /^[A-Za-z0-9.\-]+(:\d{1,5})?$/; // at most 253 chars enforced at use

const SESSION_COOKIE = 'notes_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BODY_LIMIT = 2 * 1024 * 1024;             // 2 MB
const UPLOAD_LIMIT = 25 * 1024 * 1024;          // 25 MB per uploaded file
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const UPLOAD_EXT_RE = 'png|jpe?g|gif|webp|pdf|docx?|pptx?|xlsx?|txt|csv|zip|odt|odp|ods';
const UPLOAD_NAME_RE = new RegExp(`^[a-f0-9]{32}\\.(${UPLOAD_EXT_RE})$`);
const SHARE_TOKEN_RE = /^[a-f0-9]{32}$/;
const MAX_NOTES_PER_USER = 5000;
const MAX_TRASH_PER_USER = 500;
const MAX_HISTORY_PER_NOTE = 50;
const HISTORY_FLOOR_MS = 60 * 1000;               // min spacing between "edit" entries
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

let db = { users: [], sessions: {}, settings: { registrationOpen: true, trashRetentionDays: 30 }, notes: [], folders: [], uploads: {} };

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

const normTrashDays = (v) => (Number.isInteger(v) && v >= 1 && v <= 3650) ? v : 30;

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
      settings: {
        registrationOpen: !(parsed.settings && parsed.settings.registrationOpen === false),
        trashRetentionDays: normTrashDays(parsed.settings && parsed.settings.trashRetentionDays),
      },
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
      // Data-safety fields: rev is the concurrency token, deletedAt marks a
      // trashed note. Notes written before they existed start at rev 1 / live.
      n.rev = (Number.isInteger(n.rev) && n.rev >= 1) ? n.rev : 1;
      n.deletedAt = (typeof n.deletedAt === 'number') ? n.deletedAt : null;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.error(`Warning: could not parse ${DB_FILE} (${err.message}); starting with an empty store.`);
  }
}

// Coalesce rapid writes into a single atomic write (tmp file + rename).
// A failed write is retried with a short backoff (Windows can refuse the
// rename for a moment while a scanner holds the file) — never dropped.
let saveQueued = false;
let saveRunning = false;
function saveDb() {
  saveQueued = true;
  if (saveRunning) return;
  saveRunning = true;
  (async () => {
    let retries = 0;
    try {
      while (saveQueued) {
        saveQueued = false;
        try {
          await fsp.mkdir(DATA_DIR, { recursive: true });
          const tmp = DB_FILE + '.tmp';
          await fsp.writeFile(tmp, JSON.stringify(db, null, 2));
          await fsp.rename(tmp, DB_FILE);
          retries = 0;
        } catch (err) {
          console.error('Failed to save data file:', err.message);
          retries += 1;
          if (retries > 40) break; // persistent failure — stop spinning
          saveQueued = true;
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    } finally {
      saveRunning = false;
    }
  })();
}

/* ------------------------------------------------------------------ history
   Per-note revision sidecars: data/history/<noteId>.jsonl, one JSON object
   per line. History never enters notes.json, is never scanned at startup,
   and the directory is created lazily on the first append. */

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');

// The note id reaches the file system, so accept only UUID-shaped ids and
// keep the resolved path inside data/history/ (same guard as serveStatic).
function historyPath(noteId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(noteId)) return null;
  const p = path.normalize(path.join(HISTORY_DIR, `${noteId}.jsonl`));
  return p.startsWith(HISTORY_DIR + path.sep) ? p : null;
}

// Snapshot of a note state, tagged with the note's rev at capture time.
// For "rejected" entries, `state` is the losing client payload instead.
function historyEntry(note, kind, state = null) {
  const s = state || note;
  return {
    ts: Date.now(),
    rev: note.rev,
    kind,
    title: s.title,
    content: s.content,
    tags: Array.isArray(s.tags) ? s.tags : [],
    pinned: s.pinned === true,
    folderId: s.folderId != null ? s.folderId : null,
    bytes: Buffer.byteLength(String(s.content || ''), 'utf8'),
    hash: sha256Hex(String(s.content || '')),
  };
}

function parseHistoryLine(line) {
  try {
    const o = JSON.parse(line);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

async function readHistory(noteId) {
  const file = historyPath(noteId);
  if (!file) return [];
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch {
    return []; // no file yet = no history
  }
  return text.split('\n').map(parseHistoryLine).filter(Boolean);
}

// Serialise sidecar writes per note so concurrent appends/trims cannot
// interleave (the map holds the tail promise for each note id).
const historyQueues = new Map();

function appendHistory(noteId, entry) {
  const file = historyPath(noteId);
  if (!file) return Promise.resolve();
  const run = async () => {
    await fsp.mkdir(HISTORY_DIR, { recursive: true });
    let lines = [];
    try {
      lines = (await fsp.readFile(file, 'utf8')).split('\n').filter((l) => l.trim());
    } catch { /* no file yet */ }
    const last = lines.length ? parseHistoryLine(lines[lines.length - 1]) : null;
    // At most one "edit" entry per note per 60 seconds, and never the same
    // content twice in a row. rejected/restore/trash/purge always append.
    if (entry.kind === 'edit' && last &&
        (entry.ts - last.ts < HISTORY_FLOOR_MS || last.hash === entry.hash)) {
      return;
    }
    const line = JSON.stringify(entry);
    if (lines.length < MAX_HISTORY_PER_NOTE) {
      await fsp.appendFile(file, line + '\n');
      return;
    }
    // Cap reached: rewrite the file with the newest MAX_HISTORY_PER_NOTE
    // lines (tmp + rename, the same atomic pattern as saveDb).
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, [...lines.slice(-(MAX_HISTORY_PER_NOTE - 1)), line].join('\n') + '\n');
    await fsp.rename(tmp, file);
  };
  const tail = (historyQueues.get(noteId) || Promise.resolve()).catch(() => {}).then(run);
  historyQueues.set(noteId, tail);
  tail.finally(() => {
    if (historyQueues.get(noteId) === tail) historyQueues.delete(noteId);
  }).catch(() => {});
  return tail;
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
  // The account's history sidecars are deleted along with its notes; the
  // whole account going away is one of the two allowed history deletions.
  const noteIds = db.notes.filter((n) => n.userId === user.id).map((n) => n.id);
  db.users = db.users.filter((u) => u.id !== user.id);
  db.notes = db.notes.filter((n) => n.userId !== user.id);
  for (const [t, s] of Object.entries(db.sessions)) {
    if (s.uid === user.id) delete db.sessions[t];
  }
  (async () => {
    for (const id of noteIds) {
      const file = historyPath(id);
      if (file) await fsp.unlink(file).catch(() => {});
    }
    pruneOrphanUploads();
  })();
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

// Delete upload files nothing references any more. References live in every
// note (trashed included — their files must survive) and in every line of
// every history sidecar. Called after a purge, a trash-empty or an account
// deletion; never after a plain soft delete.
async function pruneOrphanUploads() {
  try {
    const files = await fsp.readdir(UPLOAD_DIR).catch(() => []);
    if (!files.length) return;
    const refs = new Set();
    const re = new RegExp(`/uploads/([a-f0-9]{32}\\.(?:${UPLOAD_EXT_RE}))`, 'g');
    for (const note of db.notes) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(note.content))) refs.add(m[1]);
    }
    // A history revision may be the last thing pointing at a file. If a
    // sidecar cannot be read or parsed we cannot verify its references —
    // skip the whole prune rather than risk deleting a live file.
    const sidecars = await fsp.readdir(HISTORY_DIR).catch(() => []);
    for (const f of sidecars) {
      if (!f.endsWith('.jsonl')) continue;
      let text;
      try {
        text = await fsp.readFile(path.join(HISTORY_DIR, f), 'utf8');
      } catch (err) {
        console.warn(`Upload prune skipped: cannot read history file ${f} (${err.message}).`);
        return;
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        const entry = parseHistoryLine(line);
        if (!entry) {
          console.warn(`Upload prune skipped: malformed line in history file ${f}.`);
          return;
        }
        re.lastIndex = 0;
        let m;
        const content = typeof entry.content === 'string' ? entry.content : '';
        while ((m = re.exec(content))) refs.add(m[1]);
      }
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

// Purge notes whose trash retention window has elapsed. Runs once at
// startup and hourly; never blocks listening and only saves when it
// actually purged something.
async function sweepTrash() {
  try {
    const cutoff = Date.now() - db.settings.trashRetentionDays * 86400000;
    const expired = db.notes.filter((n) => n.deletedAt != null && n.deletedAt < cutoff);
    if (!expired.length) return;
    const entries = expired.map((n) => historyEntry(n, 'purge'));
    const ids = new Set(expired.map((n) => n.id));
    db.notes = db.notes.filter((n) => !ids.has(n.id));
    saveDb();
    for (let i = 0; i < expired.length; i++) {
      await appendHistory(expired[i].id, entries[i]);
      if (historyPath(expired[i].id)) await fsp.unlink(historyPath(expired[i].id)).catch(() => {});
    }
    await pruneOrphanUploads();
    log(`Trash retention purged ${expired.length} note(s).`);
  } catch (err) {
    console.error('Trash retention sweep failed:', err.message);
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
      features: { trash: true, history: true, conflicts: true, qr: qr != null },
      trashRetentionDays: db.settings.trashRetentionDays,
      publicBaseUrl,
    });
  }

  // Public, read-only view of a shared note. The 128-bit token in the link
  // is the only credential — no session required.
  const shm = pathname.match(/^\/api\/share\/([a-f0-9]{32})$/);
  if (shm && method === 'GET') {
    const note = db.notes.find((n) => n.share && n.share.token === shm[1]);
    if (!note || note.deletedAt != null) return sendJson(res, 404, { error: 'This link is no longer valid' });
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
      .map((f) => ({ ...f, noteCount: db.notes.filter((n) => n.userId === user.id && n.folderId === f.id && n.deletedAt == null).length }));
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
      .filter((n) => n.userId === user.id && n.deletedAt == null)
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
    const note = { id: crypto.randomUUID(), userId: user.id, folderId: resolveFolderId(body.folderId, user), ...clean, createdAt: now, updatedAt: now, rev: 1, deletedAt: null };
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
      if (note.deletedAt != null) {
        return sendJson(res, 409, { error: 'This note is in the trash', code: 'trashed', note });
      }
      // Concurrency: a body without rev is a legacy client (last-write-wins);
      // a rev that no longer matches lost a race — keep the losing payload in
      // history, never merge. The check runs immediately before the mutation
      // with no await in between, so interleaved requests cannot both pass.
      if ('rev' in body) {
        if (typeof body.rev !== 'number' || !Number.isFinite(body.rev)) {
          return sendJson(res, 400, { error: 'rev must be a number' });
        }
        if (body.rev !== note.rev) {
          await appendHistory(note.id, historyEntry(note, 'rejected', { ...sanitizeNote(body), folderId: resolveFolderId(body.folderId, user) }));
          return sendJson(res, 409, { error: 'This note was changed on another device', code: 'conflict', note });
        }
      }
      const entry = historyEntry(note, 'edit'); // the state before this update
      Object.assign(note, sanitizeNote(body), { updatedAt: Date.now() });
      // Only touch the folder when the client sends the field at all —
      // older clients (Android app) that don't know about folders must not
      // accidentally unfile notes.
      if ('folderId' in body) note.folderId = resolveFolderId(body.folderId, user);
      note.rev += 1;
      saveDb();
      await appendHistory(note.id, entry);
      return sendJson(res, 200, { note });
    }
    if (method === 'DELETE') {
      // Soft delete: the note stays in db.notes (it still counts against
      // MAX_NOTES_PER_USER — trash must not become free storage) and keeps
      // its history and uploads. Idempotent.
      if (note.deletedAt != null) {
        return sendJson(res, 200, { ok: true, deletedAt: note.deletedAt });
      }
      const entry = historyEntry(note, 'trash');
      note.deletedAt = Date.now();
      note.rev += 1;
      // Cap the trash: purge the oldest trashed notes past the limit.
      const overflow = db.notes
        .filter((n) => n.userId === user.id && n.deletedAt != null && n.id !== note.id)
        .sort((a, b) => a.deletedAt - b.deletedAt)
        .slice(0, Math.max(0, db.notes.filter((n) => n.userId === user.id && n.deletedAt != null).length - MAX_TRASH_PER_USER));
      const overflowEntries = overflow.map((n) => historyEntry(n, 'purge'));
      if (overflow.length) {
        const ids = new Set(overflow.map((n) => n.id));
        db.notes = db.notes.filter((n) => !ids.has(n.id));
      }
      saveDb();
      await appendHistory(note.id, entry);
      for (let i = 0; i < overflow.length; i++) {
        await appendHistory(overflow[i].id, overflowEntries[i]);
        if (historyPath(overflow[i].id)) await fsp.unlink(historyPath(overflow[i].id)).catch(() => {});
      }
      if (overflow.length) await pruneOrphanUploads();
      return sendJson(res, 200, { ok: true, deletedAt: note.deletedAt });
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

  /* ------------------------------------------------------------ trash */

  if (pathname === '/api/trash' && method === 'GET') {
    const notes = db.notes
      .filter((n) => n.userId === user.id && n.deletedAt != null)
      .sort((a, b) => b.deletedAt - a.deletedAt);
    return sendJson(res, 200, { notes, total: notes.length });
  }

  // Restore from trash (idempotent: a live note is returned unchanged).
  const rm = pathname.match(/^\/api\/notes\/([^/]+)\/restore$/);
  if (rm && method === 'POST') {
    const note = db.notes.find((n) => n.id === rm[1] && n.userId === user.id);
    if (!note) return sendJson(res, 404, { error: 'Note not found' });
    if (note.deletedAt != null) {
      note.deletedAt = null;
      note.updatedAt = Date.now();
      note.rev += 1;
      saveDb();
    }
    return sendJson(res, 200, { note });
  }

  // Permanent delete: drop the note, its history and (via the prune) any
  // uploads only it still referenced.
  const pg = pathname.match(/^\/api\/notes\/([^/]+)\/purge$/);
  if (pg && method === 'POST') {
    const note = db.notes.find((n) => n.id === pg[1] && n.userId === user.id);
    if (!note) return sendJson(res, 404, { error: 'Note not found' });
    const entry = historyEntry(note, 'purge');
    db.notes = db.notes.filter((n) => n.id !== note.id);
    saveDb();
    await appendHistory(note.id, entry);
    if (historyPath(note.id)) await fsp.unlink(historyPath(note.id)).catch(() => {});
    await pruneOrphanUploads();
    log(`Note ${note.id} purged by "${user.name}"`);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/trash/empty' && method === 'POST') {
    const trashed = db.notes.filter((n) => n.userId === user.id && n.deletedAt != null);
    const entries = trashed.map((n) => historyEntry(n, 'purge'));
    if (trashed.length) {
      const ids = new Set(trashed.map((n) => n.id));
      db.notes = db.notes.filter((n) => !ids.has(n.id));
      saveDb();
      for (let i = 0; i < trashed.length; i++) {
        await appendHistory(trashed[i].id, entries[i]);
        if (historyPath(trashed[i].id)) await fsp.unlink(historyPath(trashed[i].id)).catch(() => {});
      }
      await pruneOrphanUploads();
    }
    return sendJson(res, 200, { purged: trashed.length });
  }

  /* ------------------------------------------------------------ history */

  const hl = pathname.match(/^\/api\/notes\/([^/]+)\/history$/);
  if (hl && method === 'GET') {
    const note = db.notes.find((n) => n.id === hl[1] && n.userId === user.id);
    if (!note) return sendJson(res, 404, { error: 'Note not found' });
    const revisions = (await readHistory(note.id))
      .map((e) => ({ rev: e.rev, ts: e.ts, kind: e.kind, bytes: e.bytes, title: e.title, preview: String(e.content || '').slice(0, 120) }))
      .sort((a, b) => b.ts - a.ts);
    return sendJson(res, 200, { revisions });
  }

  const hr = pathname.match(/^\/api\/notes\/([^/]+)\/history\/([^/]+)$/);
  if (hr && method === 'GET') {
    const note = db.notes.find((n) => n.id === hr[1] && n.userId === user.id);
    if (!note) return sendJson(res, 404, { error: 'Note not found' });
    const hit = (await readHistory(note.id)).filter((e) => e.rev === Number(hr[2])).pop();
    if (!hit) return sendJson(res, 404, { error: 'Revision not found' });
    return sendJson(res, 200, { revision: hit });
  }

  // Restore an old revision. The current state is appended as a "restore"
  // entry first, so the restore itself is undoable. Same conflict rules as
  // a normal write: a stale rev in the body changes nothing.
  const rhm = pathname.match(/^\/api\/notes\/([^/]+)\/history\/([^/]+)\/restore$/);
  if (rhm && method === 'POST') {
    const note = db.notes.find((n) => n.id === rhm[1] && n.userId === user.id);
    if (!note) return sendJson(res, 404, { error: 'Note not found' });
    if (note.deletedAt != null) {
      return sendJson(res, 409, { error: 'This note is in the trash', code: 'trashed', note });
    }
    const revision = (await readHistory(note.id)).filter((e) => e.rev === Number(rhm[2])).pop();
    if (!revision) return sendJson(res, 404, { error: 'Revision not found' });
    const body = await readJson(req);
    if ('rev' in body) {
      if (typeof body.rev !== 'number' || !Number.isFinite(body.rev)) {
        return sendJson(res, 400, { error: 'rev must be a number' });
      }
      if (body.rev !== note.rev) {
        return sendJson(res, 409, { error: 'This note was changed on another device', code: 'conflict', note });
      }
    }
    const entry = historyEntry(note, 'restore');
    note.title = str(revision.title, 500);
    note.content = str(revision.content, 1024 * 1024);
    note.tags = sanitizeTags(revision.tags);
    note.pinned = revision.pinned === true;
    note.folderId = resolveFolderId(revision.folderId, user);
    note.updatedAt = Date.now();
    note.rev += 1;
    saveDb();
    await appendHistory(note.id, entry);
    return sendJson(res, 200, { note });
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

/* ---------------------------------------------------- share page head
   The SPA shell is served for /share/<token> with a server-rendered <head>
   (title, description, Open Graph / Twitter tags, canonical, noindex) so
   link unfurls show a real card. The note BODY stays client-rendered. */

const escapeHtml = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Absolute origin for og:url / og:image: the configured PUBLIC_BASE_URL, or
// a per-request derivation that never interpolates an unchecked Host header.
function requestOrigin(req) {
  if (publicBaseUrl) return publicBaseUrl;
  let proto = 'http';
  const fwd = req.headers['x-forwarded-proto'];
  if (typeof fwd === 'string' && fwd.length) proto = fwd.split(',')[0].trim();
  else if (req.socket && req.socket.encrypted) proto = 'https';
  const host = req.headers.host;
  if (typeof host === 'string' && host.length <= 253 && HOST_RE.test(host)) {
    return `${proto}://${host}`;
  }
  return `http://localhost:${PORT}`;
}

// Single-line excerpt of the markdown body, target 160 chars. Truncates on
// code points (Array.from), never mid-surrogate-pair.
function shareExcerpt(content) {
  const text = String(content || '')
    .replace(/```[\s\S]*?```/g, ' ')                 // fenced code blocks
    .replace(/`([^`]*)`/g, '$1')                     // inline code
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')        // images -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')         // links -> text
    .replace(/<[^>]+>/g, ' ')                        // raw HTML tags
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')              // heading hashes
    .replace(/(\*\*|__|\*|~~)/g, '')                 // emphasis markers
    .replace(/^\s{0,3}>\s?/gm, '')                   // blockquote markers
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '')         // list markers
    .replace(/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/gm, ' ') // table separators
    .replace(/\|/g, ' ')                             // table pipes
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'A shared note.';
  const chars = Array.from(text);
  return chars.length <= 160 ? text : chars.slice(0, 160).join('') + '...';
}

// First image the note references: markdown image with alt text first, then
// any bare upload path. The regexes only ever match local /uploads/ image
// paths, so og:image cannot be pointed at an arbitrary or off-site URL.
function shareImage(content) {
  const c = String(content || '');
  let m = c.match(/!\[([^\]]*)\]\((\/uploads\/[a-f0-9]{32}\.(?:png|jpe?g|gif|webp))\)/);
  if (m) return { path: m[2], alt: m[1] };
  m = c.match(/\/uploads\/[a-f0-9]{32}\.(?:png|jpe?g|gif|webp)/);
  if (m) return { path: m[0], alt: '' };
  return null;
}

// Pure builder for the share page's <head> block. Every interpolated value
// is HTML-attribute-escaped.
function renderShareHead(note, origin, token, hasDefaultImage) {
  const e = escapeHtml;
  const title = note.title || 'Shared note'; // matches the SPA's own fallback
  const absoluteUrl = `${origin}/share/${token}`;
  const excerpt = shareExcerpt(note.content);
  const img = shareImage(note.content);
  const imageUrl = img ? `${origin}${img.path}?s=${token}` : (hasDefaultImage ? `${origin}/og-default.png` : null);
  const imageAlt = img ? (img.alt || title) : title;
  const m = [];
  m.push(`<meta name="description" content="${e(excerpt)}">`);
  m.push(`<link rel="canonical" href="${e(absoluteUrl)}">`);
  m.push('<meta name="robots" content="noindex, nofollow, noarchive">');
  m.push('<meta property="og:type" content="article">');
  m.push('<meta property="og:site_name" content="Notes">');
  m.push(`<meta property="og:title" content="${e(title)}">`);
  m.push(`<meta property="og:description" content="${e(excerpt)}">`);
  m.push(`<meta property="og:url" content="${e(absoluteUrl)}">`);
  if (imageUrl) {
    m.push(`<meta property="og:image" content="${e(imageUrl)}">`);
    m.push(`<meta property="og:image:alt" content="${e(imageAlt)}">`);
  }
  m.push(`<meta property="article:modified_time" content="${new Date(note.updatedAt).toISOString()}">`);
  m.push(`<meta name="twitter:card" content="${imageUrl ? 'summary_large_image' : 'summary'}">`);
  m.push(`<meta name="twitter:title" content="${e(title)}">`);
  m.push(`<meta name="twitter:description" content="${e(excerpt)}">`);
  if (imageUrl) m.push(`<meta name="twitter:image" content="${e(imageUrl)}">`);
  return { title: `${title} — Notes`, metas: m.join('\n    ') };
}

// Cached at startup; null when the shell could not be read (then /share/
// behaves exactly as before).
let shareShell = null;
let ogDefaultExists = false;

function sendShareShell(res, status, html) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
    ...SECURITY_HEADERS,
  });
  res.end(html);
}

// /share/<token>: the SPA shell with a per-note head for a live shared
// note; a generic noindex shell (404) for unknown/revoked/trashed tokens.
async function sendSharePage(req, res, token) {
  if (!shareShell) return serveStatic(res, '/');
  const note = token
    ? db.notes.find((n) => n.share && n.share.token === token && n.deletedAt == null) || null
    : null;
  const origin = requestOrigin(req);
  const meta = note
    ? renderShareHead(note, origin, token, ogDefaultExists)
    : { title: 'Note unavailable — Notes', metas: '<meta name="robots" content="noindex, nofollow, noarchive">' };
  const html = note
    ? shareShell
        // the shell ships a static description; the note's replaces it
        // (keeping both would let crawlers pick the generic one)
        .replace(/<meta name="description"[^>]*>/, '')
        .replace('<title>Notes</title>', `<title>${escapeHtml(meta.title)}</title>`)
        .replace('</head>', `  ${meta.metas}\n</head>`)
    : shareShell
        .replace('<title>Notes</title>', `<title>${escapeHtml(meta.title)}</title>`)
        .replace('</head>', `  ${meta.metas}\n</head>`);
  sendShareShell(res, note ? 200 : 404, html);
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
      if (note && note.deletedAt == null && note.content.includes(name)) allowed = true;
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
  // /share/<token>/qr.svg — the QR code of the absolute share URL. The QR of
  // a token never changes, so it is cacheable even after revocation (the
  // encoded URL itself then 404s).
  const sq = pathname.match(/^\/share\/([a-f0-9]{32})\/qr\.svg$/);
  if (sq) {
    const note = qr && db.notes.find((n) => n.share && n.share.token === sq[1] && n.deletedAt == null);
    if (!note) return sendSharePage(req, res, null); // same 404 shell as A3
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
      ...SECURITY_HEADERS,
    });
    return res.end(qr.toSvg(`${requestOrigin(req)}/share/${sq[1]}`, { scale: 4 }));
  }

  // /share/<token> is a client-side route — serve the app shell, with a
  // server-rendered <head> for valid tokens. Anything else under /share/
  // (malformed tokens, revoked links) gets the same shell as a 404 so the
  // SPA still renders its friendly "Note unavailable" message.
  const sp = pathname.match(/^\/share\/([a-f0-9]{32})$/);
  if (sp) return sendSharePage(req, res, sp[1]);
  if (pathname.startsWith('/share/')) return sendSharePage(req, res, null);
  return serveStatic(res, pathname);
}

loadDb().then(async () => {
  sweepTrash(); // fire-and-forget: startup never waits on the sweep
  setInterval(sweepTrash, 60 * 60 * 1000);
  // Cache the SPA shell once for server-rendered share heads (not per
  // request). A read failure falls back to the old behaviour.
  try {
    shareShell = await fsp.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  } catch (err) {
    console.warn(`Warning: could not read the app shell for share pages (${err.message}); serving it unmodified.`);
  }
  ogDefaultExists = await fsp.access(path.join(PUBLIC_DIR, 'og-default.png')).then(() => true).catch(() => false);
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
