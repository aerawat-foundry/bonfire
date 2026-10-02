// Ember scanner core. Works on raw RGBA pixels ({ data, width, height },
// e.g. canvas ImageData), so it runs the same in the browser and in Node.
//
// 1. Read the standard QR with ZXing (WebAssembly).
// 2. Refine ZXing's corner points to sub-module accuracy by matching the
//    known module pattern, then fit a homography (module space -> pixels).
// 3. Extend that grid upward into the plume and read every ember data cell.
// 4. Reed-Solomon decode the ember layer, trying a few small geometry
//    corrections, since the plume reaches well past the anchors.
// 5. Recompute the hotpoints from the text and check that they glow.

import { readBarcodes } from 'zxing-wasm/reader';
import { homography, apply, preAffine } from './homography.js';
import { makeQr, functionMask } from './qr.js';
import { layout, decodeEmbers } from './ember.js';
import { selectHotpoints } from './hotpoints.js';

const median = (a) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  return s[s.length >> 1];
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const BAND = 8;

/** Two-class split of luminance samples: { thr, range } or null. */
function otsu(values) {
  const v = values.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
  if (v.length < 8) return null;
  const total = v.reduce((a, b) => a + b, 0);
  let best = null;
  let sumLow = 0;
  for (let i = 1; i < v.length; i++) {
    sumLow += v[i - 1];
    const w0 = i / v.length;
    const m0 = sumLow / i;
    const m1 = (total - sumLow) / (v.length - i);
    const between = w0 * (1 - w0) * (m1 - m0) ** 2;
    if (!best || between > best.between) best = { between, thr: (v[i - 1] + v[i]) / 2, range: m1 - m0 };
  }
  return best && best.range > 1 ? best : null;
}

function luminance({ data, width, height }) {
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    g[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
  }
  return g;
}

function makeSampler(img) {
  const { width, height, data } = img;
  const gray = luminance(img);
  const at = (x, y) => {
    // pixel centres sit at +0.5
    x = clamp(x - 0.5, 0, width - 1.001);
    y = clamp(y - 0.5, 0, height - 1.001);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * width + x0;
    return (
      gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) +
      gray[i + width] * (1 - fx) * fy + gray[i + width + 1] * fx * fy
    );
  };
  const inside = (p) => p.x >= 0 && p.y >= 0 && p.x < width && p.y < height;
  const SPOT = [[0, 0], [0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14]];
  return {
    point(H, u, v) {
      const p = apply(H, u, v);
      return inside(p) ? at(p.x, p.y) : NaN;
    },
    /** Mean luminance of a small spot around module-space (u, v); NaN off-image. */
    spot(H, u, v) {
      let sum = 0;
      for (const [du, dv] of SPOT) {
        const p = apply(H, u + du, v + dv);
        if (!inside(p)) return NaN;
        sum += at(p.x, p.y);
      }
      return sum / SPOT.length;
    },
    /** Mean [r, g, b] of a small spot around (u, v). */
    rgb(H, u, v) {
      const acc = [0, 0, 0];
      for (const [du, dv] of SPOT) {
        const p = apply(H, u + du * 0.6, v + dv * 0.6);
        if (!inside(p)) return [NaN, NaN, NaN];
        const i = (Math.floor(p.y) * width + Math.floor(p.x)) * 4;
        acc[0] += data[i];
        acc[1] += data[i + 1];
        acc[2] += data[i + 2];
      }
      return acc.map((c) => c / SPOT.length);
    },
  };
}

/**
 * Shift each anchor window (in module space) until the image best matches
 * the known module pattern there, then refit the homography to the shifted
 * anchors. Returns the refined H.
 */
