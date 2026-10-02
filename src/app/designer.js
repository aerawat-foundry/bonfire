// Poster designer: a rich-text editor for the text above and below the
// artwork, and controls to move and resize the artwork (sliders, or drag it
// on the poster). Produces { top, bottom, layout } for compose.js and keeps
// the design in the page URL (d=) so it can be shared.

import {
  FONTS, fontById, defaultTop, defaultBottom, normalizeBlock, INK, ACCENT, ALIGNS,
} from '../core/richtext.js';
import { DEFAULT_LAYOUT, normalizeLayout, W, H } from '../core/compose.js';
import { ensureFont } from './fontloader.js';

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const SWATCHES = [INK, ACCENT, '#1d1510', '#f0a970', '#ffffff'];

// --- design <-> URL ---------------------------------------------------------------

const b64url = {
  encode: (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  decode: (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))),
};

function readDesign() {
  const url = new URLSearchParams(location.search);
  let d = {};
  try {
    if (url.has('d')) d = JSON.parse(b64url.decode(url.get('d')));
  } catch { /* a damaged link falls back to the defaults */ }
  return {
    top: normalizeBlock(d.t, defaultTop()),
    bottom: normalizeBlock(d.b, defaultBottom()),
    layout: normalizeLayout(d.l),
  };
}

// --- model <-> editor HTML -----------------------------------------------------------

function runToHtml(r) {
  const css = [];
  if (r.bold) css.push('font-weight:bold');
  if (r.italic) css.push('font-style:italic');
  const deco = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.push(`text-decoration:${deco}`);
  if (r.color) css.push(`color:${r.color}`);
  if (r.font) css.push(`font-family:'${fontById(r.font).family}'`);
  if (r.scale) css.push(`font-size:${r.scale}em`);
  return css.length ? `<span style="${css.join(';')}">${esc(r.text)}</span>` : esc(r.text);
}

function blockToHtml(block) {
  return block.paragraphs.map((p) =>
    `<div style="text-align:${p.align}">${p.runs.map(runToHtml).join('') || '<br>'}</div>`).join('');
}

const familyToId = (family) => {
  const name = (family || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  return FONTS.find((f) => f.family === name)?.id;
};

function toHex(color) {
  if (!color) return null;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color.toLowerCase();
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? '#' + m.slice(1, 4).map((v) => (+v).toString(16).padStart(2, '0')).join('') : null;
}

/** Inline style of a text node, from the editor root down. */
function styleOf(node, root) {
  const st = {};
  const chain = [];
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) chain.unshift(el);
  for (const el of chain) {
    const tag = el.tagName;
    if (tag === 'B' || tag === 'STRONG') st.bold = true;
    if (tag === 'I' || tag === 'EM') st.italic = true;
    if (tag === 'U') st.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') st.strike = true;
    if (tag === 'FONT') {
      if (el.color) st.color = toHex(el.color);
      if (el.face && familyToId(el.face)) st.font = familyToId(el.face);
    }
    const s = el.style;
    if (s.fontWeight) st.bold = s.fontWeight === 'bold' || +s.fontWeight >= 600;
    if (s.fontStyle) st.italic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
    const deco = `${s.textDecoration} ${s.textDecorationLine}`;
    if (/underline/.test(deco)) st.underline = true;
    if (/line-through/.test(deco)) st.strike = true;
    if (s.color) st.color = toHex(s.color);
    if (s.fontFamily && familyToId(s.fontFamily)) st.font = familyToId(s.fontFamily);
    if (s.fontSize && /em$/.test(s.fontSize)) st.scale = (st.scale || 1) * parseFloat(s.fontSize);
  }
  return st;
}

/** Read the editor's DOM back into a block's paragraphs. */
function htmlToParagraphs(root) {
  const paragraphs = [];
  let cur = null;
  const start = (align) => {
    cur = { align, runs: [] };
    paragraphs.push(cur);
  };
  const alignOf = (el) => {
    for (let e = el; e && e !== root.parentElement; e = e.parentElement) {
      const a = e.style?.textAlign || e.getAttribute?.('align');
      if (a) return a === 'start' ? 'left' : a === 'end' ? 'right' : a;
    }
    return 'center';
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue.replace(/ /g, ' ').replace(/[\r\n]+/g, ' ');
        if (!text) continue;
        if (!cur) start(alignOf(child.parentElement));
        const st = styleOf(child, root);
        const last = cur.runs[cur.runs.length - 1];
        const same = last && ['bold', 'italic', 'underline', 'strike', 'color', 'font', 'scale'].every((k) => (last[k] ?? null) === (st[k] ?? null));
        if (same) last.text += text;
        else cur.runs.push({ text, ...st });
      } else if (child.nodeName === 'BR') {
        start(cur?.align || alignOf(child.parentElement));
      } else if (/^(DIV|P|H[1-6]|LI|BLOCKQUOTE)$/.test(child.nodeName)) {
        start(alignOf(child));
        walk(child);
        cur = null;
      } else {
        walk(child);
      }
    }
  };
  walk(root);
  return paragraphs.filter((p) => p.runs.some((r) => r.text.trim()));
}

