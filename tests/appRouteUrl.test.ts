import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  appBasePath,
  authRedirectUrl,
  loginPath,
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
    assert.equal(authRedirectUrl('/reset-password'), 'https://xbar.example/app/reset-password');
  });
});

test('a hash build gets a fragment-free link, so Supabase can use the fragment', () => {
  /*
   * The client runs on Supabase's default implicit flow, which returns the
   * session in the URL fragment. On a hash router the route lives there too,
   * and '#/reset-password#access_token=...' loses both: the browser treats
   * everything after the first '#' as one fragment, so Supabase cannot find its
   * token and the router cannot match the route. The link therefore carries no
   * route at all -- PASSWORD_RECOVERY navigates once the app is loaded.
   */
  withWindow(pagesHost, () => {
    assert.equal(usesHashRouting(), true);
    const url = authRedirectUrl('/reset-password');
    assert.equal(url, 'https://someone.github.io/');
    assert.equal(url.includes('#'), false, 'the auth link must not claim the fragment Supabase needs');
  });
});

test('the origin can be supplied, for a build with no window', () => {
  // The native build has to name a public origin rather than its own
  // capacitor:// scheme, which Supabase rejects outright.
  withWindow(undefined, () => {
    assert.equal(authRedirectUrl('/reset-password', 'https://xbar.example'), 'https://xbar.example/app/reset-password');
  });
});

test('a path without a leading slash still produces one', () => {
  withWindow(browserHost, () => {
    assert.equal(authRedirectUrl('reset-password'), 'https://xbar.example/app/reset-password');
  });
});

test('a browser-router link names the route and leaves the fragment alone', () => {
  // Here the route is a path, so Supabase's '#access_token=...' appends after
  // it without colliding.
  withWindow(browserHost, () => {
    const url = authRedirectUrl(passwordResetPath);
    assert.equal(url, 'https://xbar.example/app/reset-password');
    assert.equal(url.includes('#'), false);
  });
});

test('the recovery route is under the app base path, not the marketing site', () => {
  // "/" is prerendered marketing HTML that never loads the router, so a
  // recovery link pointed there would render a page with no form on it.
  withWindow(browserHost, () => {
    const url = authRedirectUrl(passwordResetPath);
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

test('a hash build served from a sub-path still loads that shell', () => {
  // vite.config.ts serves the GitHub Pages build from '/XBAR/', so a link to
  // the host root requests a page that is not the app shell.
  withWindow(pagesHost, () => {
    const url = authRedirectUrl(passwordResetPath, undefined, '/XBAR');
    assert.equal(url, 'https://someone.github.io/XBAR/');
    assert.equal(url.includes('#'), false, 'the auth link must not claim the fragment Supabase needs');
  });
});

test('a hash build served from the root has no stray base segment', () => {
  withWindow(pagesHost, () => {
    assert.equal(authRedirectUrl(passwordResetPath, undefined, ''), 'https://someone.github.io/');
  });
});

/*
 * The recovery link was fixed to name a route rather than an origin; the same
 * defect stayed in every OTHER native auth link -- the signup confirmation,
 * its resend, and the magic link -- because they all share one helper whose
 * native branch returned the bare origin. The deployed site serves static
 * marketing HTML at that root and mounts the auth client under `/app`, so
 * those links dropped a native customer on the marketing page with the session
 * fragment still in the address bar, unread by anything.
 */
test('a native confirmation or magic link points at the sign-in screen, not the site root', () => {
  assert.equal(publicAppRouteUrl(loginPath, 'https://xbar.example'), 'https://xbar.example/app/login');
  assert.notEqual(
    publicAppRouteUrl(loginPath, 'https://xbar.example'),
    'https://xbar.example',
    'an origin is not a place the app is',
  );
});

test('the shared native auth redirect builds an app route, and the reset flow keeps its own screen', async () => {
  const store = await readFile('src/store/useCloudStore.ts', 'utf8');

  /*
   * A unit test cannot reach `currentAuthRedirectUrl` -- it is module-private
   * to the store. What can be established here is that its native branch no
   * longer hands back the bare origin, which is the whole defect.
   */
  assert.match(
    store,
    /const url = publicAppRouteUrl\(loginPath, nativeOrigin\);/,
    'the native branch must name an app route rather than an origin',
  );
  assert.match(
    store,
    /if \(!nativeOrigin\) return undefined;/,
    'with no origin to build from it must stay undefined, so Supabase falls back to its own Site URL',
  );

  /*
   * A confirmation link has to say what it is confirming. The sign-in screen
   * reads its mode from the query string, and a session arriving without
   * `mode=signup` is treated as an ordinary sign-in -- whose destination is
   * billing. A customer who had just confirmed a brand new account, and
   * therefore had no ranch at all, was shown a pricing page instead of the
   * setup screen, and `/billing` sits outside the workspace-setup guard so
   * nothing sent them back.
   */
  assert.match(
    store,
    /return intent === 'signup' \? `\$\{url\}\?mode=signup` : url;/,
    'a native confirmation link must carry the signup mode',
  );
  assert.match(
    store,
    /const emailRedirectTo = currentAuthRedirectUrl\('signup'\);\s*const \{ data, error \} = await client\.auth\.signUp\(\{/,
    'the signup confirmation is a signup',
  );
  assert.match(
    store,
    /options: \{ emailRedirectTo: currentAuthRedirectUrl\('signup'\) \}/,
    'resending that confirmation is still a signup',
  );
  /*
   * And the magic link is NOT: it signs an existing account in, so it keeps the
   * generic destination. Passing 'signup' here would send a returning customer
   * to the setup screen for a ranch they already have.
   */
  assert.match(
    store,
    /const emailRedirectTo = currentAuthRedirectUrl\(\);\s*const \{ error \} = await client\.auth\.signInWithOtp\(\{/,
    'a magic link signs an existing account in and must not claim to be a signup',
  );
  assert.ok(
    !/if \(isNativeApp\(\)\) return nativeOrigin;/.test(store),
    'returning the bare origin lands the customer on static marketing HTML that never reads the fragment',
  );
  // And the flow that needs a different screen still overrides at its call site.
  assert.match(
    store,
    /publicAppRouteUrl\(passwordResetPath, nativePublicOrigin\)/,
    'a password reset must still land on the screen that can set a password',
  );
});