function refine(H, sampler, isDark, n, thr, range) {
  const W = 4.5; // window half-size in modules
  const STEP = 0.25;
  const anchors = [
    [4.5, 4.5], [n - 4.5, 4.5], [n - 4.5, n - 4.5], [4.5, n - 4.5],
    [n / 2, 4.5], [n / 2, n / 2], [4.5, n / 2], [n - 4.5, n / 2],
  ];
  const score = (cu, cv, du, dv) => {
    let s = 0;
    for (let v = cv - W + STEP / 2; v < cv + W; v += STEP) {
      for (let u = cu - W + STEP / 2; u < cu + W; u += STEP) {
        const x = Math.floor(u);
        const y = Math.floor(v);
        const dark = x >= 0 && y >= 0 && x < n && y < n && isDark(x, y);
        const l = sampler.point(H, u + du, v + dv);
        if (Number.isNaN(l)) continue;
        const ink = clamp((thr - l) / (range / 2), -1, 1);
        s += dark ? ink : -ink;
      }
    }
    return s;
  };
  const src = [];
  const dst = [];
  for (const [cu, cv] of anchors) {
    let best = { s: -Infinity, du: 0, dv: 0 };
    for (const span of [[0.75, 0.125], [0.125, 0.03125]]) {
      const [reach, step] = span;
      const c = { ...best };
      for (let dv = c.dv - reach; dv <= c.dv + reach + 1e-9; dv += step) {
        for (let du = c.du - reach; du <= c.du + reach + 1e-9; du += step) {
          const s = score(cu, cv, du, dv);
          if (s > best.s) best = { s, du, dv };
        }
      }
    }
    src.push({ x: cu, y: cv });
    dst.push(apply(H, cu + best.du, cv + best.dv));
  }
  return homography(src, dst);
}

// Geometry corrections tried when the ember layer does not decode at first:
// vertical stretch and shear of the module grid, which small anchor errors
// (or lens bulge) amplify over the plume's height.
const CORRECTIONS = [[0, 0]];
for (const sy of [0, 0.006, -0.006, 0.012, -0.012, 0.02, -0.02]) {
  for (const sh of [0, 0.006, -0.006, 0.012, -0.012]) if (sy || sh) CORRECTIONS.push([sy, sh]);
}

/**
 * Scan an image. Resolves to null when no QR is found.
 *
 * With `ember: false` (standard mode) only the QR is read and the result is
 * { mode: 'standard', text, version, size, quad }. Otherwise (ember mode):
 * {
 *   mode: 'ember',
 *   text, version, size,
 *   quad: [4 pixel corners of the QR],
 *   ember: { ok, text?, corrected?, match?, error? },
 *   hotpoints: { expected, hot, sealed, points: [{x, y, heat}] },
 *   cells: [{ x, y, px, py, ink }]   ember cells projected into the image,
 *   soft: Map(cell -> signed ink) for accumulating evidence across frames,
 *   decodeSoft(soft) -> ember result,
 * }
 */
