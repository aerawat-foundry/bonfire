import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from '../src/core/sha256.js';
import { Stream, utf8 } from '../src/core/prng.js';
import { rsEncode, rsDecode } from '../src/core/rs.js';
import { makeQr, functionMask } from '../src/core/qr.js';
import { layout, capacity, encodeEmbers, decodeEmbers } from '../src/core/ember.js';
import { selectHotpoints } from '../src/core/hotpoints.js';
import { renderPoster } from '../src/core/render.js';

test('sha256 matches node:crypto', () => {
  for (const s of ['', 'abc', 'x'.repeat(55), 'y'.repeat(64), 'नमस्ते 🔥'.repeat(20)]) {
    const want = createHash('sha256').update(s).digest('hex');
    assert.equal(Buffer.from(sha256(utf8(s))).toString('hex'), want);
  }
});

test('stream is deterministic and seed-dependent', () => {
  const a = new Stream('seed').bytes(100);
  assert.deepEqual(a, new Stream('seed').bytes(100));
  assert.notDeepEqual(a, new Stream('seed2').bytes(100));
  // Reading in pieces gives the same stream as reading at once.
  const s = new Stream('seed');
  assert.deepEqual(Uint8Array.from([...s.bytes(7), ...s.bytes(93)]), a);
});

test('reed-solomon corrects errors and erasures up to capacity', () => {
  const r = new Stream('rs-test');
  for (let t = 0; t < 200; t++) {
    const k = 5 + r.below(100);
    const nsym = 4 + r.below(60);
    const msg = r.bytes(k);
    const cw = rsEncode(msg, nsym);
    const n = cw.length;
    const erasures = r.below(Math.floor(nsym / 2) + 1);
    const errors = r.below(Math.floor((nsym - erasures) / 2) + 1);
    const pos = r.shuffle([...Array(n).keys()]);
    const bad = Uint8Array.from(cw);
    pos.slice(0, erasures).forEach((p) => (bad[p] = r.below(256)));
    pos.slice(erasures, erasures + errors).forEach((p) => (bad[p] ^= 1 + r.below(255)));
    assert.deepEqual(rsDecode(bad, nsym, pos.slice(0, erasures)).message, msg);
  }
});

test('reed-solomon encoding matches the standard (QR spec example)', () => {
  // ISO/IEC 18004 Annex I: "01234567" at version 1-M.
  const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
  const ecc = [165, 36, 212, 193, 237, 54, 199, 135, 44, 85];
  assert.deepEqual([...rsEncode(Uint8Array.from(data), 10).slice(16)], ecc);
});

test('function mask covers finders, timing and alignment', () => {
  const f = functionMask(7);
  for (const k of ['0,0', '8,8', '44,0', '0,44', '6,20', '20,6', '22,22', '36,2']) assert.ok(f.has(k), k);
  assert.ok(!f.has('14,14'));
});

test('ember layout is stable and inside the plume above the quiet zone', () => {
  const cells = layout(33);
  assert.deepEqual(cells, layout(33));
  assert.ok(cells.every(([, y]) => y <= -5));
  assert.equal(new Set(cells.map(([x, y]) => `${x},${y}`)).size, cells.length);
});

test('embers round-trip with scattered bit errors', () => {
  for (const text of ['hi', 'https://this.side.of.tech', 'नमस्ते 🔥 ember']) {
    const { size } = makeQr(text);
    const bits = encodeEmbers(size, text);
    const r = new Stream('flip');
    const flipped = new Set(r.shuffle([...bits.keys()]).slice(0, Math.floor(bits.size * 0.025)));
    const out = decodeEmbers(size, (x, y) => {
      const k = `${x},${y}`;
      return { bit: bits.get(k) ^ (flipped.has(k) ? 1 : 0), confidence: 1 };
    });
    assert.equal(out.text, text);
  }
});

test('embers survive a burnt-out patch of the plume', () => {
  const text = 'https://this.side.of.tech';
  const { size } = makeQr(text);
  const bits = encodeEmbers(size, text);
  // Blank a 9x9-module region in the middle of the plume (as if torn or smudged).
  const cx = size / 2;
  const cy = -5 - size / 2;
  const out = decodeEmbers(size, (x, y) => {
    const hit = Math.abs(x + 0.5 - cx) < 4.5 && Math.abs(y + 0.5 - cy) < 4.5;
    return hit ? { bit: 0, confidence: 0 } : { bit: bits.get(`${x},${y}`), confidence: 1 };
  });
  assert.equal(out.text, text);
});

test('ember payload over capacity is rejected', () => {
  const { maxPayload } = capacity(21);
  assert.throws(() => encodeEmbers(21, 'x'.repeat(maxPayload + 1)), /holds/);
});

test('hotpoints avoid function patterns and depend on the text', () => {
  const a = makeQr('alpha');
  const pa = selectHotpoints('alpha', a.version, a.matrix);
  const fn = functionMask(a.version);
  assert.ok(pa.length >= 5 && pa.length <= 8);
  for (const [x, y] of pa) {
    assert.ok(a.matrix[y][x], 'on a dark module');
    assert.ok(!fn.has(`${x},${y}`), 'not on a function pattern');
  }
  const b = makeQr('beta');
  assert.notDeepEqual(pa, selectHotpoints('beta', b.version, b.matrix));
});

test('rendering is deterministic per text', () => {
  assert.equal(renderPoster('same').svg, renderPoster('same').svg);
  assert.notEqual(renderPoster('same').svg, renderPoster('different').svg);
});
