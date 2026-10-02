// Art QR encoder: whatever picture it is asked to draw, the result must stay
// a valid standard QR. Decoded with ZXing (WebAssembly) from a clean raster.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './zxing-node.js';
import { readBarcodes } from 'zxing-wasm/reader';
import { buildArtQr, minVersion } from '../src/core/artqr.js';
import { renderFireQr } from '../src/core/fireart.js';
import { Stream } from '../src/core/prng.js';

function raster(modules, scale = 5) {
  const n = modules.length;
  const q = 4;
  const W = (n + 2 * q) * scale;
  const data = new Uint8ClampedArray(W * W * 4).fill(255);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!modules[r][c]) continue;
      for (let y = 0; y < scale; y++) {
        for (let x = 0; x < scale; x++) {
          const i = (((r + q) * scale + y) * W + (c + q) * scale + x) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: W, height: W };
}

const read = async (modules) =>
  (await readBarcodes(raster(modules), { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 }))[0];

test('art QR decodes for any picture, level, size, mask and burn', async () => {
  const rnd = new Stream('artqr-test');
  for (const text of ['Hi', 'https://this.side.of.tech', 'नमस्ते 🔥 ember, a longer line of text']) {
    const bytes = new TextEncoder().encode(text);
    for (const level of ['L', 'M', 'Q', 'H']) {
      const v0 = minVersion(bytes, level);
      for (const version of [v0, v0 + 6]) { // v0 + 6 crosses into version-info sizes (7+)
        for (const burn of [0, 0.9]) {
          const seed = rnd.uint32();
          const target = (r, c) => {
            const h = Math.imul(r * 7919 + c * 104729 + seed, 2654435761) >>> 0;
            return { dark: (h & 1) === 1, weight: (h >>> 8) / 2 ** 24 };
          };
          const q = buildArtQr(bytes, { version, level, target, burn, mask: rnd.below(8) });
          const r = await read(q.modules);
          assert.equal(r?.text, text, `${level} v${version} burn ${burn} mask ${q.mask}`);
          assert.equal(Number(r.version), version);
        }
      }
    }
  }
});

test('free bits steer modules with zero errors', async () => {
  const bytes = new TextEncoder().encode('https://this.side.of.tech');
  // Ask for an all-light picture: every steered module must come out light.
  const q = buildArtQr(bytes, { version: 12, level: 'Q', target: () => ({ dark: false, weight: 1 }), burn: 0 });
  assert.ok(q.stats.controlled > 1000);
  for (const key of q.controlled) assert.equal(q.modules[Math.floor(key / q.n)][key % q.n], false);
  assert.equal((await read(q.modules))?.text, 'https://this.side.of.tech');
});

test('burn never exceeds the share of the repair budget asked for', () => {
  const bytes = new TextEncoder().encode('https://this.side.of.tech');
  const target = (r, c) => ({ dark: (r * 31 + c * 17) % 3 === 0, weight: 1 });
  for (const burn of [0, 0.25, 0.5, 0.8]) {
    const q = buildArtQr(bytes, { version: 10, level: 'M', target, burn });
    assert.ok(q.stats.burnedCodewords <= Math.floor(burn * q.stats.correctable) + q.stats.blocks);
  }
});

test('fire QR rendering is deterministic per text and settings', () => {
  const a = renderFireQr('same', { version: 8 }).svg;
  assert.equal(a, renderFireQr('same', { version: 8 }).svg);
  assert.notEqual(a, renderFireQr('different', { version: 8 }).svg);
});
