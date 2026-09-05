import assert from 'node:assert/strict';
import test from 'node:test';
import {
  appBasePath,
  appRouteUrl,
  passwordResetPath,
  publicAppRouteUrl,
  usesHashRouting,
} from '../src/lib/routeCanon.js';

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

/*
 * The recovery link composed by a NATIVE build is a different problem from the
 * one composed by a web build, and conflating them was a real bug here.
 *
 * It is written inside the store bundle, which runs on the hash router, but the
 * customer opens it in the phone's browser -- where the public site runs the
 * browser router under /app. So it must carry the PUBLIC deployment's shape,
 * not the shape of the build that wrote it. The first version of this fix sent
 * the bare origin, which lands on the marketing homepage: static HTML that
 * never mounts the router, so a native customer still could not set a password
 * and nothing reported a fault.
 */

test('a native recovery link points at the reset screen, not the site root', () => {
  assert.equal(
    publicAppRouteUrl('/reset-password', 'https://xbar-horse-management-app.vercel.app'),
    'https://xbar-horse-management-app.vercel.app/app/reset-password',
  );
});

test('a native recovery link keeps the browser shape even from a hash build', () => {
  // VITE_ROUTER_MODE=hash is set for the store bundle, so anything deriving the
  // shape from the local build would emit a hash the deployed site ignores.
  const pagesLikeBuild: FakeWindow = {
    location: { hostname: 'someone.github.io', origin: 'https://someone.github.io' },
  };
  withWindow(pagesLikeBuild, () => {
    assert.equal(usesHashRouting(), true, 'precondition: this build is on the hash router');
    assert.equal(
      publicAppRouteUrl(passwordResetPath, 'https://xbar.example'),
      `https://xbar.example${appBasePath}${passwordResetPath}`,
      'the public link must not inherit the composing build router shape',
    );
  });
});

test('a public origin with a trailing slash does not produce a doubled slash', () => {
  assert.equal(
    publicAppRouteUrl('/reset-password', 'https://xbar.example/'),
    'https://xbar.example/app/reset-password',
  );
});

test('a hash build served from a sub-path keeps that base before the hash', () => {
  // vite.config.ts serves the GitHub Pages build from '/XBAR/', so a link to
  // the host root requests a page that is not the app shell.
  withWindow(pagesHost, () => {
    assert.equal(appRouteUrl(passwordResetPath, undefined, '/XBAR'), 'https://someone.github.io/XBAR/#/reset-password');
  });
});

test('a hash build served from the root has no stray base segment', () => {
  withWindow(pagesHost, () => {
    assert.equal(appRouteUrl(passwordResetPath, undefined, ''), 'https://someone.github.io/#/reset-password');
  });
});
