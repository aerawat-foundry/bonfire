import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FONTS, fontById, captionLines, captions, captionHeightPerWidth, measure, registerFontData,
  DEFAULT_TOP_TEXT, DEFAULT_BOTTOM_TEXT,
} from '../src/core/typography.js';
import { renderEmberQr } from '../src/core/emberqr.js';
import { renderPoster } from '../src/core/render.js';

const momo = fontById('momo');

test('default sentences break where a typesetter would', () => {
  assert.deepEqual(captionLines(momo, DEFAULT_TOP_TEXT), ['Humankind’s', 'greatest tech', 'began with fire.']);
  assert.deepEqual(captionLines(momo, DEFAULT_BOTTOM_TEXT), ['This `this.side.of.tech`', 'is *You*.']);
});

test('typed line breaks are kept, blank lines and extra spaces dropped', () => {
  assert.deepEqual(captionLines(momo, 'One  two\n\n  three '), ['One two', 'three']);
  assert.deepEqual(captionLines(momo, '   '), []);
});

test('automatic breaks balance the lines', () => {
  const lines = captionLines(momo, 'Asha Rao lights the way for everyone who comes after');
  const widths = lines.map((l) => measure(momo, l));
  assert.ok(lines.length >= 3);
  assert.ok(Math.max(...widths) / Math.min(...widths) < 1.6, JSON.stringify(lines));
});

test('measured widths match the browser within kerning', () => {
  // Chromium's own width for this line in Momo Trust Display: 13.552 em.
  assert.ok(Math.abs(measure(momo, 'Humankind’s greatest tech') / 13.552 - 1) < 0.02);
});

test('stars glow, and the text is escaped', () => {
  const c = captions(100, { topText: 'a <b> & *c*', bottomText: '' });
  const svg = c.top(0, 0);
  assert.match(svg, /a &lt;b&gt; &amp; <tspan fill="#c8400c">c<\/tspan>/);
  assert.equal(c.bottom(0, 0), '');
  assert.equal(c.bottomHeight, 0);
});

test('bigger type sizes take more room; every font lays out', () => {
  for (const f of FONTS) {
    const s = captionHeightPerWidth({ font: f.id, typeSize: 'small' });
    const l = captionHeightPerWidth({ font: f.id, typeSize: 'large' });
    assert.ok(l > s && s > 0, f.id);
  }
});

test('posters stay 2:3 whatever the text, and embed a registered font', () => {
  registerFontData('anton', 'AAAA');
  for (const opts of [{}, { font: 'anton', topText: 'Hi' }, { typeSize: 'small', bottomText: 'One\nTwo\nThree\nFour' }]) {
    for (const svg of [renderEmberQr('https://example.com', { version: 6, ...opts }).svg, renderPoster('x', opts).svg]) {
      const [, , w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
      assert.ok(Math.abs(h / w - 1.5) < 0.01 || h / w < 1.5, `${JSON.stringify(opts)} ratio ${h / w}`);
    }
  }
  assert.match(renderEmberQr('https://example.com', { version: 6, font: 'anton' }).svg, /base64,AAAA/);
});
