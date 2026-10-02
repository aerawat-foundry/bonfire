import { prepareZXingModule } from 'zxing-wasm/reader';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { scanImage } from '../core/scan.js';
import { setupInstall } from './pwa.js';

// Serve the ZXing WebAssembly from this site instead of a CDN.
prepareZXingModule({
  overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
});

const $ = (id) => document.getElementById(id);
const root = $('scanner');
const video = $('video');
const still = $('still');
const overlay = $('overlay');
const hint = $('hint');
const sheet = $('sheet');
const modeSwitch = $('ember-mode');
const fileInput = $('file');
const work = document.createElement('canvas');
const wctx = work.getContext('2d', { willReadFrequently: true });

const state = {
  stream: null,
  facing: 'environment',
  wanted: false, // camera was running (resume it when the page is shown again)
  paused: false, // result sheet open
  still: null, // File being shown instead of the camera
  busy: false,
  acc: { text: null, sum: new Map(), frames: 0 },
  lastQr: null, // newest ember-mode frame that found a QR
};

// ---------------------------------------------------------------- mode ----

const storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const isEmber = () => modeSwitch.checked;

function applyMode() {
  root.dataset.mode = isEmber() ? 'ember' : 'standard';
  state.acc = { text: null, sum: new Map(), frames: 0 };
  state.lastQr = null;
  if (state.stream && !state.paused) setHint(idleHint());
}

const initialMode = new URLSearchParams(location.search).get('mode') || storage.get('ember.mode');
modeSwitch.checked = initialMode !== 'standard';
applyMode();
modeSwitch.addEventListener('change', () => {
  storage.set('ember.mode', isEmber() ? 'ember' : 'standard');
  applyMode();
  if (state.still) {
    scanFile(state.still); // re-read the same image in the new mode
  } else if (state.paused) {
    hideSheet(); // resume the camera in the new mode
    setHint(idleHint());
  }
});

// --------------------------------------------------------------- helpers ----

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const isUrl = (s) => /^https?:\/\/\S+$/i.test(s);
const badge = (cls, label) => `<span class="badge ${cls}">${label}</span>`;
const idleHint = () => (isEmber() ? 'Fit the flame, QR and whole fire in the frame' : 'Point at a QR code');

function setHint(html) {
  hint.innerHTML = html;
}

function grab(source, w, h, max) {
  const scale = Math.min(1, max / Math.max(w, h));
  work.width = Math.round(w * scale);
  work.height = Math.round(h * scale);
  wctx.drawImage(source, 0, 0, work.width, work.height);
  return { img: wctx.getImageData(0, 0, work.width, work.height), scale };
}

// ---------------------------------------------------------------- overlay ----

/** Project image pixels onto the overlay, matching the element's object-fit. */
function projector(w, h, fit) {
  const box = root.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(box.width * dpr);
  overlay.height = Math.round(box.height * dpr);
  const s = (fit === 'cover' ? Math.max : Math.min)(box.width / w, box.height / h);
  const ox = (box.width - w * s) / 2;
  const oy = (box.height - h * s) / 2;
  return { map: (x, y) => [(ox + x * s) * dpr, (oy + y * s) * dpr], k: s * dpr };
}

function clearOverlay() {
  overlay.getContext('2d').clearRect(0, 0, overlay.width, overlay.height);
}

