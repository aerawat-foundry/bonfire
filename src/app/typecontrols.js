// Caption text, font and type-size controls shared by the poster pages. The
// choice is read from and written to the page URL (tt=, bt=, f=, ts=) so a
// design can be shared.

import {
  FONTS, DEFAULT_FONT, TYPE_SIZES, DEFAULT_TYPE_SIZE, DEFAULT_TOP_TEXT, DEFAULT_BOTTOM_TEXT, fontById,
} from '../core/typography.js';
import { ensureFont } from './fontloader.js';

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * Render the controls into `mount`; `onChange` runs whenever they change
 * (after the chosen font has loaded).
 * Returns { ready: Promise, value(): {...}, params(): [[key, value], ...] }.
 */
export function typeControls(mount, onChange) {
  const url = new URLSearchParams(location.search);
  const font = FONTS.some((f) => f.id === url.get('f')) ? url.get('f') : DEFAULT_FONT;
  const size = TYPE_SIZES.some((s) => s.id === url.get('ts')) ? url.get('ts') : DEFAULT_TYPE_SIZE;
  const topText = url.has('tt') ? url.get('tt') : DEFAULT_TOP_TEXT;
  const bottomText = url.has('bt') ? url.get('bt') : DEFAULT_BOTTOM_TEXT;

  mount.classList.add('type-controls');
  mount.innerHTML = `
    <label>Text above the art
      <textarea id="tc-top" rows="2" spellcheck="true">${esc(topText)}</textarea>
    </label>
    <label>Text below the art
      <textarea id="tc-bottom" rows="2" spellcheck="true">${esc(bottomText)}</textarea>
    </label>
    <p class="hint-text">Press Enter to break a line yourself. Wrap words in *stars* to make them glow orange.
      <button type="button" class="linklike" id="tc-reset">Reset text</button></p>
    <label>Font
      <select id="tc-font">${FONTS.map((f) => `<option value="${f.id}"${f.id === font ? ' selected' : ''}>${esc(f.label)}</option>`).join('')}</select>
    </label>
    <p class="type-preview" id="tc-preview" aria-hidden="true">Humankind’s greatest tech</p>
    <fieldset class="seg" aria-label="Type size">
      <legend>Type size</legend>
      ${TYPE_SIZES.map((s) => `<label><input type="radio" name="tc-size" value="${s.id}"${s.id === size ? ' checked' : ''} /> ${s.label} <small>${s.id}</small></label>`).join('')}
    </fieldset>`;

  const $ = (sel) => mount.querySelector(sel);
  const value = () => ({
    font: $('#tc-font').value,
    typeSize: $('input[name="tc-size"]:checked').value,
    topText: $('#tc-top').value,
    bottomText: $('#tc-bottom').value,
  });

  let token = 0;
  const changed = async () => {
    const mine = ++token;
    const f = fontById($('#tc-font').value);
    try {
      await ensureFont(f.id);
    } catch { /* offline and never loaded: render with a fallback font */ }
    if (mine !== token) return; // a newer change is on its way
    const preview = $('#tc-preview');
    preview.style.fontFamily = `'${f.family}', sans-serif`;
    preview.style.fontWeight = f.weight;
    onChange();
  };
  let timer;
  const typed = () => {
    clearTimeout(timer);
    timer = setTimeout(changed, 160);
  };

  $('#tc-font').addEventListener('change', changed);
  for (const r of mount.querySelectorAll('input[name="tc-size"]')) r.addEventListener('change', changed);
  $('#tc-top').addEventListener('input', typed);
  $('#tc-bottom').addEventListener('input', typed);
  $('#tc-reset').addEventListener('click', () => {
    $('#tc-top').value = DEFAULT_TOP_TEXT;
    $('#tc-bottom').value = DEFAULT_BOTTOM_TEXT;
    changed();
  });

  // The page renders once the starting font is in.
  const ready = ensureFont(font).catch(() => {}).then(() => {
    const f = fontById(font);
    $('#tc-preview').style.fontFamily = `'${f.family}', sans-serif`;
    $('#tc-preview').style.fontWeight = f.weight;
  });

  return {
    ready,
    value,
    params: () => {
      const v = value();
      const out = [];
      if (v.topText !== DEFAULT_TOP_TEXT) out.push(['tt', v.topText]);
      if (v.bottomText !== DEFAULT_BOTTOM_TEXT) out.push(['bt', v.bottomText]);
      if (v.font !== DEFAULT_FONT) out.push(['f', v.font]);
      if (v.typeSize !== DEFAULT_TYPE_SIZE) out.push(['ts', v.typeSize]);
      return out;
    },
  };
}
