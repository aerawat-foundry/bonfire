import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fontById, measure, layoutBlock, renderBlock, normalizeBlock, defaultTop, defaultBottom, registerFontData, fontFaces, blockText,
} from '../src/core/richtext.js';
import { composePoster, normalizeLayout, W, H } from '../src/core/compose.js';
import { renderEmberQr } from '../src/core/emberqr.js';
import { renderPoster } from '../src/core/render.js';

// Rebuild each line's text: pieces that touch belong to one word.
const lineTexts = (block) => layoutBlock(normalizeBlock(block, defaultTop()), W).lines
  .map((l) => l.pieces.map((p, i) => (i && p.x - (l.pieces[i - 1].x + l.pieces[i - 1].w) > 1e-6 ? ' ' : '') + p.text).join(''));

test('default text sets in the original lines', () => {
  assert.deepEqual(lineTexts(defaultTop()), ['Humankind’s', 'greatest tech', 'began with fire.']);
  assert.deepEqual(lineTexts(defaultBottom()), ['This `this.side.of.tech`', 'is You.']);
});

test('measured widths match the browser within kerning', () => {
  // Chromium's own width for this line in Momo Trust Display: 13.552 em.
  assert.ok(Math.abs(measure(fontById('momo'), 'Humankind’s greatest tech') / 13.552 - 1) < 0.02);
});

test('lines never overflow the text box, in any alignment', () => {
  const words = 'Embers rise from the column and drift into the night like a story told twice'.split(' ');
  for (const align of ['left', 'center', 'right', 'justify']) {
    for (const width of [40, 70, 100]) {
      const block = normalizeBlock({ size: 8, width, paragraphs: [{ align, runs: [{ text: words.join(' ') }] }] }, defaultTop());
      const boxL = (W - (width / 100) * W) / 2;
      for (const line of layoutBlock(block, W).lines) {
        const first = line.pieces[0];
        const last = line.pieces[line.pieces.length - 1];
        assert.ok(first.x >= boxL - 1e-6, `${align} ${width}: starts inside`);
        assert.ok(last.x + last.w <= boxL + (width / 100) * W + 1e-6, `${align} ${width}: ends inside`);
      }
    }
  }
});

test('alignment places lines left, centre, right and full width', () => {
  const at = (align) => {
    const b = normalizeBlock({ size: 6, width: 80, paragraphs: [{ align, runs: [{ text: 'one two three four five six seven eight nine ten eleven' }] }] }, defaultTop());
    const line = layoutBlock(b, W).lines[0];
    return { start: line.pieces[0].x, end: line.pieces.at(-1).x + line.pieces.at(-1).w };
  };
  assert.ok(Math.abs(at('left').start - 10) < 1e-6);
  assert.ok(Math.abs(at('right').end - 90) < 1e-6);
  const c = at('center');
  assert.ok(Math.abs((c.start + c.end) / 2 - 50) < 1e-6);
  const j = at('justify');
  assert.ok(Math.abs(j.start - 10) < 1e-6 && Math.abs(j.end - 90) < 1e-6);
});

test('runs keep their styles; bold, underline and strike are drawn', () => {
  const block = normalizeBlock({ paragraphs: [{ align: 'left', runs: [
    { text: 'bold ', bold: true }, { text: 'italic ', italic: true }, { text: 'under', underline: true },
    { text: ' gone', strike: true, color: '#c8400c' }, { text: ' big', scale: 2, font: 'anton' },
  ] }] }, defaultTop());
  const svg = renderBlock(block, layoutBlock(block, W), 0, W);
  assert.match(svg, /stroke="#1e4a2b"[^>]*>bold</);
  assert.match(svg, /font-style="italic"[^>]*>italic</);
  assert.equal((svg.match(/<rect /g) || []).length, 2); // underline + strike lines
  assert.match(svg, /fill="#c8400c"[^>]*>gone</);
  assert.match(svg, /font-family="'Anton'/);
});

test('text is escaped and junk input is cleaned', () => {
  const block = normalizeBlock({ size: 999, color: 'red;evil', paragraphs: [{ align: 'sideways', runs: [{ text: '<b>&' }, { text: 5 }] }] }, defaultTop());
  assert.equal(block.size, 40);
  assert.equal(block.color, '#1e4a2b');
  assert.equal(block.paragraphs[0].align, 'center');
  assert.match(renderBlock(block, layoutBlock(block, W), 0, W), /&lt;b&gt;&amp;/);
  assert.equal(blockText(block), '<b>&');
});

test('only loaded fonts are embedded', () => {
  registerFontData('anton', 'QUFB');
  const css = fontFaces([normalizeBlock({ font: 'anton' }, defaultTop()), defaultBottom()]);
  assert.match(css, /'Anton'.*base64,QUFB/);
  assert.doesNotMatch(css, /Momo/);
});

test('the ember moves and resizes; the page stays 2:3', () => {
  const art = renderEmberQr('https://example.com', { version: 6 }).art;
  const base = composePoster(art, {});
  assert.match(base.svg, /viewBox="0 0 100 150"/);
  const up = composePoster(art, { layout: { artOffset: -10 } });
  assert.ok(Math.abs(up.artRect.y - (base.artRect.y - 15)) < 1e-6);
  const big = composePoster(art, { layout: { artScale: 1.5 } });
  assert.ok(Math.abs(big.artRect.w / base.artRect.w - 1.5) < 1e-6);
  assert.deepEqual(normalizeLayout({ artScale: 99, artOffset: 'x' }), { artScale: 1.8, artOffset: 0 });
  // Empty text gives the ember the whole page.
  const bare = composePoster(art, { top: { paragraphs: [] }, bottom: { paragraphs: [] } });
  assert.ok(bare.artRect.w > base.artRect.w);
});

test('both posters compose with custom text', () => {
  const top = { paragraphs: [{ align: 'left', runs: [{ text: 'Hello', bold: true }] }] };
  for (const svg of [renderPoster('x', { top }).svg, renderEmberQr('https://example.com', { version: 6, top }).svg]) {
    assert.match(svg, /viewBox="0 0 100 150"/);
    assert.match(svg, />Hello</);
  }
  assert.equal(H, 150);
});
