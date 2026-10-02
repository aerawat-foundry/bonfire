// End to end: render -> rasterize (cairosvg + OpenCV warp/blur/noise) -> scan.
// Needs python3 with cairosvg, opencv-python-headless and numpy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import './zxing-node.js';
import { renderPoster } from '../src/core/render.js';
import { scanImage } from '../src/core/scan.js';
import { rasterize } from './helpers.js';

let haveRaster = true;
try {
  execFileSync('python3', ['-c', 'import cairosvg, cv2, numpy']);
} catch {
  haveRaster = false;
}

const CASES = [
  { width: 900 },
  { width: 520 },
  { warp: 0.05, blur: 1 },
  { warp: 0.08, blur: 1.5, noise: 6, rotate: 12 },
  { width: 480, warp: 0.07, blur: 1.2, noise: 8, rotate: -25 },
];
// At the edge of what's decodable (tiny, rotated, warped, blurred, noisy).
// A camera reads many frames, so this case is judged by its pass rate.
const EXTREME = { width: 440, warp: 0.1, blur: 1.4, noise: 10, rotate: 90 };

for (const text of ['https://this.side.of.tech', 'Hello ember', 'नमस्ते 🔥 ember']) {
  test(`scan: ${text}`, { skip: !haveRaster && 'python raster stack missing' }, async () => {
    const { svg, meta } = renderPoster(text);
    for (const c of CASES) {
      const r = await scanImage(rasterize(svg, c));
      assert.ok(r, `QR found ${JSON.stringify(c)}`);
      assert.equal(r.text, text);
      assert.ok(r.ember.ok, `ember read ${JSON.stringify(c)}: ${r.ember.error}`);
      assert.equal(r.ember.text, text);
      assert.equal(r.hotpoints.expected, meta.hotpoints.length);
      assert.ok(r.hotpoints.sealed, `hotpoints ${JSON.stringify(c)}`);
    }
    let read = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const r = await scanImage(rasterize(svg, { ...EXTREME, seed }));
      if (r?.text === text && r.ember.text === text) read++;
    }
    assert.ok(read >= 7, `extreme distortion read ${read}/8`);
  });
}

test('scan: hidden ember text differs from the QR', { skip: !haveRaster && 'python raster stack missing' }, async () => {
  const { svg } = renderPoster('https://this.side.of.tech', { emberText: 'edition 7/50' });
  const r = await scanImage(rasterize(svg, { width: 700, blur: 0.8 }));
  assert.equal(r.text, 'https://this.side.of.tech');
  assert.equal(r.ember.text, 'edition 7/50');
  assert.equal(r.ember.match, false);
});

test('scan: a plain black QR is read but not sealed', { skip: !haveRaster && 'python raster stack missing' }, async () => {
  // Flatten every colour to black or white: the reprint a forger would make.
  const flat = renderPoster('https://this.side.of.tech').svg.replace(/#([0-9a-f]{6})\b/gi, (_, h) => {
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return 0.299 * r + 0.587 * g + 0.114 * b < 128 ? '#000000' : '#ffffff';
  });
  const r = await scanImage(rasterize(flat, { width: 800 }));
  assert.equal(r.text, 'https://this.side.of.tech');
  assert.equal(r.hotpoints.sealed, false);
});

test('scan: standard QR readers see the code', { skip: !haveRaster && 'python raster stack missing' }, () => {
  const img = rasterize(renderPoster('https://this.side.of.tech').svg, { width: 600 });
  const out = execFileSync('python3', ['-c',
    `import cv2; print(cv2.QRCodeDetector().detectAndDecode(cv2.imread(${JSON.stringify(img.path)}))[0])`]).toString().trim();
  assert.equal(out, 'https://this.side.of.tech');
});

test('Ember QR posters scan as standard QR codes', { skip: !haveRaster && 'python raster stack missing' }, async () => {
  const { renderEmberQr } = await import('../src/core/emberqr.js');
  const text = 'https://this.side.of.tech';
  for (const opts of [{}, { level: 'M', version: 10 }, { level: 'H', burn: 0.6 }]) {
    const { svg } = renderEmberQr(text, { hideTiming: true, ...opts });
    for (const c of [{ width: 1100 }, { width: 600 }, { warp: 0.06, blur: 1.1, noise: 6, rotate: 10 }]) {
      const r = await scanImage(rasterize(svg, c), { ember: false });
      assert.equal(r?.text, text, `${JSON.stringify(opts)} ${JSON.stringify(c)}`);
    }
  }
});