/** r is in work-canvas pixels; `scale` maps source pixels to work pixels. */
function drawOverlay(r, scale, w, h, fit) {
  const ctx = overlay.getContext('2d');
  const { map, k } = projector(w, h, fit);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!r) return;
  const at = (x, y) => map(x / scale, y / scale);
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#4ade80';
  ctx.beginPath();
  r.quad.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](...at(p.x, p.y)));
  ctx.closePath();
  ctx.stroke();
  if (r.mode !== 'ember') return;
  const unit = (Math.hypot(r.quad[1].x - r.quad[0].x, r.quad[1].y - r.quad[0].y) / r.size / scale) * k;
  const dot = Math.max(1.2, unit * 0.2);
  for (const c of r.cells) {
    ctx.beginPath();
    ctx.arc(...at(c.px, c.py), dot, 0, Math.PI * 2);
    if (c.ink > 0) {
      ctx.fillStyle = 'rgba(255,138,61,0.9)';
      ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(160,220,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  for (const p of r.hotpoints.points) {
    ctx.beginPath();
    ctx.arc(...at(p.px, p.py), Math.max(5, unit * 1.2), 0, Math.PI * 2);
    ctx.strokeStyle = p.heat > 0.25 ? '#4ade80' : '#ff6b6b';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
}

// ----------------------------------------------------------------- result ----

function showSheet(r, { ember, note } = {}) {
  state.paused = true;
  root.classList.add('paused');
  setHint('');
  const layers = [];
  if (!r) {
    layers.push(`<div class="layer"><h3>No code found</h3><p><small>${esc(note || 'No QR code was found in this image.')}</small></p></div>`);
  } else {
    const qrText = isUrl(r.text)
      ? `<a href="${esc(r.text)}" target="_blank" rel="noopener noreferrer">${esc(r.text)}</a>`
      : esc(r.text);
    layers.push(`<div class="layer"><h3>Standard QR</h3><p>${qrText}</p></div>`);
    if (r.mode === 'ember') {
      const e = ember || r.ember;
      layers.push(e.ok
        ? `<div class="layer"><h3>Fire · ember code</h3><p>${esc(e.text)}</p>
            ${e.match ? badge('ok', 'matches the QR') : badge('info', 'hidden message: differs from the QR')}
            ${badge('ok', `${e.corrected} bytes repaired`)}</div>`
        : `<div class="layer"><h3>Fire · ember code</h3><p><small>Not read. ${esc(note || 'Make sure the whole plume is in the picture and in focus.')}</small></p>
            ${badge('bad', 'not read')}</div>`);
      const h = r.hotpoints;
      layers.push(h.expected
        ? `<div class="layer"><h3>Hotpoints</h3><p>${h.hot}/${h.expected} glowing</p>
            ${h.sealed ? badge('ok', 'sealed: genuine Ember print') : badge('bad', 'missing heat: possibly a flat copy')}</div>`
        : `<div class="layer"><h3>Hotpoints</h3><p><small>Not checked: this QR was not made by Ember.</small></p></div>`);
    }
  }
  $('layers').innerHTML = layers.join('');
  const link = $('open-link');
  link.hidden = !(r && isUrl(r.text));
  if (r && isUrl(r.text)) link.href = r.text;
  $('copy').hidden = !r;
  $('copy').textContent = 'Copy text';
  $('copy').onclick = async () => {
    const e = ember || r?.ember;
    const text = e?.ok && !e.match ? `${r.text}\n${e.text}` : r.text;
    try {
      await navigator.clipboard.writeText(text);
      $('copy').textContent = 'Copied';
    } catch {
      $('copy').textContent = 'Copy failed';
    }
  };
  sheet.hidden = false;
  navigator.vibrate?.(35);
}

function hideSheet() {
  sheet.hidden = true;
  state.paused = false;
  root.classList.remove('paused');
  state.acc = { text: null, sum: new Map(), frames: 0 };
  state.lastQr = null;
  clearOverlay();
}

$('again').addEventListener('click', () => {
  hideSheet();
  if (state.still) {
    state.still = null;
    still.hidden = true;
    root.classList.remove('still');
    URL.revokeObjectURL(still.src);
  }
  if (state.stream) {
    video.hidden = false;
    setHint(idleHint());
  } else {
    bootCamera();
  }
});

// ---------------------------------------------------------------- camera ----

const inFrame = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

/** Where to re-enable a camera that was blocked, for this platform. */
function resetSteps() {
  if (isIOS) {
    return installed
      ? 'On iPhone/iPad: open Settings ▸ Safari ▸ Camera and choose Ask or Allow, then reopen the app.'
      : 'On iPhone/iPad: tap ᴀA in the address bar ▸ Website Settings ▸ Camera ▸ Allow (or Settings ▸ Safari ▸ Camera), then try again.';
  }
  if (isAndroid) {
    return installed
      ? 'On Android: long-press the Ember app icon ▸ App info ▸ Permissions ▸ Camera ▸ Allow, then try again.'
      : 'On Android: tap the icon left of the address bar ▸ Permissions ▸ Camera ▸ Allow, then try again.';
  }
  return 'Click the camera (or lock/tune) icon in the address bar, set Camera to Allow, then try again.';
}

const PROBLEMS = {
  NotAllowedError: inFrame
    ? ['Camera blocked here', 'This page is embedded in another page, which is not allowed to use your camera. Open the scanner in its own tab.']
    : ['Camera is blocked', `Your browser is blocking the camera for this site, so it won’t ask again. ${resetSteps()}`],
  NotFoundError: ['No camera found', 'This device does not seem to have a camera. You can still scan a saved image.'],
  NotReadableError: ['Camera is busy', 'Another app or tab is using the camera. Close it, then try again.'],
  insecure: ['Secure connection needed', 'Browsers only allow the camera on https:// pages (or localhost). Open the scanner over https.'],
  unsupported: ['Camera not supported', 'This browser cannot open the camera. Try a recent Chrome, Safari or Firefox, or scan a saved image.'],
};
PROBLEMS.SecurityError = PROBLEMS.NotAllowedError;
PROBLEMS.OverconstrainedError = PROBLEMS.NotFoundError;
PROBLEMS.AbortError = PROBLEMS.NotReadableError;

/** Show the camera card: kind 'gate' asks for permission, 'problem' explains a failure. */
function showNotice(kind, title, text, action) {
  root.classList.add('blocked');
  $('notice').dataset.kind = kind;
  $('notice-title').textContent = title;
  $('notice-text').textContent = text;
  $('retry').textContent = action;
  $('retry').hidden = kind === 'problem' && inFrame;
  $('newtab').hidden = !inFrame;
  $('newtab').href = location.href;
  $('notice').hidden = false;
  setHint('');
}

function showProblem(reason, detail) {
  const [title, text] = PROBLEMS[reason] || ['Camera not available', detail || 'The camera could not be started.'];
  showNotice('problem', title, text, 'Try again');
}

function showGate(again = false) {
  showNotice(
    'gate',
    again ? 'Camera permission not given' : 'Scan with your camera',
    again
      ? 'The permission prompt was closed. Tap Enable camera and choose Allow.'
      : 'Tap Enable camera and choose Allow when your browser asks. The video stays on your device.',
    'Enable camera',
  );
}

/** 'granted' | 'denied' | 'prompt' | 'unknown' (Firefox and older Safari can't say). */
async function cameraPermission() {
  try {
    const status = await navigator.permissions.query({ name: 'camera' });
    status.onchange = () => {
      if (status.state === 'granted' && !state.stream && !state.still) startCamera();
    };
    return status.state;
  } catch {
    return 'unknown';
  }
}

async function startCamera() {
  // Inside an embed the frame is often "insecure" only because of its parent page.
  if (!window.isSecureContext) return showProblem(inFrame ? 'NotAllowedError' : 'insecure');
  if (!navigator.mediaDevices?.getUserMedia) return showProblem('unsupported');
  $('notice').hidden = true;
  root.classList.remove('blocked');
  setHint('Starting camera…');
  stopCamera();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: state.facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
  } catch (e) {
    if (e.name === 'OverconstrainedError') {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e2) {
        return showProblem(e2.name, e2.message);
      }
    } else if (e.name === 'NotAllowedError' && !inFrame && (await cameraPermission()) === 'prompt') {
      return showGate(true); // prompt dismissed, not blocked: let them ask again
    } else {
      return showProblem(e.name, e.message);
    }
  }
  state.stream = stream;
  state.wanted = true;
  video.srcObject = stream;
  video.hidden = !!state.still;
  try {
    await video.play();
  } catch { /* autoplay with muted+playsinline normally succeeds */ }
  if (!state.still && !state.paused) setHint(idleHint());

  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  const torch = $('torch');
  torch.hidden = !caps.torch;
  torch.setAttribute('aria-pressed', 'false');
  try {
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    $('flip').disabled = cams.length < 2;
  } catch {
    $('flip').disabled = true;
  }
  requestAnimationFrame(tick);
}

/**
 * Open the camera straight away only when permission is already granted.
 * Otherwise wait for a tap: browsers show the permission dialog reliably only
 * in response to a user gesture, and some (Safari, Chrome's quiet prompts,
 * installed apps) suppress or auto-block a prompt fired on page load.
 */
async function bootCamera() {
  if (!window.isSecureContext) return showProblem(inFrame ? 'NotAllowedError' : 'insecure');
  if (!navigator.mediaDevices?.getUserMedia) return showProblem('unsupported');
  const permission = await cameraPermission();
  if (permission === 'granted') return startCamera();
  if (permission === 'denied') return showProblem('NotAllowedError');
  showGate();
}

function stopCamera() {
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
}

$('retry').addEventListener('click', startCamera); // a tap: the dialog is allowed to appear
$('flip').addEventListener('click', () => {
  state.facing = state.facing === 'environment' ? 'user' : 'environment';
  startCamera();
});
$('torch').addEventListener('click', async () => {
  const track = state.stream?.getVideoTracks()[0];
  if (!track) return;
  const on = $('torch').getAttribute('aria-pressed') !== 'true';
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] });
    $('torch').setAttribute('aria-pressed', String(on));
  } catch { /* not supported after all */ }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopCamera();
  } else if (state.wanted && !state.still) {
    startCamera();
  }
});

