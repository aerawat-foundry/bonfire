// Art QR encoder: a standards-compliant QR code whose spare bits and part of
// its error-correction budget are spent on drawing a picture.
//
// Two sources of freedom (after Russ Cox's "QArt"):
//  1. Free bits. Byte-mode text is followed by a terminator; decoders ignore
//     every data bit after it. Reed-Solomon parity is linear over GF(2), so
//     choosing those bits by Gaussian elimination sets chosen modules (data
//     *and* parity) to any value, with zero errors.
//  2. Burn. Each RS block can repair floor(ec/2) wrong codewords. A chosen
//     fraction of that budget is spent forcing more modules toward the
//     picture; the rest stays as real-world margin.

import { rsEncode } from './rs.js';
import { alignmentCenters } from './qr.js';

// [count, total, data(, count2, total2, data2)] per version, per level L, M, Q, H.
const RS_BLOCKS = [
  /*  1 */ [[1,26,19],[1,26,16],[1,26,13],[1,26,9]],
  /*  2 */ [[1,44,34],[1,44,28],[1,44,22],[1,44,16]],
  /*  3 */ [[1,70,55],[1,70,44],[2,35,17],[2,35,13]],
  /*  4 */ [[1,100,80],[2,50,32],[2,50,24],[4,25,9]],
  /*  5 */ [[1,134,108],[2,67,43],[2,33,15,2,34,16],[2,33,11,2,34,12]],
  /*  6 */ [[2,86,68],[4,43,27],[4,43,19],[4,43,15]],
  /*  7 */ [[2,98,78],[4,49,31],[2,32,14,4,33,15],[4,39,13,1,40,14]],
  /*  8 */ [[2,121,97],[2,60,38,2,61,39],[4,40,18,2,41,19],[4,40,14,2,41,15]],
  /*  9 */ [[2,146,116],[3,58,36,2,59,37],[4,36,16,4,37,17],[4,36,12,4,37,13]],
  /* 10 */ [[2,86,68,2,87,69],[4,69,43,1,70,44],[6,43,19,2,44,20],[6,43,15,2,44,16]],
  /* 11 */ [[4,101,81],[1,80,50,4,81,51],[4,50,22,4,51,23],[3,36,12,8,37,13]],
  /* 12 */ [[2,116,92,2,117,93],[6,58,36,2,59,37],[4,46,20,6,47,21],[7,42,14,4,43,15]],
  /* 13 */ [[4,133,107],[8,59,37,1,60,38],[8,44,20,4,45,21],[12,33,11,4,34,12]],
  /* 14 */ [[3,145,115,1,146,116],[4,64,40,5,65,41],[11,36,16,5,37,17],[11,36,12,5,37,13]],
  /* 15 */ [[5,109,87,1,110,88],[5,65,41,5,66,42],[5,54,24,7,55,25],[11,36,12,7,37,13]],
  /* 16 */ [[5,122,98,1,123,99],[7,73,45,3,74,46],[15,43,19,2,44,20],[3,45,15,13,46,16]],
  /* 17 */ [[1,135,107,5,136,108],[10,74,46,1,75,47],[1,50,22,15,51,23],[2,42,14,17,43,15]],
  /* 18 */ [[5,150,120,1,151,121],[9,69,43,4,70,44],[17,50,22,1,51,23],[2,42,14,19,43,15]],
  /* 19 */ [[3,141,113,4,142,114],[3,70,44,11,71,45],[17,47,21,4,48,22],[9,39,13,16,40,14]],
  /* 20 */ [[3,135,107,5,136,108],[3,67,41,13,68,42],[15,54,24,5,55,25],[15,43,15,10,44,16]],
  /* 21 */ [[4,144,116,4,145,117],[17,68,42],[17,50,22,6,51,23],[19,46,16,6,47,17]],
  /* 22 */ [[2,139,111,7,140,112],[17,74,46],[7,54,24,16,55,25],[34,37,13]],
  /* 23 */ [[4,151,121,5,152,122],[4,75,47,14,76,48],[11,54,24,14,55,25],[16,45,15,14,46,16]],
  /* 24 */ [[6,147,117,4,148,118],[6,73,45,14,74,46],[11,54,24,16,55,25],[30,46,16,2,47,17]],
  /* 25 */ [[8,132,106,4,133,107],[8,75,47,13,76,48],[7,54,24,22,55,25],[22,45,15,13,46,16]],
  /* 26 */ [[10,142,114,2,143,115],[19,74,46,4,75,47],[28,50,22,6,51,23],[33,46,16,4,47,17]],
  /* 27 */ [[8,152,122,4,153,123],[22,73,45,3,74,46],[8,53,23,26,54,24],[12,45,15,28,46,16]],
  /* 28 */ [[3,147,117,10,148,118],[3,73,45,23,74,46],[4,54,24,31,55,25],[11,45,15,31,46,16]],
  /* 29 */ [[7,146,116,7,147,117],[21,73,45,7,74,46],[1,53,23,37,54,24],[19,45,15,26,46,16]],
  /* 30 */ [[5,145,115,10,146,116],[19,75,47,10,76,48],[15,54,24,25,55,25],[23,45,15,25,46,16]],
  /* 31 */ [[13,145,115,3,146,116],[2,74,46,29,75,47],[42,54,24,1,55,25],[23,45,15,28,46,16]],
  /* 32 */ [[17,145,115],[10,74,46,23,75,47],[10,54,24,35,55,25],[19,45,15,35,46,16]],
  /* 33 */ [[17,145,115,1,146,116],[14,74,46,21,75,47],[29,54,24,19,55,25],[11,45,15,46,46,16]],
  /* 34 */ [[13,145,115,6,146,116],[14,74,46,23,75,47],[44,54,24,7,55,25],[59,46,16,1,47,17]],
  /* 35 */ [[12,151,121,7,152,122],[12,75,47,26,76,48],[39,54,24,14,55,25],[22,45,15,41,46,16]],
  /* 36 */ [[6,151,121,14,152,122],[6,75,47,34,76,48],[46,54,24,10,55,25],[2,45,15,64,46,16]],
  /* 37 */ [[17,152,122,4,153,123],[29,74,46,14,75,47],[49,54,24,10,55,25],[24,45,15,46,46,16]],
  /* 38 */ [[4,152,122,18,153,123],[13,74,46,32,75,47],[48,54,24,14,55,25],[42,45,15,32,46,16]],
  /* 39 */ [[20,147,117,4,148,118],[40,75,47,7,76,48],[43,54,24,22,55,25],[10,45,15,67,46,16]],
  /* 40 */ [[19,148,118,6,149,119],[18,75,47,31,76,48],[34,54,24,34,55,25],[20,45,15,61,46,16]]
];

