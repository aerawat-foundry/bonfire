// Poster renderer: standard QR as the burning column, flame below, ember code
// rising above, caption underneath. Output is a self-contained SVG string.
//
// One SVG unit = one QR module. Every random-looking choice that is NOT part
// of the code (sizes, jitter, colours, decoys) comes from a stream seeded by
// the text, so the same text always burns the same way.

import { Stream, utf8 } from './prng.js';
import { sha256 } from './sha256.js';
import { makeQr } from './qr.js';
import { QUIET, layout, plumeRows, encodeEmbers, capacity } from './ember.js';
import { selectHotpoints } from './hotpoints.js';

const PAPER = '#f7f4ee';
const GRID = '#d3c9bf';
const INK = '#1e4a2b';
const CHAR = [0x23, 0x1a, 0x14];
const BURNT = [0x6a, 0x2e, 0x10];
// Every ember fill stays below ~30% luminance so it always reads as "1".
const EMBER_DARK = ['#1d1510', '#2a1a11', '#3a1e0e', '#55260d', '#6e300e', '#83390f'];

const f = (v) => +v.toFixed(3);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hex = (rgb) => '#' + rgb.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

const rect = (x, y, w, h, attrs) =>
  `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" ${attrs}/>`;

/**
 * Build the poster.
 * @param {string} text           text for the standard QR
 * @param {object} [opts]
 * @param {string} [opts.emberText] text for the ember layer (defaults to `text`)
 * @param {boolean} [opts.caption]  draw the two-line caption (default true)
 * @param {boolean} [opts.xray]     overlay the convention: data cells, quiet
 *                                  zone and hotpoints (for explaining, not printing)
 */
