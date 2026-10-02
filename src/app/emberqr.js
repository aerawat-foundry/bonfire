import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { renderEmberQr } from '../core/emberqr.js';
import { minVersion } from '../core/artqr.js';
import { utf8 } from '../core/prng.js';
import { composePoster } from '../core/compose.js';
import { designer } from './designer.js';
import { downloadSvg, downloadPng, svgToCanvas, slug } from './export.js';
import './pwa.js'; // service worker

prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

const $ = (id) => document.getElementById(id);
const textEl = $('text');
const versionEl = $('version');
const burnEl = $('burn');
const posterEl = $('poster');
const statsEl = $('stats');
const errorEl = $('error');
const checkEl = $('scancheck');
const level = () => document.querySelector('input[name="level"]:checked').value;

// Restore settings from the URL so a design can be shared.
const params = new URLSearchParams(location.search);
if (params.has('t')) textEl.value = params.get('t');
if (params.has('l')) {
  const r = document.querySelector(`input[name="level"][value="${params.get('l')}"]`);
  if (r) r.checked = true;
}
if (params.has('b')) burnEl.value = params.get('b');
if (params.has('ht')) $('hide-timing').checked = params.get('ht') === '1';
if (params.has('ba')) $('blend-align').checked = params.get('ba') === '1';
let wantedVersion = params.has('v') ? Number(params.get('v')) : null;

// The artwork (solving the QR) is costly; the page around it is cheap. Keep
// the artwork and recompose the page on design changes.
let art = null; // { text, out, xray, settings }
let current = null; // { text, svg }
let checkToken = 0;
const design = designer($('designer'), () => paint());
design.attachPoster(posterEl);

function update() {
  const text = textEl.value.trim();
  try {
    if (!text) throw new Error('Enter some text to burn.');
    const min = minVersion(utf8(text), level());
    versionEl.min = String(min);
    versionEl.max = String(Math.min(40, Math.max(min + 12, 25)));
    if (wantedVersion == null) wantedVersion = Math.max(min, 12);
    versionEl.value = String(Math.max(min, Math.min(+versionEl.max, wantedVersion)));
    const opts = {
      version: Number(versionEl.value),
      level: level(),
      burn: Number(burnEl.value) / 100,
      hideTiming: $('hide-timing').checked,
      blendAlignment: $('blend-align').checked,
    };
    const out = renderEmberQr(text, opts);
    art = { text, out, xray: $('xray').checked ? renderEmberQr(text, { ...opts, xray: true }) : null };
    errorEl.hidden = true;
    const m = out.meta;
    $('size-out').textContent = `version ${m.version} · ${m.size}×${m.size} modules`;
    $('burn-out').textContent = `${burnEl.value}% of the repair budget`;
    statsEl.innerHTML = `
      <dt>Picture</dt><dd>${Math.round(m.match * 100)}% of the embers drawn as wished
        <div class="meter"><i style="width:${Math.round(m.match * 100)}%"></i></div></dd>
      <dt>Free bits</dt><dd>${m.controlled} modules steered with zero errors</dd>
      <dt>Burned</dt><dd>${m.burnedCodewords} of ${m.correctable} repairable codewords
        (${m.correctable - m.burnedCodewords} left as margin)</dd>
      <dt>Mask</dt><dd>${m.mask} (chosen for the best picture)</dd>`;
    art.settings = { t: text, v: m.version, l: m.level, b: burnEl.value,
      ht: $('hide-timing').checked ? 1 : 0, ba: $('blend-align').checked ? 1 : 0 };
  } catch (e) {
    art = null;
    errorEl.textContent = e.message;
    errorEl.hidden = false;
    checkEl.textContent = '';
  }
  paint();
}

let checkTimer;
function paint() {
  if (!art) {
    current = null;
  } else {
    const d = design.value();
    const page = composePoster(art.out.art, d);
    current = { text: art.text, svg: page.svg };
    posterEl.querySelector('svg')?.remove();
    posterEl.insertAdjacentHTML('afterbegin', art.xray ? composePoster(art.xray.art, d).svg : page.svg);
    design.setArtRect(page.artRect);
    const q = new URLSearchParams(art.settings);
    for (const [k, v] of design.params()) q.set(k, v);
    history.replaceState(null, '', `?${q}`);
    // Re-check scanning once the design settles (dragging repaints often).
    clearTimeout(checkTimer);
    checkEl.className = 'scancheck wait';
    checkEl.textContent = 'Checking that it scans…';
    checkTimer = setTimeout(() => scanCheck(page.svg, art.text), 350);
  }
  for (const b of [$('dl-svg'), $('dl-png')]) b.disabled = !current;
}

/** Decode the design right here, at a large and a small size. */
async function scanCheck(svg, text) {
  const token = ++checkToken;
  checkEl.className = 'scancheck wait';
  checkEl.textContent = 'Checking that it scans…';
  try {
    let passed = 0;
    const sizes = [1100, 560];
    for (const width of sizes) {
      const canvas = await svgToCanvas(svg, width);
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      const res = await readBarcodes(data, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
      if (token !== checkToken) return;
      if (res[0]?.text === text) passed++;
    }
    checkEl.className = `scancheck ${passed === sizes.length ? 'ok' : 'bad'}`;
    checkEl.textContent = passed === sizes.length
      ? '✓ Scans as a standard QR (checked at two sizes)'
      : `⚠ Scanned at ${passed} of ${sizes.length} sizes: make the ember bigger, lower the burn, raise error correction, or turn off blending`;
  } catch (e) {
    if (token === checkToken) {
      checkEl.className = 'scancheck bad';
      checkEl.textContent = `Scan check failed to run: ${e.message}`;
    }
  }
}

let timer;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(update, 180);
};
textEl.addEventListener('input', schedule);
versionEl.addEventListener('input', () => {
  wantedVersion = Number(versionEl.value);
  schedule();
});
burnEl.addEventListener('input', schedule);
for (const el of document.querySelectorAll('input[name="level"], #hide-timing, #blend-align, #xray')) {
  el.addEventListener('change', update);
}

$('dl-svg').addEventListener('click', () => current && downloadSvg(current.svg, `ember-qr-${slug(current.text)}.svg`));
$('dl-png').addEventListener('click', () => current && downloadPng(current.svg, `ember-qr-${slug(current.text)}.png`));

design.ready.then(update);