export const LEVELS = ['L', 'M', 'Q', 'H'];
const LEVEL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0,
];

function bch(data, gen, genBits, shift) {
  let d = data << shift;
  const top = (x) => 31 - Math.clz32(x);
  while (d && top(d) >= genBits - 1) d ^= gen << (top(d) - (genBits - 1));
  return (data << shift) | d;
}
const formatBits = (level, mask) => bch((LEVEL_BITS[level] << 3) | mask, 0b10100110111, 11, 10) ^ 0b101010000010010;
const versionBits = (version) => bch(version, 0b1111100100101, 13, 12);

export function blocksFor(version, level) {
  const row = RS_BLOCKS[version - 1][LEVELS.indexOf(level)];
  const blocks = [];
  for (let i = 0; i < row.length; i += 3) {
    for (let k = 0; k < row[i]; k++) blocks.push({ data: row[i + 2], ec: row[i + 1] - row[i + 2] });
  }
  return blocks;
}

const countBits = (version) => (version < 10 ? 8 : 16);

/** Bits needed for the text in byte mode, incl. terminator and byte alignment. */
export function fixedBits(bytes, version, capacityBits) {
  const used = 4 + countBits(version) + 8 * bytes.length;
  const term = Math.min(4, capacityBits - used);
  return Math.ceil((used + term) / 8) * 8;
}

