// Compose a poster page: a fixed 2:3 sheet with a text block at the top, a
// text block at the bottom, and the artwork between them.
//
// The artwork fits the free space between the two blocks by default; the
// layout can then move it up or down and scale it:
//   layout = { artScale: 1, artOffset: 0 }
//     artScale   multiplier on the fitted size (0.4 .. 1.8)
//     artOffset  vertical shift, % of the poster height (-40 .. 40)

import { layoutBlock, renderBlock, fontFaces, normalizeBlock, defaultTop, defaultBottom } from './richtext.js';

export const W = 100;
export const H = 150;
export const PAPER = '#f7f4ee';
const MARGIN = 5.5; // outer margin, poster units
const GAP = 2.5; // between text and artwork

export const DEFAULT_LAYOUT = { artScale: 1, artOffset: 0 };

export function normalizeLayout(layout) {
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  return {
    artScale: num(layout?.artScale, 0.4, 1.8, 1),
    artOffset: num(layout?.artOffset, -40, 40, 0),
  };
}

const f = (v) => +v.toFixed(3);

/**
 * art = { defs, body, box: { x, y, w, h }, title?, desc? }  in the artwork's own units
 * Returns { svg, artRect: { x, y, w, h } (poster units), W, H }.
 */
export function composePoster(art, { top, bottom, layout, title = art.title || 'Ember', desc = art.desc || '' } = {}) {
  const topBlock = normalizeBlock(top, defaultTop());
  const bottomBlock = normalizeBlock(bottom, defaultBottom());
  const lay = normalizeLayout(layout);

  const topLaid = layoutBlock(topBlock, W);
  const bottomLaid = layoutBlock(bottomBlock, W);
  const topY = MARGIN;
  const bottomY = H - MARGIN - bottomLaid.height;

  // Fit the artwork into the free band, then apply the user's scale and shift.
  const bandTop = topLaid.height ? topY + topLaid.height + GAP : MARGIN;
  const bandBottom = bottomLaid.height ? bottomY - GAP : H - MARGIN;
  const band = Math.max(10, bandBottom - bandTop);
  const fit = Math.min((W - 2 * MARGIN) / art.box.w, band / art.box.h);
  const k = fit * lay.artScale;
  const artW = art.box.w * k;
  const artH = art.box.h * k;
  const artX = (W - artW) / 2;
  const artY = bandTop + (band - artH) / 2 + (lay.artOffset / 100) * H;
  const transform = `translate(${f(artX - art.box.x * k)} ${f(artY - art.box.y * k)}) scale(${f(k)})`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 12}" height="${H * 12}">
  <title>${title}</title>${desc ? `\n  <desc>${desc}</desc>` : ''}
  <defs>${fontFaces([topBlock, bottomBlock])}${art.defs}<clipPath id="page"><rect width="${W}" height="${H}"/></clipPath></defs>
  <rect width="${W}" height="${H}" fill="${PAPER}"/>
  <g clip-path="url(#page)">
  <g class="art" transform="${transform}" shape-rendering="crispEdges">${art.body}</g>
  ${renderBlock(topBlock, topLaid, topY, W)}
  ${renderBlock(bottomBlock, bottomLaid, bottomY, W)}
  </g>
</svg>`;
  return { svg, artRect: { x: artX, y: artY, w: artW, h: artH }, W, H };
}
