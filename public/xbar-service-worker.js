const XBAR_RUNTIME_CACHE_PREFIX = 'xbar-runtime-';
const XBAR_CACHE = 'xbar-runtime-v20260713-public-split';
const NETWORK_FIRST_ASSET_PATHS = [
  /^\/assets\//,
  /^\/brand\//,
  /^\/ocr\//,
  /^\/favicon\.svg$/,
  /^\/site\.webmanifest$/,
];

// Match only entry points tested for recovery. Never render a generic page
// over explicit auth, account, share, or query-bearing destinations.
const RECOVERABLE_NAVIGATION_PATHS = new Set(['/app', '/app/', '/app/horses', '/app/horses/']);

function offlineRecoveryResponse() {
  // Generated locally from literals, not persisted in Cache Storage and never
  // populated from the requested URL, an account, or a cached application page.
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connection needed | XBAR</title>
</head>
<body>
<main>
<h1>Connection needed</h1>
<p>XBAR could not reach the server. Horse records are unavailable offline.</p>
<p>Reconnect and reload this page to continue.</p>
</main>
</body>
</html>`,
    {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );
}

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
    const network = fetch(request, { cache: 'no-store' });
    // A service worker cannot reliably inspect URL fragments. The static notice
    // therefore runs no application/auth scripts and does not redirect or reload.
    event.respondWith(
      !url.search && RECOVERABLE_NAVIGATION_PATHS.has(url.pathname) ? network.catch(offlineRecoveryResponse) : network,
    );
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
