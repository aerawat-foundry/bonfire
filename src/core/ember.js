// Ember layer: the "random" fire particles above the QR, as a reversible code.
//
// Convention v1 (see SPEC.md). Module units, y grows downward, QR at [0, N):
//  * The ember lattice shares the QR's module grid. It begins above the QR's
//    4-module quiet zone (first row y = -5) and is N + 8 rows tall.
//  * A fixed, size-dependent plume shape picks the lattice cells that carry
//    data. Everything else drawn above the QR is decoration decoders ignore.
//  * Data cells, taken row by row, are grouped into runs of 8 neighbours; the
//    runs are shuffled in a fixed order. Each run holds one codeword byte
//    (MSB first), XORed with a fixed whitening stream, one bit per cell:
//    1 = a dark ember covers the cell centre, 0 = the centre stays light.
//    Keeping a byte's bits together means local damage hits few bytes.
//  * Codeword = Reed-Solomon of
//    [0xB1, length, payload, SHA-256(payload)[0..1], 0xEC/0x11 padding],
//    half of it parity. The 2-byte digest rejects RS miscorrections.

import { Stream, utf8 } from './prng.js';
import { sha256 } from './sha256.js';
import { rsEncode, rsDecode } from './rs.js';

export const QUIET = 4;
const MAGIC = 0xb1;
const PAD = [0xec, 0x11];

export const rowCount = (n) => n + 8;

/** Per-row plume geometry: { y, cx, hw, keep }. */
export function plumeRows(n) {
  const h = rowCount(n);
  const s = new Stream(`bonfire/v1/plume/${n}`);
  const out = [];
  for (let r = 0; r < h; r++) {
    const t = r / (h - 1);
    const cx = n / 2 + 0.1 * n * Math.sin(2.4 * Math.PI * t) * t;
    const hw = (n / 2) * (0.92 + 0.6 * Math.sin(0.85 * Math.PI * t)) + (s.random() - 0.5) * 2;
    const keep = 0.95 - 0.7 * Math.pow(t, 1.3);
    out.push({ y: -(QUIET + 1) - r, cx, hw, keep });
  }
  return out;
}

const layoutCache = new Map();

/** Data cells [x, y] for an N x N QR, in bit order (8 cells per byte). */
export function layout(n) {
  if (layoutCache.has(n)) return layoutCache.get(n);
  const s = new Stream(`bonfire/v1/layout/${n}`);
  const cells = [];
  for (const { y, cx, hw, keep } of plumeRows(n)) {
    for (let x = Math.floor(cx - hw); x < Math.ceil(cx + hw); x++) {
      const d = Math.abs(x + 0.5 - cx) / hw;
      const u = s.random();
      if (d <= 1 && u < keep * (1 - 0.65 * d ** 3)) cells.push([x, y]);
    }
  }
  const groups = Math.floor(cells.length / 8);
  const order = new Stream(`bonfire/v1/order/${n}`).shuffle([...Array(groups).keys()]);
  const result = order.flatMap((g) => cells.slice(g * 8, g * 8 + 8)).concat(cells.slice(groups * 8));
  layoutCache.set(n, result);
  return result;
}

/** { total, nsym, maxPayload } in bytes for an N x N QR. */
export function capacity(n) {
  const total = Math.min(255, Math.floor(layout(n).length / 8));
  const nsym = Math.floor(total / 2);
  return { total, nsym, maxPayload: total - nsym - 4 };
}

function whitening(count) {
  const ks = new Stream('bonfire/v1/whiten').bytes(Math.ceil(count / 8));
  return Array.from({ length: count }, (_, i) => (ks[i >> 3] >> (7 - (i & 7))) & 1);
}

/** Map payload to a Map("x,y" -> bit) over every data cell. */
export function encodeEmbers(n, payload) {
  const bytes = typeof payload === 'string' ? utf8(payload) : payload;
  const { total, nsym, maxPayload } = capacity(n);
  if (bytes.length > maxPayload) {
    throw new Error(`Ember text is ${bytes.length} bytes; this fire holds ${maxPayload}.`);
  }
  const digest = sha256(bytes);
  const data = [MAGIC, bytes.length, ...bytes, digest[0], digest[1]];
  for (let i = 0; data.length < total - nsym; i++) data.push(PAD[i % 2]);
  const codeword = rsEncode(Uint8Array.from(data), nsym);
  const cells = layout(n);
  const white = whitening(cells.length);
  const bits = new Map();
  cells.forEach(([x, y], i) => {
    const b = i < total * 8 ? (codeword[i >> 3] >> (7 - (i & 7))) & 1 : 0;
    bits.set(`${x},${y}`, b ^ white[i]);
  });
  return bits;
}

/**
 * Recover the payload. readBit(x, y) -> { bit, confidence 0..1 }.
 * Returns { bytes, text, corrected }; throws if the fire cannot be read.
 */
export function decodeEmbers(n, readBit) {
  const { total, nsym } = capacity(n);
  const cells = layout(n);
  const white = whitening(cells.length);
  const codeword = new Uint8Array(total);
  const conf = new Array(total).fill(1);
  for (let i = 0; i < total * 8; i++) {
    const { bit, confidence } = readBit(...cells[i]);
    codeword[i >> 3] |= (bit ^ white[i]) << (7 - (i & 7));
    conf[i >> 3] = Math.min(conf[i >> 3], confidence);
  }
  // Retry with the least certain bytes marked as erasures: an erasure costs
  // half as much correction capacity as an unknown error.
  const shaky = [...conf.keys()].sort((a, b) => conf[a] - conf[b]);
  const attempts = [[]];
  for (const k of [nsym / 4, nsym / 2, (3 * nsym) / 4, nsym].map(Math.floor)) {
    if (k) attempts.push(shaky.slice(0, k));
  }
  let last;
  for (const erase of attempts) {
    try {
      const { message, corrected } = rsDecode(codeword, nsym, erase);
      const len = message[1];
      if (message[0] !== MAGIC || len > message.length - 4) throw new Error('header mismatch');
      const bytes = message.slice(2, 2 + len);
      const digest = sha256(bytes);
      if (message[2 + len] !== digest[0] || message[3 + len] !== digest[1]) throw new Error('checksum mismatch');
      return { bytes, text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), corrected };
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`Ember layer unreadable (${last.message}).`);
}
