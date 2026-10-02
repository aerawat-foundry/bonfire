import { renderPoster } from '../core/render.js';
import { utf8 } from '../core/prng.js';
import { setupInstall } from './pwa.js';

const $ = (id) => document.getElementById(id);
const textEl = $('text');
const emberEl = $('ember-text');
const xrayEl = $('xray');
const posterEl = $('poster');
const statsEl = $('stats');
const errorEl = $('error');

const params = new URLSearchParams(location.search);
if (params.has('t')) textEl.value = params.get('t');
if (params.has('e')) emberEl.value = params.get('e');

let current = null;

function slug(s) {
  return s.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'bonfire';
}

function update() {
  const text = textEl.value.trim();
  const emberText = emberEl.value.trim() || undefined;
  try {
    const opts = { emberText };
    const out = renderPoster(text, opts);
    current = { text, opts, out };
    posterEl.innerHTML = xrayEl.checked ? renderPoster(text, { ...opts, xray: true }).svg : out.svg;
    errorEl.hidden = true;
    const { meta } = out;
    const used = utf8(meta.emberText).length;
    statsEl.innerHTML = `
      <dt>QR</dt><dd>version ${meta.version} · ${meta.size}×${meta.size} · error correction H</dd>
      <dt>Fire</dt><dd>${meta.emberCells} ember cells · ${used}/${meta.capacity.maxPayload} bytes
        <div class="meter"><i style="width:${Math.min(100, (100 * used) / meta.capacity.maxPayload)}%"></i></div></dd>
      <dt>Hotpoints</dt><dd>${meta.hotpoints.length}</dd>`;
    const q = new URLSearchParams({ t: text });
    if (emberText) q.set('e', emberText);
    history.replaceState(null, '', `?${q}`);
  } catch (e) {
    current = null;
    errorEl.textContent = e.message;
    errorEl.hidden = false;
  }
  for (const b of [$('dl-svg'), $('dl-png')]) b.disabled = !current;
}

let timer;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(update, 120);
};
textEl.addEventListener('input', schedule);
emberEl.addEventListener('input', schedule);
xrayEl.addEventListener('change', update);

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('dl-svg').addEventListener('click', () => {
  if (!current) return;
  download(new Blob([current.out.svg], { type: 'image/svg+xml' }), `bonfire-${slug(current.text)}.svg`);
});

$('dl-png').addEventListener('click', async () => {
  if (!current) return;
  const { svg } = current.out;
  const w = +svg.match(/ width="(\d+)"/)[1];
  const h = +svg.match(/ height="(\d+)"/)[1];
  const scale = 3; // ~36 px per module: print-ready at A3 and up
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  canvas.toBlob((blob) => download(blob, `bonfire-${slug(current.text)}.png`), 'image/png');
});

update();
setupInstall(document.getElementById('install'));