async function tick() {
  if (!state.stream) return;
  requestAnimationFrame(tick);
  if (state.busy || state.paused || state.still || video.readyState < 2) return;
  state.busy = true;
  try {
    await scanFrame();
  } catch (e) {
    setHint(esc(e.message));
  } finally {
    state.busy = false;
  }
}

async function scanFrame() {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const ember = isEmber();
  const { img, scale } = grab(video, w, h, ember ? 1600 : 1280);
  const r = await scanImage(img, { ember, tryHarder: false });
  if (state.paused || state.still || ember !== isEmber()) return; // things changed meanwhile
  drawOverlay(r, scale, w, h, 'cover');
  if (!r) return;
  if (!ember) {
    showSheet(r);
    return;
  }
  // Ember mode: pool every frame's reading of each cell until the fire decodes.
  const acc = state.acc;
  if (acc.text !== r.text) state.acc = { text: r.text, sum: new Map(), frames: 0 };
  state.acc.frames++;
  for (const [key, v] of r.soft) state.acc.sum.set(key, (state.acc.sum.get(key) || 0) + v);
  state.lastQr = r;
  let result = r.ember;
  if (!result.ok && state.acc.frames > 1) {
    try {
      const n = state.acc.frames;
      result = r.decodeSoft(new Map([...state.acc.sum].map(([key, v]) => [key, v / n])));
    } catch { /* keep collecting */ }
  }
  if (result.ok) {
    showSheet(r, { ember: result });
  } else {
    setHint(`QR found · reading the fire… ${state.acc.frames}<button type="button" id="qr-only">Use QR only</button>`);
  }
}

