// Poster typography: a sentence above the artwork and one below it, set large
// in a chosen display font. Defaults:
//   above: "Humankind’s greatest tech began with fire."
//   below: "This `this.side.of.tech` is *You*."
//
// Text rules: a line break you type is kept; otherwise lines are balanced
// automatically. Words wrapped in *stars* are set in ember orange.
//
// Widths come from per-character advances measured in each font (fonts.js).
// Each line is pinned to that width with textLength, so the layout holds
// exactly, even in a viewer that falls back to another font.

import { FONTS, DEFAULT_FONT, CHARSET } from './fonts.js';

export { FONTS, DEFAULT_FONT };
export const DEFAULT_TOP_TEXT = 'Humankind’s greatest tech began with fire.';
export const DEFAULT_BOTTOM_TEXT = 'This `this.side.of.tech` is *You*.';

const INK = '#1e4a2b';
const ACCENT = '#c8400c';

/** Type sizes: how wide the widest line runs, as a share of the poster. */
export const TYPE_SIZES = [
  { id: 'small', label: 'S', span: 0.56 },
  { id: 'medium', label: 'M', span: 0.7 },
  { id: 'large', label: 'L', span: 0.84 },
];
export const DEFAULT_TYPE_SIZE = 'large';

const MAX_SIZE = 0.2; // largest font size, as a share of the poster width
const MAX_TEXT_SHARE = 0.75; // most poster height (per unit of width) the words may take

/** Margins per unit of poster width, and the poster's shape. */
export const MARGINS = { outer: 0.065, gap: 0.035 };
export const POSTER_RATIO = 1.5; // height / width, a 2:3 print

// Font files are embedded when the caller has registered them (the browser
// loads them on demand; see app/fontloader.js).
const fontData = new Map();
export function registerFontData(id, woff2Base64) {
  fontData.set(id, woff2Base64);
}

const f = (v) => +v.toFixed(3);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const fontById = (id) => FONTS.find((x) => x.id === id) || FONTS.find((x) => x.id === DEFAULT_FONT);
const sizeById = (id) => TYPE_SIZES.find((x) => x.id === id) || TYPE_SIZES.find((x) => x.id === DEFAULT_TYPE_SIZE);

const charIndex = new Map([...CHARSET].map((c, i) => [c, i]));

/** Width of plain text in em. Characters outside the measured set count as an average letter. */
export function measure(font, text) {
  const avg = font.adv[charIndex.get('n')];
  let w = 0;
  for (const c of text) {
    const i = charIndex.get(c);
    w += i === undefined ? avg : font.adv[i];
  }
  return w / 1000;
}

/** Split "*glowing* words" into segments. Unmatched stars stay literal. */
function segments(line) {
  const out = [];
  const re = /\*([^*]+)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), accent: false });
    out.push({ text: m[1], accent: true });
    last = re.lastIndex;
  }
  if (last < line.length) out.push({ text: line.slice(last), accent: false });
  return out;
}
const plain = (line) => segments(line).map((s) => s.text).join('');

/**
 * Break text into lines that are as even as possible: choose the line count
 * from the text's length, then split at spaces to minimise the widest line.
 */
function breakLines(font, text) {
  const words = text.split(' ').filter(Boolean);
  if (!words.length) return [];
  const total = measure(font, plain(text));
  const space = measure(font, ' ');
  // About 7.5 em per line suits these display faces; at most one line per word.
  const k = Math.max(1, Math.min(words.length, 5, Math.round(total / 7.5)));
  const widths = words.map((w) => measure(font, plain(w)));
  const lineWidth = (i, j) => widths.slice(i, j).reduce((s, w) => s + w, 0) + space * (j - i - 1);
  // best[j][n]: smallest possible widest line for words[0..j) in n lines
  const best = Array.from({ length: words.length + 1 }, () => new Array(k + 1).fill(Infinity));
  const cut = Array.from({ length: words.length + 1 }, () => new Array(k + 1).fill(0));
  best[0][0] = 0;
  for (let j = 1; j <= words.length; j++) {
    for (let n = 1; n <= k; n++) {
      for (let i = n - 1; i < j; i++) {
        const v = Math.max(best[i][n - 1], lineWidth(i, j));
        if (v < best[j][n]) {
          best[j][n] = v;
          cut[j][n] = i;
        }
      }
    }
  }
  const lines = [];
  for (let j = words.length, n = k; n > 0; n--) {
    const i = cut[j][n];
    lines.unshift(words.slice(i, j).join(' '));
    j = i;
  }
  return lines;
}