// --- the component -----------------------------------------------------------------

/**
 * mount: element for the controls; onChange: called with nothing whenever the
 * design changes (fonts are loaded first). Returns
 * { ready, value(), params(), attachPoster(el), setArtRect(rect) }.
 */
export function designer(mount, onChange) {
  const design = readDesign();
  let active = 'top';

  mount.classList.add('designer');
  mount.innerHTML = `
    <div class="tabs" role="tablist" aria-label="Text block">
      <button type="button" role="tab" data-block="top" aria-selected="true">Text above</button>
      <button type="button" role="tab" data-block="bottom" aria-selected="false">Text below</button>
    </div>
    <div class="toolbar" role="toolbar" aria-label="Text formatting">
      <select data-cmd="font" title="Font" aria-label="Font">
        ${FONTS.map((f) => `<option value="${f.id}">${esc(f.label)}</option>`).join('')}
      </select>
      <select data-cmd="size" title="Size of selected text" aria-label="Size of selected text">
        ${SIZES.map((s) => `<option value="${s}"${s === 1 ? ' selected' : ''}>${Math.round(s * 100)}%</option>`).join('')}
      </select>
      <span class="group">
        <button type="button" data-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold"><b>B</b></button>
        <button type="button" data-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic"><i>I</i></button>
        <button type="button" data-cmd="underline" title="Underline (Ctrl+U)" aria-label="Underline"><u>U</u></button>
        <button type="button" data-cmd="strikeThrough" title="Strike-through" aria-label="Strike-through"><s>S</s></button>
      </span>
      <span class="group">
        ${ALIGNS.map((a) => `<button type="button" data-cmd="align" data-align="${a}" title="Align ${a}" aria-label="Align ${a}">${alignIcon(a)}</button>`).join('')}
      </span>
      <span class="group colors">
        ${SWATCHES.map((c) => `<button type="button" data-cmd="color" data-color="${c}" class="swatch" style="--c:${c}" title="Colour ${c}" aria-label="Colour ${c}"></button>`).join('')}
        <label class="swatch picker" title="Any colour"><input type="color" data-cmd="colorpick" value="${ACCENT}" aria-label="Pick a colour" /></label>
      </span>
      <button type="button" data-cmd="removeFormat" title="Clear formatting" aria-label="Clear formatting">⌫ style</button>
    </div>
    <div class="editor" contenteditable="true" spellcheck="true" data-block="top" aria-label="Text above the art"></div>
    <div class="editor" contenteditable="true" spellcheck="true" data-block="bottom" aria-label="Text below the art" hidden></div>
    <p class="hint-text">Select text, then style it. Enter starts a new paragraph, each with its own alignment.
      <button type="button" class="linklike" data-cmd="resetText">Reset text</button></p>
    <div class="sliders" data-for="block">
      <label>Base size <output data-out="size"></output><input type="range" data-prop="size" min="2" max="25" step="0.1" /></label>
      <label>Line spacing <output data-out="lineHeight"></output><input type="range" data-prop="lineHeight" min="0.7" max="2" step="0.05" /></label>
      <label>Letter spacing <output data-out="letterSpacing"></output><input type="range" data-prop="letterSpacing" min="-0.05" max="0.4" step="0.01" /></label>
      <label>Text box width <output data-out="width"></output><input type="range" data-prop="width" min="30" max="100" step="1" /></label>
    </div>
    <fieldset class="ember-layout">
      <legend>Ember</legend>
      <label>Position <output data-out="artOffset"></output><input type="range" data-layout="artOffset" min="-40" max="40" step="0.5" /></label>
      <label>Size <output data-out="artScale"></output><input type="range" data-layout="artScale" min="0.4" max="1.8" step="0.01" /></label>
      <p class="hint-text">Or drag the ember on the poster to move it, and its corner to resize.
        <button type="button" class="linklike" data-cmd="resetLayout">Reset position</button></p>
    </fieldset>`;

  const q = (s) => mount.querySelector(s);
  const qa = (s) => [...mount.querySelectorAll(s)];
  const editors = { top: q('.editor[data-block="top"]'), bottom: q('.editor[data-block="bottom"]') };

  const paintEditor = (key) => {
    const b = design[key];
    const ed = editors[key];
    ed.innerHTML = blockToHtml(b) || '<div style="text-align:center"><br></div>';
    ed.style.fontFamily = `'${fontById(b.font).family}', sans-serif`;
    ed.style.fontWeight = fontById(b.font).weight;
    ed.style.color = b.color;
  };
  const paintControls = () => {
    const b = design[active];
    for (const input of qa('[data-prop]')) input.value = b[input.dataset.prop];
    q('[data-out="size"]').textContent = `${(+b.size).toFixed(1)}%`;
    q('[data-out="lineHeight"]').textContent = `${(+b.lineHeight).toFixed(2)}×`;
    q('[data-out="letterSpacing"]').textContent = `${(+b.letterSpacing).toFixed(2)} em`;
    q('[data-out="width"]').textContent = `${b.width}%`;
    q('[data-cmd="font"]').value = b.font;
    for (const input of qa('[data-layout]')) input.value = design.layout[input.dataset.layout];
    q('[data-out="artOffset"]').textContent = `${design.layout.artOffset > 0 ? '+' : ''}${(+design.layout.artOffset).toFixed(1)}`;
    q('[data-out="artScale"]').textContent = `${Math.round(design.layout.artScale * 100)}%`;
  };
  paintEditor('top');
  paintEditor('bottom');
  paintControls();

  // --- change propagation (fonts load first) ---
  let token = 0;
  const usedFonts = () => {
    const ids = new Set();
    for (const b of [design.top, design.bottom]) {
      ids.add(b.font);
      for (const p of b.paragraphs) for (const r of p.runs) if (r.font) ids.add(r.font);
    }
    return [...ids];
  };
  const changed = async () => {
    const mine = ++token;
    try {
      await Promise.all(usedFonts().map(ensureFont));
    } catch { /* offline: fall back */ }
    if (mine === token) onChange();
  };
  let timer;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(changed, 140);
  };
  const readEditor = (key) => {
    design[key] = normalizeBlock({ ...design[key], paragraphs: htmlToParagraphs(editors[key]) }, design[key]);
  };

  // --- tabs ---
  for (const tab of qa('[role="tab"]')) {
    tab.addEventListener('click', () => {
      active = tab.dataset.block;
      for (const t of qa('[role="tab"]')) t.setAttribute('aria-selected', String(t === tab));
      for (const [key, ed] of Object.entries(editors)) ed.hidden = key !== active;
      paintControls();
    });
  }

  // --- editors ---
  for (const [key, ed] of Object.entries(editors)) {
    ed.addEventListener('input', () => {
      readEditor(key);
      later();
    });
    ed.addEventListener('focus', () => { active = key; });
    // Paste as plain text: formatting comes from the toolbar.
    ed.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
    });
  }

  // --- toolbar ---
  const editor = () => editors[active];
  const exec = (cmd, arg) => {
    editor().focus();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(cmd, false, arg);
    readEditor(active);
    changed();
    reflect();
  };
  const hasSelection = () => {
    const sel = getSelection();
    return sel.rangeCount && !sel.isCollapsed && editor().contains(sel.anchorNode);
  };
  // Keep the editor's selection when toolbar buttons are pressed.
  q('.toolbar').addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });
  q('.toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (cmd === 'align') {
      exec({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[btn.dataset.align]);
    } else if (cmd === 'color') {
      exec('foreColor', btn.dataset.color);
    } else {
      exec(cmd);
    }
  });
  q('[data-cmd="colorpick"]').addEventListener('input', (e) => exec('foreColor', e.target.value));
  q('[data-cmd="font"]').addEventListener('change', (e) => {
    const font = fontById(e.target.value);
    if (hasSelection()) {
      exec('fontName', font.family);
    } else {
      // No selection: the whole block's font.
      design[active].font = font.id;
      paintEditor(active);
      changed();
    }
  });
  q('[data-cmd="size"]').addEventListener('change', (e) => {
    const scale = +e.target.value;
    if (!hasSelection()) {
      e.target.value = '1';
      return;
    }
    editor().focus();
    document.execCommand('styleWithCSS', false, false);
    document.execCommand('fontSize', false, '7');
    // Swap the browser's size markers for a relative size.
    for (const el of editor().querySelectorAll('font[size="7"], span[style*="xxx-large"]')) {
      const span = document.createElement('span');
      span.style.fontSize = `${scale}em`;
      if (el.tagName === 'FONT') {
        span.append(...el.childNodes);
        el.replaceWith(span);
      } else {
        el.style.fontSize = `${scale}em`;
      }
    }
    e.target.value = '1';
    readEditor(active);
    changed();
  });
  const reflect = () => {
    for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough']) {
      let on = false;
      try {
        on = document.queryCommandState(cmd);
      } catch { /* unsupported */ }
      q(`[data-cmd="${cmd}"]`).classList.toggle('on', on && editor().contains(getSelection().anchorNode));
    }
  };
  document.addEventListener('selectionchange', reflect);

  // --- block sliders ---
  for (const input of qa('[data-prop]')) {
    input.addEventListener('input', () => {
      design[active] = normalizeBlock({ ...design[active], [input.dataset.prop]: +input.value }, design[active]);
      paintControls();
      later();
    });
  }
  q('[data-cmd="resetText"]').addEventListener('click', () => {
    design.top = defaultTop();
    design.bottom = defaultBottom();
    paintEditor('top');
    paintEditor('bottom');
    paintControls();
    changed();
  });

  // --- ember layout ---
  const setLayout = (patch) => {
    design.layout = normalizeLayout({ ...design.layout, ...patch });
    paintControls();
    changed();
  };
  for (const input of qa('[data-layout]')) {
    input.addEventListener('input', () => setLayout({ [input.dataset.layout]: +input.value }));
  }
  q('[data-cmd="resetLayout"]').addEventListener('click', () => setLayout({ ...DEFAULT_LAYOUT }));

  // --- drag the artwork on the poster ---
  let artRect = null;
  let posterEl = null;
  let overlay = null;
  const placeOverlay = () => {
    const svg = posterEl?.querySelector('svg');
    if (!svg || !artRect || !overlay) return;
    const box = svg.getBoundingClientRect();
    const host = posterEl.getBoundingClientRect();
    const k = box.width / W;
    Object.assign(overlay.style, {
      left: `${box.left - host.left + artRect.x * k}px`,
      top: `${box.top - host.top + artRect.y * k}px`,
      width: `${artRect.w * k}px`,
      height: `${artRect.h * k}px`,
    });
  };
  const attachPoster = (el) => {
    posterEl = el;
    el.classList.add('poster-host');
    overlay = document.createElement('div');
    overlay.className = 'art-handle';
    overlay.title = 'Drag to move the ember; drag the corner to resize';
    overlay.innerHTML = '<span class="corner" title="Drag to resize"></span>';
    el.append(overlay);
    let drag = null;
    overlay.addEventListener('pointerdown', (e) => {
      const svg = el.querySelector('svg');
      const k = svg.getBoundingClientRect().width / W; // px per poster unit
      drag = {
        mode: e.target.classList.contains('corner') ? 'resize' : 'move',
        x: e.clientX, y: e.clientY, k,
        start: { ...design.layout },
        rect: { ...artRect },
      };
      overlay.setPointerCapture(e.pointerId);
      overlay.classList.add('dragging');
      e.preventDefault();
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = (e.clientX - drag.x) / drag.k;
      const dy = (e.clientY - drag.y) / drag.k;
      if (drag.mode === 'move') {
        setLayout({ artOffset: drag.start.artOffset + (dy / H) * 100 });
      } else {
        // Grow with the diagonal, keeping the art centred.
        const grow = (drag.rect.w + 2 * dx + drag.rect.h + 2 * dy) / (drag.rect.w + drag.rect.h);
        setLayout({ artScale: drag.start.artScale * Math.max(0.2, grow) });
      }
    });
    const end = () => {
      drag = null;
      overlay.classList.remove('dragging');
    };
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
    window.addEventListener('resize', placeOverlay);
  };

  const ready = Promise.all(usedFonts().map(ensureFont)).catch(() => {});

  return {
    ready,
    value: () => ({ top: design.top, bottom: design.bottom, layout: design.layout }),
    params: () => {
      const d = {};
      if (JSON.stringify(design.top) !== JSON.stringify(defaultTop())) d.t = design.top;
      if (JSON.stringify(design.bottom) !== JSON.stringify(defaultBottom())) d.b = design.bottom;
      if (design.layout.artScale !== 1 || design.layout.artOffset !== 0) d.l = design.layout;
      return Object.keys(d).length ? [['d', b64url.encode(JSON.stringify(d))]] : [];
    },
    attachPoster,
    setArtRect: (rect) => {
      artRect = rect;
      requestAnimationFrame(placeOverlay);
    },
  };
}

function alignIcon(a) {
  const rows = {
    left: [[3, 14], [3, 10], [3, 16], [3, 8]],
    center: [[5, 14], [7, 10], [4, 16], [8, 8]],
    right: [[7, 14], [11, 10], [5, 16], [13, 8]],
    justify: [[3, 18], [3, 18], [3, 18], [3, 11]],
  }[a];
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${rows.map(([x, w], i) => `<rect x="${x}" y="${5 + i * 4}" width="${w}" height="2" rx="1"/>`).join('')}</svg>`;
}