export async function scanImage(img, { tryHarder = true, ember: readEmbers = true } = {}) {
  const results = await readBarcodes(img, {
    formats: ['QRCode'],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  const code = results.find((r) => r.isValid);
  if (!code) return null;

  const text = code.text;
  const n = code.symbol?.width || 17 + 4 * Number(code.version);
  const version = (n - 17) / 4;
  const { topLeft, topRight, bottomRight, bottomLeft } = code.position;
  let H = homography(
    [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }],
    [topLeft, topRight, bottomRight, bottomLeft],
  );
  if (!readEmbers) {
    const quad = [topLeft, topRight, bottomRight, bottomLeft].map(({ x, y }) => ({ x, y }));
    return { mode: 'standard', text, version, size: n, quad };
  }
  const sampler = makeSampler(img);

  // The module pattern: regenerated from the text when it matches what ZXing
  // saw (error-free), otherwise ZXing's own sampled symbol.
  const sym = code.symbol;
  // zxing-wasm symbols are n x n, 0 = black, 255 = white, no quiet zone.
  const symDark = (x, y) => sym.data[y * sym.width + x] < 128;
  let matrix = null;
  try {
    const qr = makeQr(text);
    if (qr.size === n && sym?.width === n) {
      let same = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.matrix[y][x] === symDark(x, y)) same++;
      if (same / (n * n) > 0.9) matrix = qr.matrix;
    } else if (qr.size === n) {
      matrix = qr.matrix;
    }
  } catch { /* text not re-encodable as our QR */ }
  if (!matrix && sym?.width !== n) return null;
  const isDark = matrix ? (x, y) => matrix[y][x] : symDark;

  const calibrate = (Hc) => {
    const darks = [];
    const lights = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = sampler.spot(Hc, x + 0.5, y + 0.5);
        if (!Number.isNaN(v)) (isDark(x, y) ? darks : lights).push(v);
      }
    const ink = median(darks);
    const paper = median(lights);
    return { thr: (ink + paper) / 2, range: Math.max(paper - ink, 1) };
  };
  let { thr, range } = calibrate(H);
  H = refine(H, sampler, isDark, n, thr, range);
  H = refine(H, sampler, isDark, n, thr, range);
  ({ thr, range } = calibrate(H));

  // Read the ember field band by band (8 rows each), walking up from the QR.
  // Each band gets its own small grid offset (the one that makes its cells
  // read most decisively: ember centres are inked, empty centres are bare)
  // and its own ink/paper threshold, which absorbs blur and uneven light.
  const bands = new Map();
  for (const [x, y] of layout(n)) {
    const b = Math.floor((-y - 5) / BAND);
    if (!bands.has(b)) bands.set(b, []);
    bands.get(b).push([x, y]);
  }
  const bandOrder = [...bands.keys()].sort((a, b) => a - b);
  const readCells = (Hc) => {
    const soft = new Map();
    let off = [0, 0];
    for (const b of bandOrder) {
      const cells = bands.get(b);
      let best = null;
      const reach = b === bandOrder[0] ? 0.12 : 0.24;
      for (let dv = -reach; dv <= reach + 1e-9; dv += 0.06) {
        for (let du = -reach; du <= reach + 1e-9; du += 0.06) {
          const o = [off[0] + du, off[1] + dv];
          const vals = cells.map(([x, y]) => sampler.spot(Hc, x + 0.5 + o[0], y + 0.5 + o[1]));
          const split = otsu(vals);
          if (!split) continue;
          // Decisiveness: mean distance from the threshold, in contrast units.
          let q = 0;
          for (const v of vals) if (!Number.isNaN(v)) q += Math.min(1, Math.abs(v - split.thr) / (split.range / 2));
          q = q / vals.length - 0.02 * Math.hypot(du, dv); // prefer staying put
          if (!best || q > best.q) best = { q, o, vals, split };
        }
      }
      if (!best) continue;
      off = best.o;
      // Fall back to the QR's calibration if the band shows no real contrast.
      const { thr: t, range: rg } = best.split.range > range * 0.3 ? best.split : { thr, range };
      cells.forEach(([x, y], i) => {
        const v = best.vals[i];
        soft.set(`${x},${y}`, Number.isNaN(v) ? 0 : clamp((t - v) / (rg / 2), -1.5, 1.5));
      });
    }
    return soft;
  };
  const decodeSoft = (soft) => {
    const r = decodeEmbers(n, (x, y) => {
      const s = soft.get(`${x},${y}`) ?? 0;
      return { bit: s > 0 ? 1 : 0, confidence: Math.min(1, Math.abs(s)) };
    });
    return { ok: true, text: r.text, corrected: r.corrected, match: r.text === text };
  };

  const soft = readCells(H);
  let ember = { ok: false };
  let usedH = H;
  let usedSoft = soft;
  const mid = n / 2;
  for (const [sy, sh] of tryHarder ? CORRECTIONS : CORRECTIONS.slice(0, 1)) {
    const Hc = sy || sh ? preAffine(H, [1, sh, -sh * mid, 0, 1 + sy, -sy * mid]) : H;
    const s = Hc === H ? soft : readCells(Hc);
    try {
      ember = decodeSoft(s);
      usedH = Hc;
      usedSoft = s;
      break;
    } catch (e) {
      ember = { ok: false, error: e.message };
    }
  }

  // Hotpoints: recompute where they must be, then look for the heat.
  let hotpoints = { expected: 0, hot: 0, sealed: false, points: [] };
  if (matrix) {
    const expected = selectHotpoints(text, version, matrix);
    const hotKeys = new Set(expected.map(([x, y]) => `${x},${y}`));
    const fn = functionMask(version);
    const heat = (x, y) => {
      const [r, , b] = sampler.rgb(H, x + 0.5, y + 0.5);
      return (r - b) / range;
    };
    const base = [];
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (matrix[y][x] && !fn.has(`${x},${y}`) && !hotKeys.has(`${x},${y}`)) base.push(heat(x, y));
    const baseline = median(base);
    const points = expected.map(([x, y]) => {
      const p = apply(H, x + 0.5, y + 0.5);
      return { x, y, px: p.x, py: p.y, heat: heat(x, y) - baseline };
    });
    const hot = points.filter((p) => p.heat > 0.25).length;
    hotpoints = { expected: expected.length, hot, sealed: hot >= Math.ceil(expected.length * 0.7), points };
  }

  const cells = layout(n).map(([x, y]) => {
    const p = apply(usedH, x + 0.5, y + 0.5);
    return { x, y, px: p.x, py: p.y, ink: usedSoft.get(`${x},${y}`) };
  });
  const quad = [[0, 0], [n, 0], [n, n], [0, n]].map(([x, y]) => apply(H, x, y));
  return { mode: 'ember', text, version, size: n, quad, ember, hotpoints, cells, soft, decodeSoft };
}
