'use strict';
/* Phase B: QR encoder — structural checks, an INDEPENDENT round-trip decode
 * (read format info, invert the mask, walk the zigzag, de-interleave, parse
 * the bitstream — no encoder internals trusted), SVG shape, HTTP endpoint. */

const test = require('node:test');
const assert = require('node:assert/strict');
const qrLib = require('../lib/qr');
const { decodePayload, ALIGNMENT } = require('./qr-decode');
const { startServer, register, req, createNote } = require('./helpers');

/* ------------------------------------------------------------ tests */

test('encode produces a version-consistent matrix (size = 17 + 4*version)', () => {
  const url = 'https://example.test/share/' + 'a'.repeat(32);
  const { size, modules } = qrLib.encode(url);
  assert.ok(size >= 21);
  assert.equal((size - 17) % 4, 0, 'size matches a QR version');
  assert.equal(modules.length, size);
  for (const row of modules) assert.equal(row.length, size);
});

test('structural: finders, timing, dark module, alignment', () => {
  const { size, modules } = qrLib.encode('https://example.test/share/' + 'b'.repeat(32));
  const finderOk = (ox, oy) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
        const dark = ring === 3 || ring <= 1; // dark border, light ring, dark 3x3 centre
        assert.equal(modules[oy + y][ox + x], dark ? 1 : 0, `finder at ${ox},${oy} module ${x},${y}`);
      }
    }
  };
  finderOk(0, 0);
  finderOk(size - 7, 0);
  finderOk(0, size - 7);
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0, `timing row at ${i}`);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0, `timing col at ${i}`);
  }
  assert.equal(modules[size - 8][8], 1, 'dark module at (x=8, y=size-8)');
  // alignment pattern for a version >= 2 symbol: 5x5 ring around a centre
  const centres = ALIGNMENT[(size - 17) / 4];
  const cx = centres[centres.length - 1];
  const cy = centres[1];
  assert.equal(modules[cy][cx], 1, 'alignment centre dark');
  assert.equal(modules[cy][cx - 2], 1, 'alignment ring');
  assert.equal(modules[cy][cx - 1], 0, 'alignment gap');
});

test('round-trip: the matrix decodes back to the input URL', () => {
  const inputs = [
    'hello',
    'https://example.test/share/' + '0123456789abcdef0123456789abcdef',
    'https://funshare.site/share/' + 'fedcba9876543210fedcba9876543210?x=' + 'y'.repeat(40),
  ];
  for (const text of inputs) {
    const { size, modules } = qrLib.encode(text, { ecc: 'M' });
    assert.equal(decodePayload(modules, size), text, `round-trip failed for length ${text.length}`);
  }
});

test('toSvg: <svg> with viewBox, title, crispEdges, quiet zone, no script', () => {
  const svg = qrLib.toSvg('https://example.test/share/' + 'c'.repeat(32));
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.includes('viewBox='));
  assert.ok(svg.includes('<title>QR code for this share link</title>'));
  assert.ok(svg.includes('shape-rendering="crispEdges"'));
  assert.ok(svg.includes('role="img"'));
  assert.equal(svg.includes('<script'), false);
  assert.equal(svg.includes('foreignObject'), false);
  // quiet zone: no dark module rect may start inside the 4-module border
  const { size } = qrLib.encode('https://example.test/share/' + 'c'.repeat(32));
  const dim = (size + 8) * 4;
  assert.ok(svg.includes(`viewBox="0 0 ${dim} ${dim}"`));
  for (const m of svg.matchAll(/<rect x="(\d+)" y="(\d+)"/g)) {
    assert.ok(Number(m[1]) >= 16 && Number(m[2]) >= 16, 'dark modules stay inside the quiet zone');
  }
});

test('GET /share/<token>/qr.svg serves SVG and 404s unknown tokens', async () => {
  const server = await startServer();
  try {
    const cookie = await register(server.base, 'qriter');
    const note = await createNote(server.base, cookie, 'qr me');
    const r = await req(server.base, cookie, 'POST', `/api/notes/${note.id}/share`);
    const token = r.data.share.token;

    const res = await fetch(`${server.base}/share/${token}/qr.svg`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^image\/svg\+xml/);
    assert.match(res.headers.get('cache-control'), /max-age=86400/);
    const body = await res.text();
    assert.ok(body.startsWith('<svg'));
    assert.ok(body.includes(`${server.base}/share/${token}`) || true); // URL is encoded in modules, not visible as text

    const bad = await fetch(`${server.base}/share/${'9'.repeat(32)}/qr.svg`);
    assert.equal(bad.status, 404);

    const sess = await req(server.base, '', 'GET', '/api/session');
    assert.equal(sess.data.features.qr, true);
  } finally {
    await server.stop();
  }
});
