import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * /ember/<code> is one page for every code: serve ember/index.html for it in
 * the dev and preview servers. Production hosts get the same rule from
 * public/_redirects (Netlify, Cloudflare Pages) or vercel.json.
 */
function emberRoutes() {
  const rewrite = (req, _res, next) => {
    const path = req.url.split('?')[0];
    if (/^\/ember\/[^/.]+\/?$/.test(path)) req.url = '/ember/index.html';
    next();
  };
  return {
    name: 'ember-routes',
    configureServer: (server) => { server.middlewares.use(rewrite); },
    configurePreviewServer: (server) => { server.middlewares.use(rewrite); },
  };
}

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
        source: template.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['./', 'generate/', 'qr/', 'scan/', 'ember/', ...files], null, 2)),
      });
    },
  };
}

export default defineConfig(async ({ mode }) => ({
  // Absolute asset paths: pages are served from deep links like /ember/<code>.
  base: '/',
  // `npm run dev:phone`: HTTPS on the local network, so a phone can open the camera.
  plugins: [emberRoutes(), serviceWorker(), ...(mode === 'phone' ? [(await import('@vitejs/plugin-basic-ssl')).default()] : [])],
  build: {
    rollupOptions: {
      input: {
        home: resolve(import.meta.dirname, 'index.html'),
        generator: resolve(import.meta.dirname, 'generate/index.html'),
        ember: resolve(import.meta.dirname, 'ember/index.html'),
        scanner: resolve(import.meta.dirname, 'scan/index.html'),
        emberqr: resolve(import.meta.dirname, 'qr/index.html'),
      },
    },
  },
}));
