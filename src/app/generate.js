import { renderPoster } from '../core/render.js';
import { composePoster } from '../core/compose.js';
import { utf8 } from '../core/prng.js';
import { designer } from './designer.js';
import { downloadSvg, downloadPng, slug } from './export.js';
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

// The artwork is costly; the page around it (text, placement) is cheap. Keep
// the artwork and recompose the page on design changes.
let art = null; // { key, out, xray }
let current = null; // { text, svg }
const design = designer($('designer'), () => paint());
design.attachPoster(posterEl);

function buildArt() {
  const text = textEl.value.trim();
  const emberText = emberEl.value.trim() || undefined;
  try {
    const out = renderPoster(text, { emberText });
    art = { text, emberText, out, xray: xrayEl.checked ? renderPoster(text, { emberText, xray: true }) : null };
    errorEl.hidden = true;
    const { meta } = out;
    const used = utf8(meta.emberText).length;
    statsEl.innerHTML = `
      <dt>QR</dt><dd>version ${meta.version} · ${meta.size}×${meta.size} · error correction H</dd>
      <dt>Embers</dt><dd>${meta.emberCells} ember cells · ${used}/${meta.capacity.maxPayload} bytes
        <div class="meter"><i style="width:${Math.min(100, (100 * used) / meta.capacity.maxPayload)}%"></i></div></dd>
      <dt>Hotpoints</dt><dd>${meta.hotpoints.length}</dd>`;
  } catch (e) {
    art = null;
    errorEl.textContent = e.message;
    errorEl.hidden = false;
  }
  paint();
}

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
    const q = new URLSearchParams({ t: art.text });
    if (art.emberText) q.set('e', art.emberText);
    for (const [k, v] of design.params()) q.set(k, v);
    history.replaceState(null, '', `?${q}`);
  }
  for (const b of [$('dl-svg'), $('dl-png')]) b.disabled = !current;
}

let timer;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(buildArt, 120);
};
textEl.addEventListener('input', schedule);
emberEl.addEventListener('input', schedule);
xrayEl.addEventListener('change', buildArt);

$('dl-svg').addEventListener('click', () => current && downloadSvg(current.svg, `ember-${slug(current.text)}.svg`));
$('dl-png').addEventListener('click', () => current && downloadPng(current.svg, `ember-${slug(current.text)}.png`));

design.ready.then(buildArt);
setupInstall(document.getElementById('install'));