/** Lines for a caption: typed line breaks win; otherwise balance automatically. */
export function captionLines(font, text) {
  const clean = (text ?? '').replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
  const typed = clean.filter(Boolean);
  if (!typed.length) return [];
  return typed.length > 1 ? typed : breakLines(font, typed[0]);
}

function layout(width, opts = {}) {
  const font = fontById(opts.font);
  const { span } = sizeById(opts.typeSize);
  const lead = font.cap + font.desc + 0.08; // baseline to baseline, tight display setting
  const prep = (text) => captionLines(font, text).map((line) => ({ line, em: measure(font, plain(line)) }));
  const top = prep(opts.topText ?? DEFAULT_TOP_TEXT);
  const bottom = prep(opts.bottomText ?? DEFAULT_BOTTOM_TEXT);
  // Fill the span, but never let a short line balloon past MAX_SIZE.
  const sizeFor = (lines) => (lines.length ? Math.min(MAX_SIZE * width, (span * width) / Math.max(...lines.map((l) => l.em))) : 0);
  const height = (lines, s) => (lines.length ? s * (font.ascender + (lines.length - 1) * lead + font.desc + 0.04) : 0);
  let topSize = sizeFor(top);
  let bottomSize = sizeFor(bottom);
  // Keep the words from crowding out the artwork: scale both down together.
  const used = height(top, topSize) + height(bottom, bottomSize);
  if (used > MAX_TEXT_SHARE * width) {
    const k = (MAX_TEXT_SHARE * width) / used;
    topSize *= k;
    bottomSize *= k;
  }
  return { font, lead, top, bottom, topSize, bottomSize, topHeight: height(top, topSize), bottomHeight: height(bottom, bottomSize) };
}

/** Caption heights per unit of poster width (for solving the poster's size). */
export function captionHeightPerWidth(opts) {
  const l = layout(1, opts);
  return l.topHeight + l.bottomHeight;
}

/**
 * Caption pieces for a poster `width` units wide.
 * opts: { font, typeSize, topText, bottomText }
 * Returns { style, topHeight, bottomHeight, top(cx, y), bottom(cx, y) }.
 */
export function captions(width, opts) {
  const l = layout(width, opts);
  const { font } = l;
  const family = `'${font.family}', 'Arial Black', 'Helvetica Neue', Arial, sans-serif`;
  const block = (lines, size, cx, y) => lines.map(({ line, em }, i) => {
    const baseline = y + size * (font.ascender + i * l.lead);
    const inner = segments(line).map((s) => (s.accent ? `<tspan fill="${ACCENT}">${esc(s.text)}</tspan>` : esc(s.text))).join('');
    return `<text x="${f(cx)}" y="${f(baseline)}" font-size="${f(size)}" textLength="${f(em * size)}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${inner}</text>`;
  }).join('\n    ');
  const group = (inner) => (inner ? `
  <g fill="${INK}" text-anchor="middle" font-family="${esc(family)}" font-weight="${font.weight}" shape-rendering="geometricPrecision">
    ${inner}
  </g>` : '');
  const data = fontData.get(font.id);
  return {
    style: data
      ? `<style>@font-face{font-family:'${font.family}';font-style:normal;font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format('woff2')}</style>`
      : '',
    topHeight: l.topHeight,
    bottomHeight: l.bottomHeight,
    top: (cx, y) => group(block(l.top, l.topSize, cx, y)),
    bottom: (cx, y) => group(block(l.bottom, l.bottomSize, cx, y)),
  };
}
