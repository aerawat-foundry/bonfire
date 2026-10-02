import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { renderEmberQr } from '../core/emberqr.js';
import { CODE_PATTERN } from '../core/name.js';
import { emberUrl, recallName } from './site.js';
import { typeControls } from './typecontrols.js';
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

  let svg = '';
  const type = typeControls($('type-controls'), () => render());
  function render() {
    svg = renderEmberQr(url, { hideTiming: true, ...type.value() }).svg;
    $('poster').innerHTML = svg;
    const q = new URLSearchParams(type.params());
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
    check(svg, url);
  }
  type.ready.then(render);

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
  $('dl-svg').addEventListener('click', () => download(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase}.svg`));
  $('dl-png').addEventListener('click', async () => {
    const w = +svg.match(/ width="(\d+)"/)[1];
    const canvas = await toCanvas(svg, w * 3);
    canvas.toBlob((blob) => download(blob, `${fileBase}.png`), 'image/png');
  });
}

async function toCanvas(svg, width) {
  const w = +svg.match(/ width="(\d+)"/)[1];
  const h = +svg.match(/ height="(\d+)"/)[1];
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((h / w) * width);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return canvas;
}

/** Make sure this poster really leads back here before anyone prints it. */
let checkToken = 0;
async function check(svg, url) {
  const token = ++checkToken;
  const el = $('scancheck');
  el.className = 'scancheck wait';
  el.textContent = 'Checking that it scans…';
  try {
    const canvas = await toCanvas(svg, 900);
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const res = await readBarcodes(data, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
    if (token !== checkToken) return;
    const ok = res[0]?.text === url;
    el.className = `scancheck ${ok ? 'ok' : 'bad'}`;
    el.textContent = ok ? '✓ Scans back to this page' : '⚠ This poster did not scan back to its link';
  } catch (e) {
    el.className = 'scancheck bad';
    el.textContent = `Scan check failed to run: ${e.message}`;
  }
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
