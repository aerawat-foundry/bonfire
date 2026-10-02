// Canonical address of the site: QR codes always point here, even when the
// page is opened on localhost or a preview deploy. Override at build time
// with VITE_SITE_ORIGIN.
export const SITE_ORIGIN = (import.meta.env.VITE_SITE_ORIGIN || 'https://thissideoftech.com').replace(/\/$/, '');

export const emberUrl = (code) => `${SITE_ORIGIN}/ember/${code}`;
export const emberPath = (code) => `/ember/${code}`;

// Remember names typed on this device, so their owner sees "Asha's Ember".
const KEY = 'ember.names';
export function rememberName(code, name) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) || '{}');
    all[code] = name.trim();
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private mode: the page still works without the name */ }
}
export function recallName(code) {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')[code] || null;
  } catch {
    return null;
  }
}
