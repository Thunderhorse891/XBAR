import assert from 'node:assert/strict';
import test from 'node:test';
import { appBasePath, appRouteUrl, passwordResetPath, usesHashRouting } from '../src/lib/routeCanon.js';

/*
 * A link out of the app and back has to name the route the way the router that
 * will receive it expects. Getting this wrong does not throw: a browser-router
 * path under hash routing loads the shell at "/" and a hash path under browser
 * routing is discarded, so the customer lands somewhere plausible-looking and
 * nothing reports a fault. The password-recovery email is the case that
 * matters -- if it misses, the reset silently cannot be completed.
 */

type FakeWindow = { location: { hostname: string; origin: string } };

function withWindow(value: FakeWindow | undefined, run: () => void) {
  const globals = globalThis as { window?: FakeWindow };
  const had = 'window' in globals;
  const previous = globals.window;
  if (value === undefined) delete globals.window;
  else globals.window = value;
  try {
    run();
  } finally {
    if (had) globals.window = previous;
    else delete globals.window;
  }
}

const browserHost: FakeWindow = { location: { hostname: 'xbar.example', origin: 'https://xbar.example' } };
const pagesHost: FakeWindow = { location: { hostname: 'someone.github.io', origin: 'https://someone.github.io' } };

test('a normal host uses the browser router base path', () => {
  withWindow(browserHost, () => {
    assert.equal(usesHashRouting(), false);
    assert.equal(appRouteUrl('/reset-password'), 'https://xbar.example/app/reset-password');
  });
});

test('a github.io host uses hash routing, because that build does', () => {
  // GitHub Pages cannot serve the SPA from an arbitrary path, so the app runs
  // on the hash router there and a /app/... link would never resolve.
  withWindow(pagesHost, () => {
    assert.equal(usesHashRouting(), true);
    assert.equal(appRouteUrl('/reset-password'), 'https://someone.github.io/#/reset-password');
  });
});

test('the origin can be supplied, for a build with no window', () => {
  // The native build has to name a public origin rather than its own
  // capacitor:// scheme, which Supabase rejects outright.
  withWindow(undefined, () => {
    assert.equal(appRouteUrl('/reset-password', 'https://xbar.example'), 'https://xbar.example/app/reset-password');
  });
});

test('a path without a leading slash still produces one', () => {
  withWindow(browserHost, () => {
    assert.equal(appRouteUrl('reset-password'), 'https://xbar.example/app/reset-password');
  });
});

test('the recovery route is under the app base path, not the marketing site', () => {
  // "/" is prerendered marketing HTML that never loads the router, so a
  // recovery link pointed there would render a page with no form on it.
  withWindow(browserHost, () => {
    const url = appRouteUrl(passwordResetPath);
    assert.ok(url.includes(appBasePath), `${url} must sit under ${appBasePath}`);
    assert.ok(url.endsWith(passwordResetPath));
  });
});

test('no window at all is treated as browser routing rather than crashing', () => {
  withWindow(undefined, () => {
    assert.equal(usesHashRouting(), false);
  });
});
