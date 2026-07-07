const XBAR_RUNTIME_CACHE_PREFIX = 'xbar-runtime-';
const XBAR_CACHE = 'xbar-runtime-v20260703-ocr-light';
const NETWORK_FIRST_ASSET_PATHS = [
  /^\/assets\//,
  /^\/brand\//,
  /^\/ocr\//,
  /^\/favicon\.svg$/,
  /^\/site\.webmanifest$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(XBAR_RUNTIME_CACHE_PREFIX) && key !== XBAR_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
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

  const shouldUseNetworkFirst = NETWORK_FIRST_ASSET_PATHS.some((pattern) => pattern.test(url.pathname));
  if (!shouldUseNetworkFirst) return;

  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (!response || response.status !== 200) return response;
        const clone = response.clone();
        caches.open(XBAR_CACHE).then((cache) => cache.put(request, clone));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || Response.error();
      }),
  );
});
