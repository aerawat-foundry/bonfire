// Rich text for posters: a small document model and an exact layout engine
// that renders it to SVG.
//
// A block (the text above or below the artwork) holds paragraphs of styled
// runs:
//   block = { font, size, width, lineHeight, letterSpacing, color, paragraphs }
//     font           FONTS id, the block's default face
//     size           base font size, % of the poster width
//     width          text box width, % of the poster width (centred)
//     lineHeight     multiplier on the font's natural line spacing
//     letterSpacing  extra space between letters, in em
//     color          default text colour
//   paragraph = { align: 'left' | 'center' | 'right' | 'justify', runs }
//   run = { text, bold?, italic?, underline?, strike?, color?, font?, scale? }
//     scale          size relative to the block's base size (1 = base)
//
// Lines wrap inside the box. Within a paragraph the line count is the
// smallest that fits, and lines are then balanced (like CSS text-wrap:
// balance) so posters avoid a lonely last word. Every word is placed at an
// exact x, using per-character advances measured in each font, so the SVG
// looks the same in every viewer.
//
// The fonts have a single weight and no italics: bold is drawn with a thin
// outline in the text colour, italic is the viewer's synthesized slant.

import { FONTS, DEFAULT_FONT, CHARSET } from './fonts.js';

export { FONTS, DEFAULT_FONT };
export const INK = '#1e4a2b';
export const ACCENT = '#c8400c';
export const ALIGNS = ['left', 'center', 'right', 'justify'];

const BOLD_STROKE = 0.032; // em
const BOLD_EXTRA = 0.03; // extra advance per bold letter, em

const fontData = new Map();
/** Make a font embeddable (base64 woff2). The browser loads these on demand. */
export function registerFontData(id, woff2Base64) {
  fontData.set(id, woff2Base64);
}

export const fontById = (id) => FONTS.find((x) => x.id === id) || FONTS.find((x) => x.id === DEFAULT_FONT);
const charIndex = new Map([...CHARSET].map((c, i) => [c, i]));

/** Width of plain text in em (characters outside the measured set count as an "n"). */
export function measure(font, text) {
  const avg = font.adv[charIndex.get('n')];
  let w = 0;
  for (const c of text) {
    const i = charIndex.get(c);
    w += i === undefined ? avg : font.adv[i];
  }
  return w / 1000;
}

// --- defaults -------------------------------------------------------------------

export function defaultTop() {
  return {
    font: DEFAULT_FONT, size: 10.7, width: 86, lineHeight: 1, letterSpacing: 0, color: INK,
    paragraphs: [{ align: 'center', runs: [{ text: 'Humankind’s greatest tech began with fire.' }] }],
  };
}
export function defaultBottom() {
  return {
    font: DEFAULT_FONT, size: 7.6, width: 86, lineHeight: 1, letterSpacing: 0, color: INK,
    paragraphs: [{ align: 'center', runs: [{ text: 'This `this.side.of.tech` is ' }, { text: 'You', color: ACCENT }, { text: '.' }] }],
  };
}

/** Fill in anything missing or invalid, so a block from a URL is safe to lay out. */
export function normalizeBlock(block, fallback) {
  const b = { ...fallback, ...(block || {}) };
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const color = (c, d) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : d);
  b.font = fontById(b.font).id;
  b.size = num(b.size, 1, 40, fallback.size);
  b.width = num(b.width, 20, 100, fallback.width);
  b.lineHeight = num(b.lineHeight, 0.6, 2.5, 1);
  b.letterSpacing = num(b.letterSpacing, -0.1, 0.5, 0);
  b.color = color(b.color, INK);
  b.paragraphs = (Array.isArray(b.paragraphs) ? b.paragraphs : []).map((p) => ({
    align: ALIGNS.includes(p?.align) ? p.align : 'center',
    runs: (Array.isArray(p?.runs) ? p.runs : []).filter((r) => typeof r?.text === 'string' && r.text).map((r) => ({
      text: r.text.slice(0, 500),
      ...(r.bold ? { bold: true } : {}),
      ...(r.italic ? { italic: true } : {}),
      ...(r.underline ? { underline: true } : {}),
      ...(r.strike ? { strike: true } : {}),
      ...(color(r.color, null) ? { color: r.color } : {}),
      ...(r.font && FONTS.some((f) => f.id === r.font) ? { font: r.font } : {}),
      ...(Number.isFinite(+r.scale) && +r.scale !== 1 ? { scale: num(r.scale, 0.25, 4, 1) } : {}),
    })),
  })).slice(0, 12);
  return b;
}

