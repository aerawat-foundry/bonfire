// Ember QR: a standard QR drawn as a column of grid cells opening into a plume
// of embers, in the style of the reference poster. The picture is carved into
// the code with artqr.js (free bits + a chosen share of the error budget); the
// renderer then draws each module according to where it sits in the plume.
//
// One SVG unit = one QR module. Every random-looking choice comes from a
// stream seeded by the text, so the same settings always burn the same way.

import { Stream, utf8 } from './prng.js';
import { sha256 } from './sha256.js';
import { buildArtQr, minVersion } from './artqr.js';
import { captions, captionHeightPerWidth, MARGINS, POSTER_RATIO } from './typography.js';

const QUIET = 4;
const PAPER = '#f7f4ee';
const GRID = '#d3c9bf';
const CHAR = [0x22, 0x19, 0x13];
const BURNT = [0x6e, 0x30, 0x10];
// Every dark mark stays below ~30% luminance so it always reads as "dark".
const EMBERS = ['#1d1510', '#2a1a11', '#3a1e0e', '#55260d', '#6e300e', '#83390f'];
const DUST = ['#2a1d16', '#3b2417', '#4a2a16', '#5a3018'];

const f = (v) => +v.toFixed(3);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hex = (rgb) => '#' + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);
const rect = (x, y, w, h, attrs) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${attrs}/>`;

/** Cheap deterministic hash noise in [0, 1). */
function noise(seed, x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263 + seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The ember shape inside the N x N code, in normalised coordinates
 * (u across, v down, both 0..1). Returns { zone, density, edge } where zone is
 * 'column' | 'plume' | 'outside', density is how much of the zone should be
 * dark, and edge (0..1) is how close the point is to the outline.
 */
function shapeFn(n, seed) {
  const colTop = 0.52; // where the column opens into the plume
  const colHalf = 0.115;
  const rows = [];
  for (let r = 0; r < n; r++) {
    const v = (r + 0.5) / n;
    const jag = (noise(seed, r, 7) - 0.5) * 0.05;
    let half;
    if (v >= colTop) {
      half = colHalf + Math.max(0, (colTop + 0.06 - v)) * 1.4; // flare into the plume
    } else {
      const t = (colTop - v) / colTop; // 0 at plume base .. 1 at top
      half = colHalf + 0.084 + 0.27 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.5) - 0.06 * t * t;
    }
    const sway = 0.03 * Math.sin(v * 9.5 + (seed % 7)) * (1 - v);
    rows.push({ v, half: half + jag, cx: 0.5 + sway });
  }
  return (r, c) => {
    const { v, half, cx } = rows[r];
    const u = (c + 0.5) / n;
    const d = Math.abs(u - cx) / half; // 0 at centre .. 1 at outline
    const edge = clamp(1 - Math.abs(1 - d) * 6, 0, 1);
    if (d > 1) return { zone: 'outside', density: 0, edge, d, v };
    if (v >= colTop + 0.04) {
      // column: sparse dark cells at the bottom, denser toward the top
      const t = (1 - v) / (1 - colTop);
      return { zone: 'column', density: 0.1 + 0.45 * t * t, edge, d, v };
    }
    // plume: densest at its base, dissolving upward and outward
    const t = clamp((colTop + 0.04 - v) / (colTop + 0.04), 0, 1);
    const density = 0.62 * (1 - t) ** 0.9 * (1 - 0.75 * d ** 2.2) + 0.05;
    return { zone: 'plume', density, edge, d, v };
  };
}

/**
 * Render an Ember QR poster.
 * @param {string} text
 * @param {object} [o]
 * @param {number} [o.version]  QR version (size); default: a roomy one for the text
 * @param {'L'|'M'|'Q'|'H'} [o.level]  error correction (default 'Q')
 * @param {number} [o.burn]   share of each block's correction budget spent on the picture (default 0.35)
 * @param {boolean} [o.xray]  overlay which modules were steered (teal) and burned (magenta)
 * @param {boolean} [o.caption]
 * @param {boolean} [o.blendAlignment]  draw alignment squares in the ember style
 *                  instead of solid (scanners locate them approximately anyway)
 * @param {boolean} [o.hideTiming]  leave the timing dots outside the plume undrawn
 */
export function renderEmberQr(text, o = {}) {
  if (!text) throw new Error('Enter some text to burn.');
  const bytes = utf8(text);
  const level = o.level ?? 'Q';
  const min = minVersion(bytes, level);
  const version = clamp(o.version ?? Math.max(min, 12), min, 40);
  const burn = o.burn ?? 0.35;
  const caption = o.caption ?? true;
  const seedBytes = sha256(new Uint8Array([...utf8('ember/qr/v1/'), ...bytes]));
  const seed = (seedBytes[0] << 24) | (seedBytes[1] << 16) | (seedBytes[2] << 8) | seedBytes[3];
  const art = new Stream(seedBytes);

  const n = 17 + 4 * version;
  const shape = shapeFn(n, seed);

  // What we wish each module looked like, and how much we care.
  const target = (r, c) => {
    const s = shape(r, c);
    const dark = s.zone !== 'outside' && noise(seed ^ 0x5bd1e995, c, r) < s.density;
    // Edges of the square (where the quiet zone would give the code away)
    // and the outline of the plume matter most; inner dithering least.
    const border = Math.min(r, c, n - 1 - r, n - 1 - c);
    let weight;
    if (s.zone === 'outside') weight = border < 4 ? 3 : 2 + s.edge * 0.5;
    else weight = 1 + s.edge;
    return { dark, weight: weight + noise(seed, r * 3 + 1, c * 5 + 2) * 0.4 };
  };

  const qr = buildArtQr(bytes, { version, level, target, burn });
  const { modules, kind } = qr;

  const flame = { x: n / 2, y: n + 3.2 };
  const heatAt = (x, y) => clamp(1 - Math.hypot((x - flame.x) * 1.6, y - flame.y) / (0.62 * n), 0, 1);

  const glow = [];
  const grid = [];
  const solid = [];

  // --- the code, drawn as embers -------------------------------------------------
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const s = shape(r, c);
      const k = kind[r][c];
      const dark = modules[r][c];
      const heat = heatAt(c + 0.5, r + 0.5);
      const jitter = () => art.uniform(-8, 8);

      if (k === 'timing' && dark && o.hideTiming && s.zone === 'outside') continue;
      if (k === 'finder' || (k === 'alignment' && !o.blendAlignment)) {
        // Scanners find these by their solid runs: keep them whole cells.
        if (dark) {
          const base = mix(CHAR, BURNT, heat ** 1.4);
          solid.push(rect(c, r, 1, 1, `fill="${hex(base.map((x) => x + jitter()))}"`));
          solid.push(rect(c + 0.07, r + 0.07, 0.86, 0.86, `fill="none" stroke="${hex(base.map((x) => x + 30))}" stroke-width="0.05"`));
        } else if (s.zone !== 'outside') {
          grid.push(rect(c + 0.05, r + 0.05, 0.9, 0.9, `fill="none" stroke="${GRID}" stroke-width="0.04"`));
        }
        continue;
      }

      if (s.zone === 'column') {
        if (dark) {
          const base = mix(CHAR, BURNT, heat ** 1.3);
          solid.push(rect(c, r, 1, 1, `fill="${hex(base.map((x) => x + jitter()))}"`));
          solid.push(rect(c + 0.07, r + 0.07, 0.86, 0.86, `fill="none" stroke="${hex(base.map((x) => x + 32))}" stroke-width="0.05"`));
        } else {
          if (heat > 0.05) solid.push(rect(c, r, 1, 1, `fill="#ffd9b0" fill-opacity="${f(heat * 0.6)}"`));
          grid.push(rect(c + 0.05, r + 0.05, 0.9, 0.9, `fill="none" stroke="${GRID}" stroke-width="0.045"`));
        }
      } else if (s.zone === 'plume') {
        const t = 1 - s.v / 0.56; // 0 at plume base .. 1 at top
        if (dark) {
          const size = art.uniform(0.66, 0.92 - 0.12 * t);
          const m = Math.max(0, (size - 0.6) / 2);
          const cx = c + 0.5 + art.uniform(-m, m);
          const cy = r + 0.5 + art.uniform(-m, m);
          const lit = art.random() < 0.5 - 0.25 * t;
          if (lit) glow.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(size * 1.3)}" fill="url(#eq-ember)"/>`);
          const fill = lit ? art.pick(EMBERS.slice(3)) : art.pick(EMBERS.slice(0, 4));
          solid.push(rect(cx - size / 2, cy - size / 2, size, size, `fill="${fill}"`));
        } else {
          // the grid dissolves as the embers rise
          const keep = 0.85 - 0.75 * t - 0.4 * s.d;
          const roll = art.random();
          if (roll < keep) {
            grid.push(rect(c + 0.05, r + 0.05, 0.9, 0.9, `fill="none" stroke="${GRID}" stroke-width="0.04"`));
          } else if (roll < keep + 0.12) {
            const size = art.uniform(0.45, 0.85);
            grid.push(rect(c + 0.5 - size / 2, r + 0.5 - size / 2, size, size, `fill="none" stroke="#cdbfb0" stroke-width="0.045"`));
          }
        }
      } else if (dark) {
        // outside the plume: a speck of dust or ash, still covering the centre
        const size = art.uniform(0.5, 0.62);
        solid.push(rect(c + 0.5 - size / 2, r + 0.5 - size / 2, size, size, `fill="${art.pick(DUST)}"`));
      }
    }
  }

  // --- drifting embers beyond the quiet zone ---------------------------------------
  const top = -QUIET - Math.round(n * 0.32);
  for (let i = 0; i < n * 2.2; i++) {
    const y = art.uniform(top + 1, -QUIET - 0.6);
    const rise = (-QUIET - y) / (-QUIET - top); // 0 just above the code .. 1 at the top
    const spread = n * (0.36 + 0.12 * rise);
    const x = n / 2 + (art.random() + art.random() - 1) * spread;
    if (art.random() < rise * 0.55) continue; // thinner as they rise
    const s = art.uniform(0.12, 0.62 - 0.35 * rise);
    const roll = art.random();
    if (roll < 0.55) solid.push(rect(x, y, s, s, `fill="${art.pick(EMBERS)}" fill-opacity="${f(art.uniform(0.55, 1))}"`));
    else if (roll < 0.85) grid.push(rect(x, y, s + 0.2, s + 0.2, `fill="none" stroke="#cdbfb0" stroke-width="0.045"`));
    else solid.push(rect(x, y, s * 0.6, s * 0.6, `fill="#e9955a" fill-opacity="0.75"`));
  }
  // A few faint sparks inside the quiet zone: light only, so scanners ignore them.
  for (let i = 0; i < n * 0.6; i++) {
    const side = art.below(4);
    const along = art.uniform(-QUIET, n + QUIET);
    const out = art.uniform(0.3, QUIET - 0.3);
    const [x, y] = [[along, -out], [along, n + out], [-out, along], [n + out, along]][side];
    solid.push(rect(x, y, 0.16, 0.16, `fill="#f2b98a" fill-opacity="0.7"`));
  }

  // --- flame at the foot of the column ---------------------------------------------
  const teardrop = (rad, h, fill) => {
    const { x, y } = flame;
    const tip = y - h;
    return `<path d="M${f(x)} ${f(tip)} C${f(x + 0.3 * rad)} ${f(y - 0.62 * h)} ${f(x + rad)} ${f(y - 0.75 * rad)} ${f(x + rad)} ${f(y)} A${f(rad)} ${f(rad)} 0 0 1 ${f(x - rad)} ${f(y)} C${f(x - rad)} ${f(y - 0.75 * rad)} ${f(x - 0.3 * rad)} ${f(y - 0.62 * h)} ${f(x)} ${f(tip)}Z" fill="${fill}"/>`;
  };
  const fs = n / 30; // flame scales with the code
  const lean = art.uniform(-4, 4);
  const flameSvg = [
    `<ellipse cx="${f(flame.x)}" cy="${f(flame.y - 2 * fs)}" rx="${f(5.5 * fs)}" ry="${f(6.5 * fs)}" fill="url(#eq-flame-glow)"/>`,
    `<g transform="rotate(${f(lean)} ${f(flame.x)} ${f(flame.y)})">`,
    teardrop(2.2 * fs, 5 * fs, 'url(#eq-flame-outer)'),
    teardrop(1.45 * fs, 3.5 * fs, 'url(#eq-flame-mid)'),
    teardrop(0.78 * fs, 2 * fs, 'url(#eq-flame-core)'),
    '</g>',
    `<ellipse cx="${f(flame.x)}" cy="${f(flame.y + 1.4 * fs)}" rx="${f(1.15 * fs)}" ry="${f(0.45 * fs)}" fill="#8c847d"/>`,
    `<ellipse cx="${f(flame.x + 0.08 * fs)}" cy="${f(flame.y + 1.28 * fs)}" rx="${f(0.62 * fs)}" ry="${f(0.24 * fs)}" fill="#5d5650"/>`,
  ].join('');

  // --- poster frame: big type above and below the artwork ---------------------------
  const artTop = top - 1;
  const artBottom = n + QUIET + 3 * fs + 1;
  const artHeight = artBottom - artTop;
  const minWidth = n + 2 * QUIET + 14;
  let width = minWidth;
  let topY = artTop - 3;
  let bottom = artBottom + 2;
  let captionSvg = '';
  let fontStyle = '';
  if (caption) {
    // Type scales with the poster width, so solve for the width that gives a 2:3 poster.
    const perWidth = captionHeightPerWidth() + 2 * (MARGINS.outer + MARGINS.gap);
    width = Math.max(minWidth, artHeight / (POSTER_RATIO - perWidth));
    const cap = captions(width);
    topY = artTop - MARGINS.gap * width - cap.topHeight - MARGINS.outer * width;
    bottom = artBottom + MARGINS.gap * width + cap.bottomHeight + MARGINS.outer * width;
    captionSvg = cap.top(n / 2, topY + MARGINS.outer * width) + cap.bottom(n / 2, artBottom + MARGINS.gap * width);
    fontStyle = cap.style;
  }
  const height = bottom - topY;
  const left = n / 2 - width / 2;

  let xraySvg = '';
  if (o.xray) {
    const parts = [];
    for (const key of qr.controlled) {
      const r = Math.floor(key / n);
      const c = key % n;
      parts.push(rect(c + 0.3, r + 0.3, 0.4, 0.4, `fill="#0e7c86" fill-opacity="0.75"`));
    }
    for (const key of qr.burned) {
      const r = Math.floor(key / n);
      const c = key % n;
      parts.push(rect(c + 0.06, r + 0.06, 0.88, 0.88, `fill="none" stroke="#d61f69" stroke-width="0.12"`));
    }
    parts.push(rect(-QUIET, -QUIET, n + 2 * QUIET, n + 2 * QUIET, `fill="none" stroke="#0e7c86" stroke-width="0.15" stroke-dasharray="0.6 0.4"`));
    xraySvg = `\n  <g class="xray">${parts.join('')}</g>`;
  }

  const defs = `
    <radialGradient id="eq-aura" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff9a4a" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#ffb070" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="eq-ember" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f4893b" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#f4893b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="eq-flame-outer" cx="0.5" cy="0.78" r="0.62">
      <stop offset="0" stop-color="#ffd27a"/><stop offset="0.6" stop-color="#ffab55"/>
      <stop offset="1" stop-color="#f7953f" stop-opacity="0.15"/>
    </radialGradient>
    <radialGradient id="eq-flame-mid" cx="0.5" cy="0.8" r="0.6">
      <stop offset="0" stop-color="#fff1c9"/><stop offset="1" stop-color="#ffc66b" stop-opacity="0.7"/>
    </radialGradient>
    <radialGradient id="eq-flame-core" cx="0.5" cy="0.75" r="0.6">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#fff3d6" stop-opacity="0.6"/>
    </radialGradient>
    <radialGradient id="eq-flame-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb35c" stop-opacity="0.5"/><stop offset="1" stop-color="#ffb35c" stop-opacity="0"/>
    </radialGradient>`;

  const aura = `<ellipse cx="${f(n / 2)}" cy="${f(n * 0.78)}" rx="${f(n * 0.42)}" ry="${f(n * 0.5)}" fill="url(#eq-aura)"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(left)} ${f(topY)} ${f(width)} ${f(height)}" width="${Math.round(width * 10)}" height="${Math.round(height * 10)}" shape-rendering="crispEdges">
  <title>Ember QR</title>
  <desc>A standard QR code (version ${version}-${level}) drawn as embers.</desc>
  <defs>${fontStyle}${defs}</defs>
  <rect x="${f(left)}" y="${f(topY)}" width="${f(width)}" height="${f(height)}" fill="${PAPER}"/>
  <g shape-rendering="geometricPrecision">${aura}${glow.join('')}${flameSvg}</g>
  <g>${grid.join('')}</g>
  <g>${solid.join('')}</g>${captionSvg}${xraySvg}
</svg>`;

  return {
    svg,
    meta: { version, level, size: n, minVersion: min, mask: qr.mask, burn, ...qr.stats },
  };
}
