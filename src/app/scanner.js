import { prepareZXingModule } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { scanImage } from '../core/scan.js';

// Serve the ZXing WebAssembly from this site instead of a CDN.
prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

const $ = (id) => document.getElementById(id);
const viewer = $('viewer');
const video = $('video');
const still = $('still');
const overlay = $('overlay');
const hint = $('hint');
const statusEl = $('status');
const camBtn = $('camera');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });

let stream = null;
let running = false;
let found = null; // final result once the fire is read
let acc = { text: null, sum: new Map(), frames: 0 };

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const badge = (cls, label) => `<span class="badge ${cls}">${label}</span>`;
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);

function showResult(r, emberOverride) {
  if (!r) {
    $('r-qr').textContent = '–';
    $('r-ember').textContent = '–';
    $('r-hot').textContent = '–';
    return;
  }
  $('r-qr').innerHTML = isUrl(r.text)
    ? `<a href="${esc(r.text)}" target="_blank" rel="noopener noreferrer">${esc(r.text)}</a>`
    : esc(r.text);
  const ember = emberOverride || r.ember;
  if (ember.ok) {
    $('r-ember').innerHTML = `${esc(ember.text)}<br>${ember.match
      ? badge('ok', 'matches the QR')
      : badge('wait', 'differs from the QR (hidden message)')} ${badge('ok', `${ember.corrected} fixed`)}`;
  } else {
    $('r-ember').innerHTML = running
      ? badge('wait', `reading the fire… (${acc.frames} frames)`)
      : `${badge('bad', 'not read')} <small>${esc(ember.error || '')}</small>`;
  }
  const h = r.hotpoints;
  $('r-hot').innerHTML = h.expected
    ? `${h.hot}/${h.expected} glowing ${h.sealed ? badge('ok', 'sealed') : badge('bad', 'missing heat')}`
    : badge('bad', 'not checked (QR not made by Bonfire)');
}

/** Map image pixels to overlay coordinates (object-fit: contain). */
function fitter(w, h) {
  const box = viewer.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = box.width * dpr;
  overlay.height = box.height * dpr;
  const s = Math.min(box.width / w, box.height / h);
  const ox = (box.width - w * s) / 2;
  const oy = (box.height - h * s) / 2;
  return { dpr, map: (x, y) => [(ox + x * s) * dpr, (oy + y * s) * dpr], s: s * dpr };
}

function drawOverlay(r, w, h) {
  const ctx = overlay.getContext('2d');
  const { map, s } = fitter(w, h);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!r) return;
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#3ddc84';
  ctx.beginPath();
  r.quad.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](...map(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  const unit = (Math.hypot(r.quad[1].x - r.quad[0].x, r.quad[1].y - r.quad[0].y) / r.size) * s;
  const dot = Math.max(1.5, unit * 0.22);
  for (const c of r.cells) {
    const [x, y] = map(c.px, c.py);
    ctx.beginPath();
    ctx.arc(x, y, dot, 0, Math.PI * 2);
    if (c.ink > 0) {
      ctx.fillStyle = 'rgba(255,140,40,0.9)';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(120,220,255,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  for (const p of r.hotpoints.points) {
    const [x, y] = map(p.px, p.py);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(5, unit * 1.2), 0, Math.PI * 2);
    ctx.strokeStyle = p.heat > 0.25 ? '#3ddc84' : '#ff4d4d';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

function grab(source, w, h) {
  const scale = Math.min(1, 1600 / Math.max(w, h));
  work.width = Math.round(w * scale);
  work.height = Math.round(h * scale);
  wctx.drawImage(source, 0, 0, work.width, work.height);
  return { img: wctx.getImageData(0, 0, work.width, work.height), scale };
}

function scaled(r, k) {
  if (!r || k === 1) return r;
  const m = (p) => ({ ...p, x: p.x / k, y: p.y / k });
  return {
    ...r,
    quad: r.quad.map(m),
    cells: r.cells.map((c) => ({ ...c, px: c.px / k, py: c.py / k })),
    hotpoints: { ...r.hotpoints, points: r.hotpoints.points.map((p) => ({ ...p, px: p.px / k, py: p.py / k })) },
  };
}

async function loop() {
  if (!running) return;
  if (video.readyState >= 2 && !found) {
    const { img, scale } = grab(video, video.videoWidth, video.videoHeight);
    let r = null;
    try {
      r = await scanImage(img, { tryHarder: false });
    } catch (e) {
      statusEl.textContent = e.message;
    }
    if (r) {
      // Pool evidence across frames: each frame votes on every ember cell.
      if (acc.text !== r.text) acc = { text: r.text, sum: new Map(), frames: 0 };
      acc.frames++;
      for (const [k, v] of r.soft) acc.sum.set(k, (acc.sum.get(k) || 0) + v);
      let ember = r.ember;
      if (!ember.ok && acc.frames > 1) {
        try {
          ember = r.decodeSoft(new Map([...acc.sum].map(([k, v]) => [k, v / acc.frames])));
        } catch { /* keep collecting */ }
      }
      if (ember.ok) {
        found = { ...r, ember };
        statusEl.textContent = 'Fire read. Tap "Scan again" for another poster.';
        camBtn.textContent = 'Scan again';
      }
      showResult(r, ember);
      drawOverlay(scaled(r, scale), video.videoWidth, video.videoHeight);
    } else {
      drawOverlay(null, video.videoWidth, video.videoHeight);
    }
  }
  requestAnimationFrame(loop);
}

async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
  } catch (e) {
    statusEl.textContent = `Camera unavailable: ${e.message}. You can still open an image.`;
    return;
  }
  video.srcObject = stream;
  await video.play();
  still.hidden = true;
  video.hidden = false;
  hint.hidden = true;
  running = true;
  found = null;
  acc = { text: null, sum: new Map(), frames: 0 };
  showResult(null);
  camBtn.textContent = 'Stop camera';
  statusEl.textContent = 'Fit the flame, the QR and the whole plume of embers in the frame.';
  loop();
}

function stopCamera() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  camBtn.textContent = 'Start camera';
}

camBtn.addEventListener('click', () => {
  if (running && found) {
    found = null;
    acc = { text: null, sum: new Map(), frames: 0 };
    showResult(null);
    camBtn.textContent = 'Stop camera';
    statusEl.textContent = 'Scanning…';
  } else if (running) {
    stopCamera();
  } else {
    startCamera();
  }
});

async function scanFile(file) {
  if (!file) return;
  stopCamera();
  video.hidden = true;
  hint.hidden = true;
  still.src = URL.createObjectURL(file);
  still.hidden = false;
  await still.decode();
  statusEl.textContent = 'Reading…';
  const { img, scale } = grab(still, still.naturalWidth, still.naturalHeight);
  try {
    const r = await scanImage(img, { tryHarder: true });
    showResult(r);
    drawOverlay(scaled(r, scale), still.naturalWidth, still.naturalHeight);
    statusEl.textContent = r ? '' : 'No QR code found in this image.';
  } catch (e) {
    statusEl.textContent = e.message;
  }
}

$('file').addEventListener('change', (e) => scanFile(e.target.files[0]));
viewer.addEventListener('dragover', (e) => {
  e.preventDefault();
  viewer.classList.add('drag');
});
viewer.addEventListener('dragleave', () => viewer.classList.remove('drag'));
viewer.addEventListener('drop', (e) => {
  e.preventDefault();
  viewer.classList.remove('drag');
  scanFile(e.dataTransfer.files[0]);
});
