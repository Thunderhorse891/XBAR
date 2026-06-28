const XBAR_CACHE = 'xbar-runtime-v20260628-design-sync';
const CACHEABLE_ASSET_PATHS = [/^\/assets\//, /^\/brand\//, /^\/favicon\.svg$/, /^\/site\.webmanifest$/];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== XBAR_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/xbar-service-worker.js') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  const shouldCache = CACHEABLE_ASSET_PATHS.some((pattern) => pattern.test(url.pathname));
  if (!shouldCache) return;

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (!response || response.status !== 200) return response;
      const clone = response.clone();
      caches.open(XBAR_CACHE).then((cache) => cache.put(request, clone));
      return response;
    }).catch(() => cached)),
  );
});
