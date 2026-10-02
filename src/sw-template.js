// Ember service worker. Generated at build time by vite.config.js, which
// fills in PRECACHE (every built file) and VERSION (a hash of that list).

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `ember-${VERSION}`;
const scoped = (path) => new URL(path, self.registration.scope).href;
// Hosts often send "Vary: Origin"; module scripts carry an Origin header the
// precache requests did not, which would otherwise make every lookup miss.
const MATCH = { ignoreVary: true, ignoreSearch: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map(scoped)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ember-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(self.registration.scope)) return;

  if (request.mode === 'navigate') {
    // Pages: fresh when online, cached when not.
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(CACHE);
          const url = new URL(request.url);
          return (await cache.match(request, MATCH))
            || (await cache.match(url.origin + url.pathname.replace(/index\.html$/, ''), MATCH))
            || cache.match(scoped('scan/'), MATCH);
        }),
    );
    return;
  }

  // Assets are content-hashed: cache first.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((hit) => hit || fetch(request).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })),
  );
});