// --- layout ---------------------------------------------------------------------

/** Turn a paragraph into words: arrays of styled pieces, with the space after each. */
function words(block, paragraph) {
  const out = [];
  let cur = [];
  const style = (r) => {
    const font = fontById(r.font || block.font);
    const size = block.size * (r.scale || 1);
    return { r, font, size };
  };
  const pieceWidth = (text, s) => {
    const letters = [...text].length;
    return measure(s.font, text) * s.size
      + letters * block.letterSpacing * s.size
      + (s.r.bold ? letters * BOLD_EXTRA * s.size : 0);
  };
  for (const r of paragraph.runs) {
    const s = style(r);
    const parts = r.text.split(/( +)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^ +$/.test(part)) {
        if (cur.length) {
          out.push({ pieces: cur, space: pieceWidth(' ', s) });
          cur = [];
        }
        continue;
      }
      cur.push({ text: part, s, w: pieceWidth(part, s) });
    }
  }
  if (cur.length) out.push({ pieces: cur, space: 0 });
  for (const w of out) w.w = w.pieces.reduce((t, p) => t + p.w, 0);
  return out;
}

/** Fewest lines that fit, then balance them. Returns arrays of word indices [i, j). */
function breakParagraph(ws, maxWidth) {
  const width = (i, j) => {
    let t = 0;
    for (let k = i; k < j; k++) t += ws[k].w + (k < j - 1 ? ws[k].space : 0);
    return t;
  };
  // Greedy pass: how many lines are needed at all?
  let lines = 0;
  for (let i = 0; i < ws.length;) {
    let j = i + 1;
    while (j < ws.length && width(i, j + 1) <= maxWidth) j++;
    lines++;
    i = j;
  }
  // Balance: same line count, smallest possible widest line.
  const n = ws.length;
  const best = Array.from({ length: n + 1 }, () => new Array(lines + 1).fill(Infinity));
  const cut = Array.from({ length: n + 1 }, () => new Array(lines + 1).fill(0));
  best[0][0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let k = 1; k <= lines; k++) {
      for (let i = k - 1; i < j; i++) {
        const v = Math.max(best[i][k - 1], width(i, j));
        if (v < best[j][k]) {
          best[j][k] = v;
          cut[j][k] = i;
        }
      }
    }
  }
  const out = [];
  for (let j = n, k = lines; k > 0; k--) {
    const i = cut[j][k];
    out.unshift([i, j]);
    j = i;
  }
  return out;
}

/**
 * Lay out a block at poster width W. Returns { height, lines } with each line
 * { baseline, pieces: [{ x, text, s }] } (coordinates relative to the block's
 * top-left, x across the full poster width).
 */
