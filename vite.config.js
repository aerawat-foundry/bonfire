import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/** Emit sw.js with the exact list of built files to precache for offline use. */
function serviceWorker() {
  const template = readFileSync(resolve(import.meta.dirname, 'src/sw-template.js'), 'utf8');
  return {
    name: 'ember-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle), 'manifest.webmanifest',
        'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png', 'icons/icon.svg']
        .filter((f) => !f.endsWith('.map'))
        .sort();
      const version = createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', 'scan/', ...files], null, 2)),
      });
    },
  };
}

export default defineConfig(async ({ mode }) => ({
  // Relative asset paths, so the build works from any sub-path (e.g. GitHub Pages).
  base: './',
  // `npm run dev:phone`: HTTPS on the local network, so a phone can open the camera.
  plugins: [serviceWorker(), ...(mode === 'phone' ? [(await import('@vitejs/plugin-basic-ssl')).default()] : [])],
  build: {
    rollupOptions: {
      input: {
        generator: resolve(import.meta.dirname, 'index.html'),
        scanner: resolve(import.meta.dirname, 'scan/index.html'),
      },
    },
  },
}));