export function renderPoster(text, opts = {}) {
  if (!text) throw new Error('Enter some text to burn.');
  const emberText = opts.emberText ?? text;
  const caption = opts.caption ?? true;
  const xray = opts.xray ?? false;

  const { version, size: n, matrix } = makeQr(text);
  const bits = encodeEmbers(n, emberText);
  const hot = selectHotpoints(text, version, matrix);
  const hotSet = new Set(hot.map(([x, y]) => `${x},${y}`));
  const art = new Stream(new Uint8Array([...utf8('ember/v1/art/'), ...sha256(utf8(text))]));

  const rows = plumeRows(n);
  const plumeTop = rows[rows.length - 1].y;
  const top = plumeTop - 7;
  const bottom = n + (caption ? 17 : 9);
  const height = bottom - top;
  const plumeWidth = Math.max(...rows.map((r) => 2 * r.hw + Math.abs(r.cx - n / 2) * 2));
  const width = Math.max(height / 1.47, plumeWidth + 10, n + 2 * QUIET + 16);
  const left = n / 2 - width / 2;

  const flame = { x: n / 2, y: n + 5.0 };
  const heatAt = (x, y) => clamp(1 - Math.hypot(x - flame.x, y - (n + 1.5)) / (0.75 * n), 0, 1);

  const defs = [];
  const glow = [];      // soft light, behind everything solid
  const grid = [];      // outlined cells
  const solid = [];     // QR modules, embers, decoys
  const front = [];     // hotpoint cores, flame

  // --- radial gradients -----------------------------------------------------
  defs.push(`
    <radialGradient id="bf-aura" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff9a4a" stop-opacity="0.22"/>
      <stop offset="0.55" stop-color="#ffb070" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#ffb070" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bf-hot" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ff7a1a" stop-opacity="0.55"/>
      <stop offset="0.45" stop-color="#ff8a2a" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ff8a2a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bf-ember" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#f4893b" stop-opacity="0.32"/>
      <stop offset="1" stop-color="#f4893b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bf-flame-outer" cx="0.5" cy="0.78" r="0.62">
      <stop offset="0" stop-color="#ffd27a"/>
      <stop offset="0.6" stop-color="#ffab55"/>
      <stop offset="1" stop-color="#f7953f" stop-opacity="0.15"/>
    </radialGradient>
    <radialGradient id="bf-flame-mid" cx="0.5" cy="0.8" r="0.6">
      <stop offset="0" stop-color="#fff1c9"/>
      <stop offset="1" stop-color="#ffc66b" stop-opacity="0.7"/>
    </radialGradient>
    <radialGradient id="bf-flame-core" cx="0.5" cy="0.75" r="0.6">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#fff3d6" stop-opacity="0.6"/>
    </radialGradient>
    <radialGradient id="bf-flame-glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffb35c" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffb35c" stop-opacity="0"/>
    </radialGradient>`);

  // Warm aura around the burning column.
  glow.push(`<ellipse cx="${f(n / 2)}" cy="${f(n * 0.7)}" rx="${f(n * 0.95)}" ry="${f(n * 1.25)}" fill="url(#bf-aura)"/>`);

  // --- the standard QR, as the column of burning cells ------------------------
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const heat = heatAt(x + 0.5, y + 0.5);
      if (!matrix[y][x]) {
        if (heat > 0.05) solid.push(rect(x, y, 1, 1, `fill="#ffd9b0" fill-opacity="${f(heat * 0.55)}"`));
        grid.push(rect(x + 0.04, y + 0.04, 0.92, 0.92, `fill="none" stroke="${GRID}" stroke-width="0.04"`));
        continue;
      }
      // Dark modules are full, touching squares: a light seam between them
      // would break the 1:1:3:1:1 runs scanners use to find the code. The
      // inner stroke, a shade lighter, keeps the poster's separate-cell look.
      const jitter = () => art.uniform(-7, 7);
      if (hotSet.has(`${x},${y}`)) {
        glow.push(`<circle cx="${f(x + 0.5)}" cy="${f(y + 0.5)}" r="1.9" fill="url(#bf-hot)"/>`);
        solid.push(rect(x, y, 1, 1, `fill="#4a1204"`));
        front.push(rect(x + 0.27, y + 0.27, 0.46, 0.46, `fill="#c8400c"`));
        continue;
      }
      const base = mix(CHAR, BURNT, Math.pow(heat, 1.4));
      const color = hex(base.map((c) => c + jitter()));
      const edge = hex(base.map((c) => c + 34 + jitter()));
      solid.push(rect(x, y, 1, 1, `fill="${color}"`));
      solid.push(rect(x + 0.06, y + 0.06, 0.88, 0.88, `fill="none" stroke="${edge}" stroke-width="0.05"`));
    }
  }

  // --- quiet zone above the QR: only faint grid and pale sparks ------------------
  for (let y = -QUIET; y < 0; y++) {
    const p = 0.95 - 0.12 * (-1 - y);
    for (let x = 0; x < n; x++) {
      if (art.random() < p) {
        grid.push(rect(x + 0.04, y + 0.04, 0.92, 0.92, `fill="none" stroke="${GRID}" stroke-width="0.04" stroke-opacity="${f(0.55 + 0.1 * (y + QUIET))}"`));
      }
      const warmth = art.random();
      if (warmth < 0.35) {
        // pale, light-only cells keep the column visually continuous
        solid.push(rect(x + 0.06, y + 0.06, 0.88, 0.88, `fill="#fcdcbc" fill-opacity="${f(0.25 + 0.5 * warmth)}"`));
      }
      if (art.random() < 0.06) {
        const s = art.uniform(0.12, 0.22);
        solid.push(rect(x + art.uniform(0.05, 0.95 - s), y + art.uniform(0.05, 0.95 - s), s, s,
          `fill="#f2b98a" fill-opacity="0.75"`));
      }
    }
  }

  // --- ember code ----------------------------------------------------------------
  const dataCells = new Set(layout(n).map(([x, y]) => `${x},${y}`));
  const span = rows.length - 1;
  for (const [key, bit] of bits) {
    const [x, y] = key.split(',').map(Number);
    const t = (-(QUIET + 1) - y) / span;
    if (bit) {
      const s = art.uniform(0.62, 0.9);
      const m = s / 2 - 0.2;
      const cx = x + 0.5 + art.uniform(-m, m);
      const cy = y + 0.5 + art.uniform(-m, m);
      const lit = art.random() < 0.55 - 0.3 * t;
      const shade = lit ? art.pick(EMBER_DARK.slice(3)) : art.pick(EMBER_DARK.slice(0, 4));
      if (lit) glow.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(s * 1.35)}" fill="url(#bf-ember)"/>`);
      solid.push(rect(cx - s / 2, cy - s / 2, s, s, `fill="${shade}"`));
    } else {
      const r = art.random();
      if (r < 0.32) {
        const s = art.uniform(0.6, 0.95);
        const j = (0.95 - s) / 2;
        grid.push(rect(x + 0.5 - s / 2 + art.uniform(-j, j), y + 0.5 - s / 2 + art.uniform(-j, j), s, s,
          `fill="none" stroke="#cdbfb0" stroke-width="0.045"`));
      } else if (r < 0.44) {
        // pale spark, kept off the cell centre
        const s = art.uniform(0.1, 0.2);
        const ox = art.pick([0.06, 0.94 - s]);
        const oy = art.uniform(0.06, 0.94 - s);
        solid.push(rect(x + ox, y + oy, s, s, `fill="#f0a970" fill-opacity="0.8"`));
      }
    }
  }

  // --- decoys: non-data cells in and around the plume (ignored by decoders) -----
  for (const { y, cx, hw } of rows) {
    const t = (-(QUIET + 1) - y) / span;
    for (let x = Math.floor(cx - hw * 1.45); x < Math.ceil(cx + hw * 1.45); x++) {
      if (dataCells.has(`${x},${y}`)) continue;
      const d = Math.abs(x + 0.5 - cx) / hw;
      const p = d <= 1 ? 0.3 : 0.22 * Math.max(0, 1.45 - d) / 0.45;
      const r = art.random();
      if (r > p) continue;
      const kind = art.random();
      if (kind < 0.45) {
        const s = art.uniform(0.18, 0.5 - 0.15 * t);
        solid.push(rect(x + art.uniform(0.05, 0.95 - s), y + art.uniform(0.05, 0.95 - s), s, s,
          `fill="${art.pick(EMBER_DARK)}" fill-opacity="${f(art.uniform(0.6, 1))}"`));
      } else if (kind < 0.8) {
        const s = art.uniform(0.35, 0.9);
        grid.push(rect(x + art.uniform(0.05, 0.95 - s), y + art.uniform(0.05, 0.95 - s), s, s,
          `fill="none" stroke="#cdbfb0" stroke-width="0.045"`));
      } else {
        const s = art.uniform(0.1, 0.2);
        solid.push(rect(x + art.uniform(0.05, 0.95 - s), y + art.uniform(0.05, 0.95 - s), s, s,
          `fill="#e88a4a" fill-opacity="0.7"`));
      }
    }
  }
  // Drifting specks above the plume.
  for (let i = 0; i < n * 1.6; i++) {
    const y = art.uniform(top + 2, plumeTop + 3);
    const x = n / 2 + art.uniform(-1, 1) * art.uniform(0.2, 1) * (plumeWidth / 2 + 3);
    if (dataCells.has(`${Math.floor(x)},${Math.floor(y)}`)) continue;
    const s = art.uniform(0.08, 0.3);
    const fill = art.random() < 0.5 ? art.pick(EMBER_DARK) : '#e9955a';
    solid.push(rect(x, y, s, s, `fill="${fill}" fill-opacity="${f(art.uniform(0.35, 0.85))}"`));
  }

  // --- flame, burning just under the column ---------------------------------------
  const teardrop = (r, h, fill) => {
    const { x, y } = flame;
    const tip = y - h;
    return `<path d="M${f(x)} ${f(tip)} C${f(x + 0.3 * r)} ${f(y - 0.62 * h)} ${f(x + r)} ${f(y - 0.75 * r)} ${f(x + r)} ${f(y)} A${f(r)} ${f(r)} 0 0 1 ${f(x - r)} ${f(y)} C${f(x - r)} ${f(y - 0.75 * r)} ${f(x - 0.3 * r)} ${f(y - 0.62 * h)} ${f(x)} ${f(tip)}Z" fill="${fill}"/>`;
  };
  const lean = art.uniform(-4, 4);
  const flameSvg = [
    `<ellipse cx="${f(flame.x)}" cy="${f(flame.y - 2)}" rx="6" ry="6.8" fill="url(#bf-flame-glow)"/>`,
    `<g transform="rotate(${f(lean)} ${f(flame.x)} ${f(flame.y)})">`,
    teardrop(2.9, 6.6, 'url(#bf-flame-outer)'),
    teardrop(1.9, 4.6, 'url(#bf-flame-mid)'),
    teardrop(1.0, 2.6, 'url(#bf-flame-core)'),
    `</g>`,
    `<ellipse cx="${f(flame.x)}" cy="${f(flame.y + 1.75)}" rx="1.5" ry="0.6" fill="#8c847d"/>`,
    `<ellipse cx="${f(flame.x + 0.1)}" cy="${f(flame.y + 1.6)}" rx="0.85" ry="0.32" fill="#5d5650"/>`,
  ].join('');

  // --- caption (unchanged from the original poster) ----------------------------------
  let captionSvg = '';
  if (caption) {
    const fs = Math.min(2.3, width * 0.034);
    const serif = `font-family="Georgia, 'Times New Roman', 'Liberation Serif', serif"`;
    const mono = `font-family="'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace"`;
    captionSvg = `
  <g fill="${INK}" text-anchor="middle" font-size="${f(fs)}" ${serif}>
    <text x="${f(n / 2)}" y="${f(n + 10.5)}">Humankind’s great tech began with fire.</text>
    <text x="${f(n / 2)}" y="${f(n + 10.5 + fs * 1.3)}">This <tspan ${mono} font-size="${f(fs * 0.86)}">\`this.side.of.tech\`</tspan> is <tspan font-weight="bold">You</tspan>.</text>
  </g>`;
  }

  let xraySvg = '';
  if (xray) {
    const parts = [];
    for (const [key, bit] of bits) {
      const [x, y] = key.split(',').map(Number);
      parts.push(rect(x + 0.08, y + 0.08, 0.84, 0.84,
        `fill="${bit ? '#0e7c86' : 'none'}" fill-opacity="0.35" stroke="#0e7c86" stroke-width="0.06"`));
    }
    parts.push(rect(-QUIET, -QUIET, n + 2 * QUIET, n + 2 * QUIET,
      `fill="none" stroke="#0e7c86" stroke-width="0.12" stroke-dasharray="0.6 0.4"`));
    for (const [x, y] of hot) {
      parts.push(`<circle cx="${x + 0.5}" cy="${y + 0.5}" r="1.3" fill="none" stroke="#d61f69" stroke-width="0.16"/>`);
    }
    xraySvg = `\n  <g class="xray">${parts.join('')}</g>`;
  }

  const vb = `${f(left)} ${f(top)} ${f(width)} ${f(height)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${Math.round(width * 12)}" height="${Math.round(height * 12)}" shape-rendering="crispEdges">
  <title>Ember code</title>
  <desc>ember/v1 — standard QR (ECC H) with an ember code above it.</desc>
  <defs>${defs.join('')}</defs>
  <rect x="${f(left)}" y="${f(top)}" width="${f(width)}" height="${f(height)}" fill="${PAPER}"/>
  <g shape-rendering="geometricPrecision">${glow.join('')}${flameSvg}</g>
  <g>${grid.join('')}</g>
  <g>${solid.join('')}</g>
  <g>${front.join('')}</g>${captionSvg}${xraySvg}
</svg>`;

  return {
    svg,
    meta: {
      version,
      size: n,
      hotpoints: hot,
      emberCells: dataCells.size,
      capacity: capacity(n),
      emberText,
    },
  };
}