export function layoutBlock(block, W) {
  const boxW = (block.width / 100) * W;
  const boxL = (W - boxW) / 2;
  const scale = W / 100; // sizes are % of the poster width
  const lines = [];
  let y = 0;
  let first = true;
  let lastDesc = 0;
  for (const para of block.paragraphs) {
    const ws = words(block, para);
    if (!ws.length) continue;
    for (const w of ws) {
      w.w *= scale;
      w.space *= scale;
      for (const p of w.pieces) p.w *= scale;
    }
    const breaks = breakParagraph(ws, boxW);
    breaks.forEach(([i, j], li) => {
      const lineWords = ws.slice(i, j);
      const maxSize = Math.max(...lineWords.flatMap((w) => w.pieces.map((p) => p.s.size))) * scale;
      const font = fontById(block.font);
      const ascent = Math.max(...lineWords.flatMap((w) => w.pieces.map((p) => p.s.font.ascender * p.s.size * scale)));
      const lead = (font.cap + font.desc + 0.08) * maxSize * block.lineHeight;
      y = first ? ascent : y + lead;
      first = false;
      const natural = lineWords.reduce((t, w, k) => t + w.w + (k < lineWords.length - 1 ? w.space : 0), 0);
      const last = li === breaks.length - 1;
      let gapExtra = 0;
      let x = boxL;
      if (para.align === 'justify' && !last && lineWords.length > 1) {
        gapExtra = (boxW - natural) / (lineWords.length - 1);
      } else if (para.align === 'center') {
        x = boxL + (boxW - natural) / 2;
      } else if (para.align === 'right') {
        x = boxL + boxW - natural;
      }
      const pieces = [];
      lineWords.forEach((w, k) => {
        for (const p of w.pieces) {
          pieces.push({ x, text: p.text, s: p.s, w: p.w });
          x += p.w;
        }
        if (k < lineWords.length - 1) x += w.space + gapExtra;
      });
      lines.push({ baseline: y, pieces });
      lastDesc = Math.max(...lineWords.flatMap((w) => w.pieces.map((p) => p.s.font.desc * p.s.size * scale)));
    });
  }
  return { height: lines.length ? y + lastDesc + 0.04 * block.size * scale : 0, lines };
}

const f = (v) => +v.toFixed(3);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const familyOf = (font) => `'${font.family}', 'Arial Black', 'Helvetica Neue', Arial, sans-serif`;

/** SVG for a laid-out block whose top edge sits at `top`. */
export function renderBlock(block, laid, top, W) {
  const scale = W / 100;
  const out = [];
  for (const line of laid.lines) {
    const baseline = top + line.baseline;
    // Each piece is its own <text>, pinned to its measured width: identical
    // in every viewer, letter spacing and bold advance included.
    for (const p of line.pieces) {
      const r = p.s.r;
      const color = r.color || block.color;
      const size = p.s.size * scale;
      const attrs = [
        `x="${f(p.x)}"`, `y="${f(baseline)}"`,
        `font-family="${esc(familyOf(p.s.font))}"`, `font-weight="${p.s.font.weight}"`,
        `font-size="${f(size)}"`, `fill="${color}"`,
        `textLength="${f(p.w)}"`, 'lengthAdjust="spacing"',
        r.italic ? 'font-style="italic"' : '',
        r.bold ? `stroke="${color}" stroke-width="${f(BOLD_STROKE * size)}" stroke-linejoin="round" paint-order="stroke"` : '',
      ].filter(Boolean).join(' ');
      out.push(`<text ${attrs}>${esc(p.text)}</text>`);
    }
    // Underline and strike-through: drawn lines, continuous across spaces.
    for (const [key, offset] of [['underline', 0.1], ['strike', -0.28]]) {
      let start = null;
      line.pieces.forEach((p, i) => {
        const on = p.s.r[key];
        const next = line.pieces[i + 1];
        if (on && start === null) start = p;
        if (on && !(next && next.s.r[key])) {
          const size = Math.max(start.s.size, p.s.size) * scale;
          out.push(`<rect x="${f(start.x)}" y="${f(baseline + offset * size - 0.03 * size)}" width="${f(p.x + p.w - start.x)}" height="${f(0.06 * size)}" fill="${p.s.r.color || block.color}"/>`);
          start = null;
        }
      });
    }
  }
  return out.length ? `<g shape-rendering="geometricPrecision" xml:space="preserve">${out.join('')}</g>` : '';
}

/** @font-face rules for every font a set of blocks uses (if loaded). */
export function fontFaces(blocks) {
  const used = new Set();
  for (const b of blocks) {
    used.add(fontById(b.font).id);
    for (const p of b.paragraphs) for (const r of p.runs) if (r.font) used.add(fontById(r.font).id);
  }
  const rules = [...used].filter((id) => fontData.has(id)).map((id) => {
    const font = fontById(id);
    return `@font-face{font-family:'${font.family}';font-style:normal;font-weight:${font.weight};font-display:block;src:url(data:font/woff2;base64,${fontData.get(id)}) format('woff2')}`;
  });
  return rules.length ? `<style>${rules.join('')}</style>` : '';
}

/** Plain text of a block (for titles, alt text and tests). */
export function blockText(block) {
  return block.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
}