export function minVersion(bytes, level) {
  for (let v = 1; v <= 40; v++) {
    const cap = blocksFor(v, level).reduce((s, b) => s + b.data, 0) * 8;
    if (4 + countBits(v) + 8 * bytes.length <= cap) return v;
  }
  throw new Error('Text is too long for a QR code at this error-correction level.');
}

/**
 * Module skeleton for a version: function patterns with their values, and
 * the data-module positions in placement order (the standard zigzag).
 */
export function skeleton(version) {
  const n = 17 + 4 * version;
  const fn = Array.from({ length: n }, () => new Array(n).fill(null)); // null = data module
  const kind = Array.from({ length: n }, () => new Array(n).fill(null));
  const set = (r, c, v, k) => {
    fn[r][c] = v;
    kind[r][c] = k;
  };
  for (const [r0, c0] of [[0, 0], [n - 7, 0], [0, n - 7]]) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const R = r0 + r;
        const C = c0 + c;
        if (R < 0 || C < 0 || R >= n || C >= n) continue;
        const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) || (c >= 0 && c <= 6 && (r === 0 || r === 6))
          || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(R, C, dark, r < 0 || r > 6 || c < 0 || c > 6 ? 'separator' : 'finder');
      }
    }
  }
  const centers = alignmentCenters(version);
  for (const r of centers) {
    for (const c of centers) {
      if (fn[r][c] !== null) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          set(r + dr, c + dc, Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0), 'alignment');
        }
      }
    }
  }
  for (let i = 8; i < n - 8; i++) {
    if (fn[i][6] === null) set(i, 6, i % 2 === 0, 'timing');
    if (fn[6][i] === null) set(6, i, i % 2 === 0, 'timing');
  }
  // Reserve format (and version) areas; values are written per mask later.
  for (let i = 0; i < 9; i++) {
    if (fn[i][8] === null) set(i, 8, false, 'format');
    if (fn[8][i] === null) set(8, i, false, 'format');
  }
  for (let i = 0; i < 8; i++) {
    set(n - 1 - i, 8, false, 'format');
    set(8, n - 1 - i, false, 'format');
  }
  set(n - 8, 8, true, 'format'); // the always-dark module
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const v = ((bits >> i) & 1) === 1;
      set(Math.floor(i / 3), (i % 3) + n - 11, v, 'version');
      set((i % 3) + n - 11, Math.floor(i / 3), v, 'version');
    }
  }
  const order = [];
  let up = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let k = 0; k < n; k++) {
      const row = up ? n - 1 - k : k;
      for (let c = 0; c < 2; c++) if (fn[row][col - c] === null) order.push([row, col - c]);
    }
    up = !up;
  }
  return { n, fn, kind, order };
}

function writeFormat(fn, n, level, mask) {
  const bits = formatBits(level, mask);
  for (let i = 0; i < 15; i++) {
    const v = ((bits >> i) & 1) === 1;
    if (i < 6) fn[i][8] = v;
    else if (i < 8) fn[i + 1][8] = v;
    else fn[n - 15 + i][8] = v;
    if (i < 8) fn[8][n - i - 1] = v;
    else if (i < 9) fn[8][15 - i] = v;
    else fn[8][15 - i - 1] = v;
  }
  fn[n - 8][8] = true;
}

// --- GF(2) bitsets ---------------------------------------------------------
const words = (bits) => Math.ceil(bits / 32);
const getBit = (a, i) => (a[i >> 5] >>> (i & 31)) & 1;
const flipBit = (a, i) => { a[i >> 5] ^= 1 << (i & 31); };
const xorInto = (a, b) => { for (let i = 0; i < a.length; i++) a[i] ^= b[i]; };
const lowestBit = (a) => {
  for (let w = 0; w < a.length; w++) if (a[w]) return w * 32 + (31 - Math.clz32(a[w] & -a[w]));
  return -1;
};

/**
 * Build an art QR.
 * @param {Uint8Array} bytes  the text (UTF-8)
 * @param {object} o
 * @param {number} o.version
 * @param {'L'|'M'|'Q'|'H'} o.level
 * @param {(row, col) => {dark: boolean, weight: number}} o.target  wished-for look
 * @param {number} [o.burn]   fraction (0..1) of each block's correction capacity to spend
 * @param {number|null} [o.mask]  force a mask; default tries all 8, keeps the best match
 * Returns { n, version, level, mask, modules, kind, burned, controlled, stats }.
 *   modules[r][c]: value to draw (burned modules show the picture, not the code)
 *   kind[r][c]: function-pattern kind or null for data
 */
