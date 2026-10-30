'use strict';
/* Independent QR decoder used by test/qr.test.js and ad-hoc verification:
 * reads format info, inverts the mask, walks the zigzag, de-interleaves and
 * parses the byte-mode bitstream. Trusts nothing from the encoder. */

const assert = require('node:assert/strict');

/* ------------------------------------------------ independent decoder */

// ECC-M block layout per version 1..10: [numShort, shortLen, numLong, longLen, ecPerBlock]
const M_BLOCKS = {
  1: [1, 16, 0, 0, 10],
  2: [1, 28, 0, 0, 16],
  3: [1, 44, 0, 0, 26],
  4: [0, 32, 2, 32, 18],
  5: [0, 43, 2, 43, 24],
  6: [4, 27, 0, 0, 16],
  7: [4, 31, 0, 0, 18],
  8: [2, 38, 2, 39, 22],
  9: [3, 36, 2, 37, 22],
  10: [4, 43, 1, 44, 26],
};

const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

function functionModuleMap(size) {
  const version = (size - 17) / 4;
  const map = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x >= 0 && y >= 0 && x < size && y < size) map[y][x] = true;
      }
    }
  };
  mark(0, 0, 9, 9);            // top-left finder + separator + format
  mark(size - 8, 0, 8, 9);     // top-right finder + separator + format
  mark(0, size - 8, 9, 8);     // bottom-left finder + separator + format + dark module
  for (let i = 0; i < size; i++) { map[6][i] = true; map[i][6] = true; }
  const cs = ALIGNMENT[version] || [];
  const last = cs[cs.length - 1];
  for (const cy of cs) {
    for (const cx of cs) {
      if ((cx === 6 && cy === 6) || (cx === last && cy === 6) || (cx === 6 && cy === last)) continue;
      mark(cx - 2, cy - 2, 5, 5);
    }
  }
  if (version >= 7) { mark(0, size - 11, 6, 3); mark(size - 11, 0, 3, 6); }
  return map;
}

const MASK_FNS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x, y) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

// Read both format-info copies, match against all 32 valid BCH codes,
// return the agreed { mask, eclBits } (eclBits: 0=M, 1=L, 2=H, 3=Q).
function readFormat(modules, size) {
  const bit = (x, y) => (modules[y][x] ? 1 : 0);
  const read = (positions) => {
    let v = 0;
    positions.forEach(([x, y], i) => { if (bit(x, y)) v |= 1 << i; });
    return v;
  };
  const copy1 = read([[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]]);
  const copy2 = read([
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8], [size - 5, 8], [size - 6, 8], [size - 7, 8], [size - 8, 8],
    [8, size - 7], [8, size - 6], [8, size - 5], [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ]);
  // valid format codes: BCH(15,5) with generator 0x537 (10-bit register),
  // XOR mask 0x5412
  const valid = new Map();
  for (let d = 0; d < 32; d++) {
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    valid.set(((d << 10) | (rem & 0x3ff)) ^ 0x5412, d);
  }
  const hamming = (a, b) => (a ^ b).toString(2).replace(/0/g, '').length;
  let best = null;
  for (const [code, d] of valid) {
    const dist = hamming(copy1, code) + hamming(copy2, code);
    if (!best || dist < best.dist) best = { dist, d };
  }
  assert.ok(best.dist <= 3, `format info unrecognisable (distance ${best.dist})`);
  return { mask: best.d & 7, eclBits: best.d >>> 3 };
}

// Read the interleaved codewords out of the matrix (mask inverted).
function readCodewords(modules, size, maskId) {
  const map = functionModuleMap(size);
  const maskFn = MASK_FNS[maskId];
  const bits = [];
  let up = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let i = 0; i < size; i++) {
      const y = up ? size - 1 - i : i;
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx;
        if (map[y][x]) continue;
        let b = modules[y][x];
        if (maskFn(x, y)) b ^= 1;
        bits.push(b);
      }
    }
    up = !up;
  }
  const total = Math.floor(bits.length / 8);
  const out = [];
  for (let i = 0; i < total; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    out.push(v);
  }
  return out;
}

function decodePayload(modules, size) {
  const version = (size - 17) / 4;
  const { mask, eclBits } = readFormat(modules, size);
  assert.equal(eclBits, 0, 'expected error-correction level M');
  const [ns, sl, nl, ll] = M_BLOCKS[version];
  const dataCount = ns * sl + nl * ll;
  const codewords = readCodewords(modules, size, mask);
  // de-interleave the data region (round-robin across blocks)
  const maxLen = Math.max(sl, ll);
  const blocks = Array.from({ length: ns + nl }, () => []);
  let idx = 0;
  for (let p = 0; p < maxLen; p++) {
    for (let b = 0; b < ns + nl; b++) {
      if (p < (b < ns ? sl : ll)) blocks[b].push(codewords[idx++]);
    }
  }
  const data = blocks.flat().slice(0, dataCount);
  let bitPos = 0;
  const readBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = data[bitPos >> 3];
      v = (v << 1) | ((byte >> (7 - (bitPos & 7))) & 1);
      bitPos += 1;
    }
    return v;
  };
  const mode = readBits(4);
  assert.equal(mode, 4, 'byte mode');
  const count = readBits(version <= 9 ? 8 : 16);
  const bytes = [];
  for (let i = 0; i < count; i++) bytes.push(readBits(8));
  return Buffer.from(bytes).toString('utf8');
}


module.exports = { decodePayload, readFormat, readCodewords, functionModuleMap, MASK_FNS, M_BLOCKS, ALIGNMENT };
