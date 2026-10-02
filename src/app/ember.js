import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { renderEmberQr } from '../core/emberqr.js';
import { composePoster } from '../core/compose.js';
import { CODE_PATTERN } from '../core/name.js';
import { emberUrl, recallName } from './site.js';
import { designer } from './designer.js';
import { downloadSvg, downloadPng, svgToCanvas } from './export.js';
import './pwa.js'; // service worker

prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

const $ = (id) => document.getElementById(id);
const code = location.pathname.replace(/\/+$/, '').split('/').pop().toLowerCase();

if (!CODE_PATTERN.test(code)) {
  $('ember-main').hidden = true;
  $('missing').hidden = false;
  document.title = 'Ember · not found';
} else {
  show();
}

function show() {
  const url = emberUrl(code);
  const name = recallName(code);
  const possessive = name ? `${name}’${/s$/i.test(name) ? '' : 's'} Ember` : 'An Ember';
  $('ember-title').textContent = possessive;
  document.title = `${possessive} · Ember`;
  $('ember-lede').textContent = name
    ? 'This is yours. Its QR leads straight back here, so share it, print it, or scan it from a screen.'
    : 'Scan the poster with any phone camera to come back to this page.';
  $('link').value = url;

  // The artwork depends only on the link; the page around it is redesigned freely.
  const art = renderEmberQr(url, { hideTiming: true }).art;
  const posterEl = $('poster');
  let svg = '';
  let timer;
  const design = designer($('designer'), () => paint());
  design.attachPoster(posterEl);
  function paint() {
    const page = composePoster(art, design.value());
    svg = page.svg;
    posterEl.querySelector('svg')?.remove();
    posterEl.insertAdjacentHTML('afterbegin', svg);
    design.setArtRect(page.artRect);
    const q = new URLSearchParams(design.params());
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
    clearTimeout(timer);
    $('scancheck').className = 'scancheck wait';
    $('scancheck').textContent = 'Checking that it scans…';
    timer = setTimeout(() => check(svg, url), 350);
  }
  design.ready.then(paint);

  const fileBase = `ember-${code}`;
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      $('copy').textContent = 'Copied';
    } catch {
      $('link').select();
    }
  });
  $('share').hidden = !navigator.share;
  $('share').addEventListener('click', () => navigator.share({ title: possessive, url }).catch(() => {}));
  $('dl-svg').addEventListener('click', () => downloadSvg(svg, `${fileBase}.svg`));
  $('dl-png').addEventListener('click', () => downloadPng(svg, `${fileBase}.png`));
}

/** Make sure this poster really leads back here before anyone prints it. */
let checkToken = 0;
async function check(svg, url) {
  const token = ++checkToken;
  const el = $('scancheck');
  try {
    const canvas = await svgToCanvas(svg, 1100);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const res = await readBarcodes(data, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
    if (token !== checkToken) return;
    const ok = res[0]?.text === url;
    el.className = `scancheck ${ok ? 'ok' : 'bad'}`;
    el.textContent = ok ? '✓ Scans back to this page' : '⚠ This poster did not scan back to its link: make the ember bigger';
  } catch (e) {
    if (token !== checkToken) return;
    el.className = 'scancheck bad';
    el.textContent = `Scan check failed to run: ${e.message}`;
  }
}
