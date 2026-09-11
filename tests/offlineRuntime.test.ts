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

test('the refresh resumes once the credential has left the URL', async () => {
  const browser = installBrowser({ controller: true, href: 'https://xbar.test/app/reset-password#access_token=a' });
  try {
    await registerOfflineRuntime();
    browser.claim();
    assert.deepEqual(browser.reloads, []);
    // What `window.location.hash = ''` leaves behind: a bare '#', no params.
    browser.location.href = 'https://xbar.test/app/reset-password#';
    browser.claim();
    assert.deepEqual(browser.reloads, ['https://xbar.test/app/reset-password#'], 'the guard must lift, not latch');
  } finally {
    uninstallBrowser();
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
