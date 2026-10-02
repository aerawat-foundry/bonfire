// Load poster fonts on demand: each .woff2 is a static asset. Once loaded, a
// font is registered for embedding into posters (so downloads keep their
// type) and added to the page (for the live preview).

import { registerFontData, fontById } from '../core/typography.js';

const urls = import.meta.glob('../assets/fonts/*.woff2', { query: '?url', import: 'default', eager: true });
const loading = new Map();

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Resolves once the font can be drawn on screen and embedded in posters. */
export function ensureFont(id) {
  const font = fontById(id);
  if (!loading.has(font.id)) {
    const url = urls[`../assets/fonts/${font.id}.woff2`];
    loading.set(font.id, (async () => {
      const buffer = await (await fetch(url)).arrayBuffer();
      registerFontData(font.id, toBase64(buffer));
      const face = new FontFace(font.family, buffer, { weight: String(font.weight) });
      await face.load();
      document.fonts.add(face);
    })().catch((e) => {
      loading.delete(font.id); // let a later attempt retry
      throw e;
    }));
  }
  return loading.get(font.id);
}