export function buildArtQr(bytes, o) {
  const { version, level } = o;
  const burn = o.burn ?? 0;
  const sk = skeleton(version);
  const { n, order } = sk;
  const blocks = blocksFor(version, level);
  const dataTotal = blocks.reduce((s, b) => s + b.data, 0);
  const fixed = fixedBits(bytes, version, dataTotal * 8);
  if (4 + countBits(version) + 8 * bytes.length > dataTotal * 8) {
    throw new Error(`Text does not fit version ${version}-${level}.`);
  }

  // Fixed part of the data stream (free bits left as 0 for now).
  const data = new Uint8Array(dataTotal);
  let bit = 0;
  const put = (value, len) => {
    for (let i = len - 1; i >= 0; i--, bit++) if ((value >> i) & 1) data[bit >> 3] |= 0x80 >> (bit & 7);
  };
  put(0b0100, 4);
  put(bytes.length, countBits(version));
  for (const b of bytes) put(b, 8);

  // Interleaving: global codeword index -> (block, offset).
  const blockOf = [];
  let off = 0;
  blocks.forEach((b, bi) => {
    b.start = off;
    for (let k = 0; k < b.data; k++) blockOf.push([bi, k]);
    off += b.data;
  });
  const maxData = Math.max(...blocks.map((b) => b.data));
  const maxEc = Math.max(...blocks.map((b) => b.ec));
  const stream = []; // [block, byte index within block codeword]
  for (let k = 0; k < maxData; k++) blocks.forEach((b, bi) => { if (k < b.data) stream.push([bi, k]); });
  for (let k = 0; k < maxEc; k++) blocks.forEach((b, bi) => { if (k < b.ec) stream.push([bi, b.data + k]); });

  // Module -> (block, codeword bit) for every data module.
  const where = new Map();
  order.forEach(([r, c], i) => {
    const byte = i >> 3;
    if (byte < stream.length) {
      const [bi, k] = stream[byte];
      where.set(r * n + c, [bi, k * 8 + (i & 7)]);
    }
  });

  // Per block: free variables and their effect on the block codeword.
  const sys = blocks.map((b, bi) => {
    const free = [];
    for (let k = 0; k < b.data; k++) {
      for (let j = 0; j < 8; j++) if ((b.start + k) * 8 + j >= fixed) free.push(k * 8 + j);
    }
    const cwBits = (b.data + b.ec) * 8;
    // cols[p]: which free variables flip codeword bit p.
    const cols = Array.from({ length: cwBits }, () => new Uint32Array(words(free.length)));
    free.forEach((fbit, v) => {
      const unit = new Uint8Array(b.data);
      unit[fbit >> 3] = 0x80 >> (fbit & 7);
      const cw = rsEncode(unit, b.ec);
      for (let p = 0; p < cwBits; p++) if ((cw[p >> 3] >> (7 - (p & 7))) & 1) flipBit(cols[p], v);
    });
    const base = rsEncode(data.slice(b.start, b.start + b.data), b.ec);
    return { b, bi, free, cols, base };
  });

  // Target, with weights, for every data module.
  const wish = order.filter(([r, c]) => where.has(r * n + c)).map(([r, c]) => {
    const t = o.target(r, c);
    return { r, c, dark: t.dark, weight: t.weight };
  });
  const ranked = [...wish].sort((a, b) => b.weight - a.weight);

  const solveFor = (mask) => {
    const maskAt = (r, c) => MASKS[mask](r, c);
    const result = sys.map(({ free, cols, base }) => ({ rows: [], pivots: [], free, cols, base }));
    const controlled = new Set();
    for (const m of ranked) {
      const [bi, p] = where.get(m.r * n + m.c);
      const s = result[bi];
      if (s.rows.length === s.free.length) continue; // block is fully determined
      const row = Uint32Array.from(s.cols[p]);
      let rhs = (m.dark ? 1 : 0) ^ (maskAt(m.r, m.c) ? 1 : 0) ^ ((s.base[p >> 3] >> (7 - (p & 7))) & 1);
      for (let i = 0; i < s.rows.length; i++) {
        if (getBit(row, s.pivots[i])) {
          xorInto(row, s.rows[i].bits);
          rhs ^= s.rows[i].rhs;
        }
      }
      const piv = lowestBit(row);
      if (piv < 0) continue; // already determined by earlier choices
      for (const other of s.rows) {
        if (getBit(other.bits, piv)) {
          xorInto(other.bits, row);
          other.rhs ^= rhs;
        }
      }
      s.rows.push({ bits: row, rhs });
      s.pivots.push(piv);
      controlled.add(m.r * n + m.c);
    }
    // Solve (free non-pivot variables = 0) and assemble codewords.
    const codewords = result.map((s, bi) => {
      const x = new Uint8Array(s.free.length);
      s.rows.forEach((row, i) => { x[s.pivots[i]] = row.rhs; });
      const msg = data.slice(blocks[bi].start, blocks[bi].start + blocks[bi].data);
      s.free.forEach((fbit, v) => { if (x[v]) msg[fbit >> 3] |= 0x80 >> (fbit & 7); });
      return rsEncode(msg, blocks[bi].ec);
    });
    // Lay out the true code.
    const fn = sk.fn.map((row) => row.slice());
    writeFormat(fn, n, level, mask);
    const modules = fn.map((row) => row.slice());
    order.forEach(([r, c], i) => {
      const loc = where.get(r * n + c);
      const v = loc ? ((codewords[loc[0]][loc[1] >> 3] >> (7 - (loc[1] & 7))) & 1) === 1 : false;
      modules[r][c] = v !== maskAt(r, c);
    });
    // Burn: per block, force the worst-matching codewords to the picture.
    const burned = new Set();
    const cwModules = new Map(); // "block,byte" -> [{r, c, wish}]
    for (const m of wish) {
      const [bi, p] = where.get(m.r * n + m.c);
      const key = `${bi},${p >> 3}`;
      if (!cwModules.has(key)) cwModules.set(key, []);
      cwModules.get(key).push(m);
    }
    let burnedCodewords = 0;
    blocks.forEach((b, bi) => {
      const budget = Math.floor(burn * Math.floor(b.ec / 2));
      if (!budget) return;
      const scored = [];
      for (let k = 0; k < b.data + b.ec; k++) {
        const ms = cwModules.get(`${bi},${k}`) || [];
        const gain = ms.reduce((s, m) => s + (modules[m.r][m.c] !== m.dark ? m.weight : 0), 0);
        if (gain > 0) scored.push({ ms, gain });
      }
      scored.sort((a, b2) => b2.gain - a.gain);
      for (const { ms } of scored.slice(0, budget)) {
        burnedCodewords++;
        for (const m of ms) {
          if (modules[m.r][m.c] !== m.dark) burned.add(m.r * n + m.c);
          modules[m.r][m.c] = m.dark;
        }
      }
    });
    let score = 0;
    let total = 0;
    for (const m of wish) {
      total += m.weight;
      if (modules[m.r][m.c] === m.dark) score += m.weight;
    }
    return { mask, modules, controlled, burned, burnedCodewords, match: score / total };
  };

  const masks = o.mask == null ? [0, 1, 2, 3, 4, 5, 6, 7] : [o.mask];
  let best = null;
  for (const mask of masks) {
    const r = solveFor(mask);
    if (!best || r.match > best.match) best = r;
  }
  const capacity = blocks.reduce((s, b) => s + Math.floor(b.ec / 2), 0);
  const freeBits = sys.reduce((s, x) => s + x.free.length, 0);
  return {
    n,
    version,
    level,
    mask: best.mask,
    modules: best.modules,
    kind: sk.kind,
    controlled: best.controlled,
    burned: best.burned,
    stats: {
      match: best.match,
      freeBits,
      controlled: best.controlled.size,
      burnedCodewords: best.burnedCodewords,
      correctable: capacity,
      blocks: blocks.length,
    },
  };
}