hint.addEventListener('click', (e) => {
  if (e.target.id === 'qr-only' && state.lastQr) {
    const r = state.lastQr;
    showSheet({ mode: 'standard', text: r.text, quad: r.quad, size: r.size });
  }
});

// ----------------------------------------------------------------- images ----

async function scanFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  sheet.hidden = true;
  state.paused = true;
  state.still = file;
  root.classList.add('still');
  $('notice').hidden = true;
  if (still.src) URL.revokeObjectURL(still.src);
  still.src = URL.createObjectURL(file);
  still.hidden = false;
  video.hidden = true;
  clearOverlay();
  setHint('Reading image…');
  try {
    await still.decode();
    const w = still.naturalWidth;
    const h = still.naturalHeight;
    const { img, scale } = grab(still, w, h, 2000);
    const r = await scanImage(img, { ember: isEmber(), tryHarder: true });
    if (state.still !== file) return; // a newer image replaced this one
    drawOverlay(r, scale, w, h, 'contain');
    showSheet(r, r ? {} : { note: 'No QR code was found in this image. Try a sharper or closer picture.' });
  } catch (e) {
    showSheet(null, { note: `Could not read this image (${e.message}).` });
  }
}

const pickImage = () => fileInput.click();
$('gallery').addEventListener('click', pickImage);
$('notice-upload').addEventListener('click', pickImage);
fileInput.addEventListener('change', () => {
  scanFile(fileInput.files[0]);
  fileInput.value = '';
});
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) scanFile(item.getAsFile());
});
root.addEventListener('dragover', (e) => {
  e.preventDefault();
  root.classList.add('drag');
});
root.addEventListener('dragleave', (e) => {
  if (e.target === root || !root.contains(e.relatedTarget)) root.classList.remove('drag');
});
root.addEventListener('drop', (e) => {
  e.preventDefault();
  root.classList.remove('drag');
  scanFile(e.dataTransfer.files[0]);
});

bootCamera();
setupInstall(document.getElementById('install'));
