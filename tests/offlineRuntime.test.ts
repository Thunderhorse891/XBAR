import assert from 'node:assert/strict';
import test from 'node:test';
import { registerOfflineRuntime, resetOfflineRuntime, urlCarriesAuthCallback } from '../src/lib/offlineRuntime.js';

/*
 * A browser with a service worker that can be told to claim the page.
 *
 * `controller` is the whole subject here: the real worker installs with
 * skipWaiting() and activates with clients.claim(), so it fires
 * 'controllerchange' on a page that had NO controller as readily as on one
 * taking an update. Only the rig can tell those two apart, so it models them
 * separately rather than firing one generic event.
 */
function installBrowser(options: { controller?: boolean; href?: string } = {}) {
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
    register: async () => ({ active: {}, waiting: null, installing: null, update: async () => {} }),
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker, onLine: true } });
  resetOfflineRuntime();
  return {
    reloads,
    location,
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
