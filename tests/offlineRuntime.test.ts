import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  getOfflineAssetCacheStatus,
  offlineAssetCachePresentation,
  registerOfflineRuntime,
  resetOfflineRuntime,
  subscribeOfflineAssetCacheStatus,
  urlCarriesAuthCallback,
} from '../src/lib/offlineRuntime.js';

/*
 * A browser with a service worker that can be told to claim the page.
 *
 * `controller` is the whole subject here: the real worker installs with
 * skipWaiting() and activates with clients.claim(), so it fires
 * 'controllerchange' on a page that had NO controller as readily as on one
 * taking an update. Only the rig can tell those two apart, so it models them
 * separately rather than firing one generic event.
 */
function installBrowser(
  options: {
    controller?: boolean;
    href?: string;
    now?: number;
    noWorker?: boolean;
    registerFails?: boolean;
    updateFails?: boolean;
  } = {},
) {
  const listeners: Array<() => void> = [];
  const reloads: string[] = [];
  const location = {
    href: options.href ?? 'https://xbar.test/app/settings',
    reload: () => reloads.push(location.href),
  };
  const serviceWorker = {
    controller: options.controller ? {} : null,
    addEventListener: (type: string, handler: () => void) => {
      if (type === 'controllerchange') listeners.push(handler);
    },
    register: async () => {
      if (options.registerFails) throw new Error('Worker registration refused');
      return {
        active: options.noWorker ? null : {},
        waiting: null,
        installing: null,
        update: async () => {
          if (options.updateFails) throw new Error('No network for worker update');
        },
      };
    },
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker, onLine: true } });
  // A clock the test drives, so an exemption measured in minutes can be
  // exercised without waiting for them.
  let nowMs = options.now ?? 0;
  resetOfflineRuntime({ now: () => nowMs });
  return {
    reloads,
    location,
    advance: (ms: number) => {
      nowMs += ms;
    },
    // What clients.claim() does to an open page: a worker becomes the
    // controller, and only then is the event dispatched.
    claim: () => {
      serviceWorker.controller = {};
      for (const handler of [...listeners]) handler();
    },
  };
}

function uninstallBrowser() {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined });
  resetOfflineRuntime();
}

test('a first claim does not reload the page', async () => {
  const browser = installBrowser({ controller: false });
  try {
    assert.equal(await registerOfflineRuntime(), 'registered');
    browser.claim();
    assert.deepEqual(
      browser.reloads,
      [],
      'the page had no controller, so the worker that just claimed it cannot be serving anything staler than what already loaded',
    );
  } finally {
    uninstallBrowser();
  }
});

test('a worker replacing an earlier one still reloads the page', async () => {
  const browser = installBrowser({ controller: true });
  try {
    await registerOfflineRuntime();
    browser.claim();
    assert.deepEqual(
      browser.reloads,
      ['https://xbar.test/app/settings'],
      'this page is running assets the new worker has replaced; refusing to refresh here would leave a deploy half-applied',
    );
  } finally {
    uninstallBrowser();
  }
});

test('an update does not reload a page still holding a recovery link', async () => {
  const href = 'https://xbar.test/app/reset-password#access_token=token-abc&refresh_token=r&type=recovery';
  const browser = installBrowser({ controller: true, href });
  try {
    await registerOfflineRuntime();
    browser.claim();
    assert.deepEqual(
      browser.reloads,
      [],
      'auth-js clears the fragment before the session is stored, so a reload here can leave the token in neither place and burn a one-time link',
    );
  } finally {
    uninstallBrowser();
  }
});

test('clearing the callback URL does not authorize a reload before session persistence', async () => {
  const browser = installBrowser({ controller: true, href: 'https://xbar.test/app/reset-password#access_token=a' });
  try {
    await registerOfflineRuntime();
    browser.claim();
    assert.deepEqual(browser.reloads, []);
    // What `window.location.hash = ''` leaves behind: a bare '#', no params.
    browser.location.href = 'https://xbar.test/app/reset-password#';
    browser.claim();
    assert.deepEqual(browser.reloads, [], 'a cleared URL is not proof that the session was persisted');
  } finally {
    uninstallBrowser();
  }
});

test('an update does not reload a page still carrying an unread failure reason', async () => {
  /*
   * The full path, not just the recogniser: an earlier worker controls this
   * page, a new one takes over, and the URL is the one that actually exists at
   * registration -- `main.tsx` has already rewritten `#error=...` into
   * `?authError=...` by then.
   *
   * Nothing is at risk of being burned here; a rejected callback holds no
   * credential. What is at risk is the explanation. The screen reads the reason
   * and removes it from the URL, so a reload landing after that returns an
   * ordinary sign-in form with no account of why the link did not work, and
   * nothing left anywhere to rebuild one from.
   */
  for (const href of [
    'https://xbar.test/app/login?authError=otp_expired',
    'https://xbar.test/app/#/login?authError=otp_expired',
  ]) {
    const browser = installBrowser({ controller: true, href });
    try {
      await registerOfflineRuntime();
      browser.claim();
      assert.deepEqual(browser.reloads, [], `a takeover reload must not erase the only record of the failure: ${href}`);
    } finally {
      uninstallBrowser();
    }
  }
});

