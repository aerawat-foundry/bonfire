// Installable app: service worker registration and the "Install" button.

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  // sw.js sits next to the manifest, at the app root, whatever path the site is served from.
  const manifest = document.querySelector('link[rel="manifest"]');
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', manifest.href)).catch(() => {});
  });
}

function toast(text) {
  const el = document.createElement('div');
  el.className = 'pwa-toast';
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 6000);
  el.addEventListener('click', () => el.remove());
}

/** Show `button` whenever the app can be installed; clicking installs it. */
export function setupInstall(button) {
  if (!button || installed()) return;
  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // keep the browser's mini-infobar; offer our own button
    deferred = e;
    button.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    button.hidden = true;
  });
  // iOS has no install prompt API: explain the Share-sheet route instead.
  if (isIOS) button.hidden = false;
  button.addEventListener('click', async () => {
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      button.hidden = true;
    } else if (isIOS) {
      toast('To install: tap the Share button, then “Add to Home Screen”.');
    }
  });
}
