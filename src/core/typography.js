// Poster typography: the two sentences in Momo Trust Display, set large.
// "Humankind's greatest tech began with fire." stands above the artwork;
// "This `this.side.of.tech` is You." sits below it.
//
// Line widths were measured in the real font (Chromium canvas, em units).
// Each line is pinned to its width with textLength, so the layout holds even
// in a viewer that falls back to another font.

import { MOMO_TRUST_DISPLAY_WOFF2 } from './font-momo.js';

const FAMILY = "'Momo Trust Display', 'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const INK = '#1e4a2b';
const ACCENT = '#c8400c';

const TOP = [
  { text: 'Humankind’s', em: 6.538 },
  { text: 'greatest tech', em: 6.794 },
  { text: 'began with fire.', em: 7.835 },
];
const BOTTOM = [
  { text: 'This `this.side.of.tech`', em: 11.012 },
  { text: 'is You.', em: 3.105, html: `is <tspan fill="${ACCENT}">You</tspan>.` },
];

const CAP = 0.76; // cap height
const DESC = 0.24; // room below the last baseline
const LEAD = 1.04; // baseline to baseline
const SPAN = 0.84; // widest line, as a share of the poster width

const f = (v) => +v.toFixed(3);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const blockHeight = (lines, size) => size * (CAP + (lines.length - 1) * LEAD + DESC);

function sizes(width) {
  const top = (SPAN * width) / Math.max(...TOP.map((l) => l.em));
  const bottom = (SPAN * width) / Math.max(...BOTTOM.map((l) => l.em));
  return { top, bottom };
}

/** Caption heights per unit of poster width (for solving the poster's size). */
export function captionHeightPerWidth() {
  const s = sizes(1);
  return blockHeight(TOP, s.top) + blockHeight(BOTTOM, s.bottom);
}

function block(lines, size, cx, y) {
  return lines.map((l, i) => {
    const baseline = y + size * (CAP + i * LEAD);
    return `<text x="${f(cx)}" y="${f(baseline)}" font-size="${f(size)}" textLength="${f(l.em * size)}" lengthAdjust="spacingAndGlyphs">${l.html ?? esc(l.text)}</text>`;
  }).join('\n    ');
}

/**
 * Caption pieces for a poster `width` units wide.
 * Returns { style, topHeight, bottomHeight, top(cx, y), bottom(cx, y) }.
 */
export function captions(width) {
  const s = sizes(width);
  const group = (inner) => `
  <g fill="${INK}" text-anchor="middle" font-family="${FAMILY}" shape-rendering="geometricPrecision">
    ${inner}
  </g>`;
  return {
    style: `<style>@font-face{font-family:'Momo Trust Display';font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,${MOMO_TRUST_DISPLAY_WOFF2}) format('woff2')}</style>`,
    topHeight: blockHeight(TOP, s.top),
    bottomHeight: blockHeight(BOTTOM, s.bottom),
    top: (cx, y) => group(block(TOP, s.top, cx, y)),
    bottom: (cx, y) => group(block(BOTTOM, s.bottom, cx, y)),
  };
}

/** Margins (top, gap above art, gap below art, bottom) per unit of poster width. */
export const MARGINS = { outer: 0.065, gap: 0.035 };
export const POSTER_RATIO = 1.5; // height / width, a 2:3 print