test('repeated claims reload at most once', async () => {
  const browser = installBrowser({ controller: true });
  try {
    await registerOfflineRuntime();
    browser.claim();
    browser.claim();
    browser.claim();
    assert.equal(browser.reloads.length, 1, 'a queued refresh must not be re-queued into a reload loop');
  } finally {
    uninstallBrowser();
  }
});

test('an auth callback is recognised in both flows and nowhere else', () => {
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/reset-password#access_token=a&refresh_token=b'), true);
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/login#error=access_denied&error_code=otp_expired'), true);
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/login?code=pkce-code'), true);
  // Cleared by auth-js: a bare '#' with nothing in it.
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/reset-password#'), false);
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/horses/abc#notes'), false);
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/settings'), false);
});

test('a rejected callback is recognised in the shape it actually has at registration', () => {
  /*
   * The three above are what SUPABASE sends, which is not what is in the URL
   * when the worker is registered. `main.tsx` rewrites `#error=...` into a
   * readable `authError` at module scope and calls `registerOfflineRuntime()`
   * afterwards, so by then the fragment those match is already gone -- and a
   * worker takeover reload lands after the screen has consumed and removed the
   * reason, leaving an ordinary sign-in form with nothing to explain it.
   */
  // Browser router: the path stays where Supabase sent them, the reason moves
  // into the query.
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/login?authError=otp_expired'), true);
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/reset-password?authError=access_denied'), true);
  // Hash router: the fragment is the route, so the reason is in a query string
  // of its own INSIDE the hash.
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/#/login?authError=otp_expired'), true);
  // Still nothing to protect on an ordinary page that merely has a query or a
  // hash route of its own.
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/horses?sort=name'), false);
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/#/login'), false);
  assert.equal(urlCarriesAuthCallback('https://xbar.test/app/#/horses?sort=name'), false);
});

/*
 * Both exemptions below were unbounded: set once, true for the document's
 * lifetime. Each one correctly skipped the reload it was written for, and then
 * skipped every genuine deployment takeover afterwards -- leaving the tab on
 * the runtime it booted with while the new deployment removed the chunks its
 * lazy routes were still going to request.
 */
test('a tab that started uncontrolled still reloads for a LATER deployment', async () => {
  const browser = installBrowser({ controller: false });
  try {
    assert.equal(await registerOfflineRuntime(), 'registered');
    browser.claim();
    assert.deepEqual(browser.reloads, [], 'precondition: the first claim is not a reason to reload');
    // A new deployment activates and claims the page again, minutes later.
    browser.advance(10 * 60_000);
    browser.claim();
    assert.deepEqual(
      browser.reloads,
      ['https://xbar.test/app/settings'],
      'the page is controlled now, so a takeover after it is a genuinely newer runtime',
    );
  } finally {
    uninstallBrowser();
  }
});

test('a tab that began on an auth callback stays exempt while the credential could still be in flight', async () => {
  const browser = installBrowser({
    controller: true,
    href: 'https://xbar.test/app/login#access_token=abc&refresh_token=def',
  });
  try {
    assert.equal(await registerOfflineRuntime(), 'registered');
    // auth-js has cleared the fragment but may not have stored the session yet.
    browser.location.href = 'https://xbar.test/app/login';
    browser.advance(5_000);
    browser.claim();
    assert.deepEqual(browser.reloads, [], 'a reload here destroys a one-time credential with nothing left to retry');
  } finally {
    uninstallBrowser();
  }
});

test('that exemption ends, so a later deployment is not swallowed by it', async () => {
  const browser = installBrowser({
    controller: true,
    href: 'https://xbar.test/app/login#access_token=abc&refresh_token=def',
  });
  try {
    assert.equal(await registerOfflineRuntime(), 'registered');
    browser.location.href = 'https://xbar.test/app/horses';
    browser.advance(10 * 60_000);
    browser.claim();
    assert.deepEqual(
      browser.reloads,
      ['https://xbar.test/app/horses'],
      'ten minutes later there is no credential in flight, only a stale runtime',
    );
  } finally {
    uninstallBrowser();
  }
});

test('a URL still carrying the callback is exempt however long it has been', async () => {
  const href = 'https://xbar.test/app/login#access_token=abc&refresh_token=def';
  const browser = installBrowser({ controller: true, href });
  try {
    assert.equal(await registerOfflineRuntime(), 'registered');
    browser.advance(10 * 60_000);
    browser.claim();
    assert.deepEqual(
      browser.reloads,
      [],
      'the credential is in the URL right now, so elapsed time is not what decides this',
    );
  } finally {
    uninstallBrowser();
  }
});

test('Settings observes registration across delayed mounting, rejection and browsers without workers', async () => {
  for (const [options, expected] of [
    [{}, 'registered'],
    [{ updateFails: true }, 'registered'],
    [{ noWorker: true }, 'ready'],
    [{ registerFails: true }, 'failed'],
  ] as const) {
    installBrowser(options);
    const emitted: string[] = [];
    const unsubscribe = subscribeOfflineAssetCacheStatus(() => emitted.push(getOfflineAssetCacheStatus()));
    try {
      assert.equal(getOfflineAssetCacheStatus(), 'checking');
      const registration = registerOfflineRuntime();
      assert.equal(getOfflineAssetCacheStatus(), 'checking');
      assert.equal(await registration, expected);
      assert.equal(getOfflineAssetCacheStatus(), expected);
      assert.deepEqual(emitted, [expected]);
    } finally {
      unsubscribe();
      uninstallBrowser();
    }
  }
  assert.equal(await registerOfflineRuntime(), 'unsupported');
  assert.equal(getOfflineAssetCacheStatus(), 'unsupported');
});

test('Settings labels describe asset caching, never offline navigation readiness', () => {
  assert.equal(offlineAssetCachePresentation.registered.label, 'Asset cache worker registered');
  for (const status of Object.values(offlineAssetCachePresentation)) {
    assert.doesNotMatch(status.label, /offline shell|offline ready/i);
  }
  const route = readFileSync('src/routes/Settings.tsx', 'utf8');
  assert.match(route, /useSyncExternalStore\(subscribeOfflineAssetCacheStatus, getOfflineAssetCacheStatus/);
  assert.match(route, /Refreshing or reopening XBAR requires an\s+internet connection/);
  assert.doesNotMatch(route, /Offline shell registered/);
});

test('the real worker shows a static recovery notice only on supported cold navigation without reading any records', async () => {
  let fetchHandler: ((event: object) => void) | undefined;
  const cacheReads: string[] = [];
  const requests: { url: string; cache?: string }[] = [];
  const cachedAsset = { kind: 'cached-asset' };
  let nextNetworkResponse: Response | undefined;
  runInNewContext(readFileSync('public/xbar-service-worker.js', 'utf8'), {
    self: {
      location: { origin: 'https://xbar.test' },
      addEventListener: (event: string, handler: (event: object) => void) => {
        if (event === 'fetch') fetchHandler = handler;
      },
    },
    caches: {
      match: async ({ url }: { url: string }) => {
        cacheReads.push(url);
        return cachedAsset;
      },
    },
    fetch: async ({ url }: { url: string }, { cache }: { cache?: string } = {}) => {
      requests.push({ url, cache });
      if (nextNetworkResponse) return nextNetworkResponse;
      throw new Error('offline');
    },
    URL,
    Response,
  });
  function request(path: string, mode: string) {
    let response: Promise<Response> | undefined;
    fetchHandler?.({
      request: { url: `https://xbar.test${path}`, mode, method: 'GET' },
      respondWith: (value: Promise<Response>) => {
        response = value;
      },
    });
    return response;
  }
  for (const path of ['/app', '/app/horses']) {
    const fallback = await request(path, 'navigate')!;
    assert.equal(fallback.status, 503);
    assert.match(fallback.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(fallback.headers.get('cache-control'), 'no-store');
    assert.match(fallback.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    const html = await fallback.text();
    assert.match(html, /horse records are unavailable offline/i);
    assert.match(html, /reconnect and reload/i);
    assert.doesNotMatch(html, /<script|<form|<iframe|\/app\/horses/);
  }
  await assert.rejects(request('/app/horses?view=fixture-only', 'navigate')!, /offline/);
  await assert.rejects(request('/app/login', 'navigate')!, /offline/);
  await assert.rejects(request('/app/reset-password?code=fixture-code', 'navigate')!, /offline/);
  assert.deepEqual(cacheReads, []);
  assert.deepEqual(requests, [
    { url: 'https://xbar.test/app', cache: 'no-store' },
    { url: 'https://xbar.test/app/horses', cache: 'no-store' },
    { url: 'https://xbar.test/app/horses?view=fixture-only', cache: 'no-store' },
    { url: 'https://xbar.test/app/login', cache: 'no-store' },
    { url: 'https://xbar.test/app/reset-password?code=fixture-code', cache: 'no-store' },
  ]);
  for (const path of ['/app/', '/app/horses/']) {
    assert.equal((await request(path, 'navigate')!)?.status, 503);
  }
  assert.deepEqual(cacheReads, []);
  assert.equal(await request('/assets/horse-screen.js', 'cors'), cachedAsset);
  assert.deepEqual(cacheReads, ['https://xbar.test/assets/horse-screen.js']);
  assert.equal(request('/api/horses/private-data', 'cors'), undefined);
  for (const status of [200, 401, 503]) {
    nextNetworkResponse = new Response('network result', { status });
    assert.equal(
      await request('/app', 'navigate'),
      nextNetworkResponse,
      'real server responses pass through unchanged',
    );
  }
  assert.deepEqual(cacheReads, ['https://xbar.test/assets/horse-screen.js']);
});
