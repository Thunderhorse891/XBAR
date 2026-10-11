import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { buildFacebookShareDialogUrl, buildPublicShareUrl } from '../src/lib/facebookSharing.js';

test('buildPublicShareUrl uses the public browser route when no window is available', () => {
  assert.equal(buildPublicShareUrl('/profiles/horse-wiggy'), '/app/profiles/horse-wiggy');
});

test('buildPublicShareUrl appends share token when present', () => {
  assert.equal(buildPublicShareUrl('/profiles/horse-wiggy', 'token-123'), '/app/profiles/horse-wiggy?t=token-123');
});

test('buildFacebookShareDialogUrl returns null without app configuration', () => {
  assert.equal(buildFacebookShareDialogUrl('/profiles/horse-wiggy'), null);
});

/*
 * The share dialog's own feature string decides whether its result means
 * anything. `noopener` and `noreferrer` both make window.open return null by
 * spec even when the window opens — confirmed directly in Chromium — so while
 * either was present, openFacebookShareDialog could only ever return
 * `ok: false`: it told every customer to allow pop-ups, including the ones
 * looking at the open dialog, and popup.focus() was unreachable.
 *
 * That branch cannot be exercised from this suite (facebookConfig reads
 * import.meta.env at module load, which is empty under node, so the function
 * short-circuits before opening anything). The invariant is a property of the
 * call itself, so it is asserted against the source: reintroducing either token
 * silently breaks the result, and nothing else in the suite would notice.
 */
test('the Facebook share window is opened with a readable result', async () => {
  // Resolved from the repo root, not import.meta.url: this file is compiled
  // into .codex-test-dist before it runs, so a relative URL points at the
  // build output rather than the source. Same approach as marketingSite.test.
  const source = await readFile(path.join(process.cwd(), 'src/lib/facebookSharing.ts'), 'utf8');
  const openCall = source.match(/window\.open\((?:.|\n)*?\);/)?.[0];

  assert.ok(openCall, 'expected a window.open call in facebookSharing.ts');
  assert.doesNotMatch(openCall, /noopener/, 'noopener makes window.open return null, so the popup check cannot pass');
  assert.doesNotMatch(openCall, /noreferrer/, 'noreferrer implies noopener, with the same effect on the return value');

  // Dropping those tokens is only safe because the opener is severed by hand;
  // without this the change would trade a broken message for reverse-tabnabbing.
  assert.match(source, /popup\.opener = null/);
});

// Compile the real module with each deployment's Vite flags. Native's source
// router is a hash router, but its copied links open the public web router.
// Testing only the node fallback used to pin the broken hash-only behavior.
const shareRoutingCases = [
  {
    name: 'default production web',
    env: { BASE_URL: '/' },
    origin: 'https://ranch.example',
    expected: 'https://ranch.example/app/profiles/horse-wiggy',
  },
  {
    name: 'configured public origin',
    env: { VITE_PUBLIC_APP_URL: 'https://public.example/' },
    origin: 'https://preview.example',
    expected: 'https://public.example/app/profiles/horse-wiggy',
  },
  {
    name: 'legacy app-base configuration',
    env: { VITE_PUBLIC_APP_URL: 'https://public.example/app/' },
    origin: 'https://preview.example',
    expected: 'https://public.example/app/profiles/horse-wiggy',
  },
  {
    name: 'native build to public web',
    env: { VITE_NATIVE_APP: 'true', VITE_ROUTER_MODE: 'hash', VITE_PUBLIC_APP_URL: 'https://public.example' },
    origin: 'capacitor://localhost',
    expected: 'https://public.example/app/profiles/horse-wiggy',
  },
  {
    name: 'native legacy app-base to public web',
    env: { VITE_NATIVE_APP: 'true', VITE_ROUTER_MODE: 'hash', VITE_PUBLIC_APP_URL: 'https://public.example/app/' },
    origin: 'capacitor://localhost',
    expected: 'https://public.example/app/profiles/horse-wiggy',
  },
  {
    name: 'GitHub Pages deployment base',
    env: { BASE_URL: '/XBAR/' },
    origin: 'https://ranch.github.io',
    expected: 'https://ranch.github.io/XBAR/#/profiles/horse-wiggy',
  },
  {
    name: 'configured GitHub Pages destination',
    env: { VITE_PUBLIC_APP_URL: 'https://ranch.github.io/XBAR/' },
    origin: 'https://preview.example',
    expected: 'https://ranch.github.io/XBAR/#/profiles/horse-wiggy',
  },
  {
    name: 'GitHub source sharing production destination',
    env: { BASE_URL: '/XBAR/', VITE_PUBLIC_APP_URL: 'https://public.example' },
    origin: 'https://ranch.github.io',
    expected: 'https://public.example/app/profiles/horse-wiggy',
  },
  {
    name: 'explicit custom hash build',
    env: { BASE_URL: '/preview/', VITE_ROUTER_MODE: 'hash' },
    origin: 'https://preview.example',
    expected: 'https://preview.example/preview/#/profiles/horse-wiggy',
  },
  {
    name: 'same-origin configured custom hash build',
    env: { BASE_URL: '/preview/', VITE_ROUTER_MODE: 'hash', VITE_PUBLIC_APP_URL: 'https://preview.example' },
    origin: 'https://preview.example',
    expected: 'https://preview.example/preview/#/profiles/horse-wiggy',
  },
  {
    name: 'explicit configured hash destination',
    env: { VITE_PUBLIC_APP_URL: 'https://preview.example/preview/#/' },
    origin: 'https://ranch.example',
    expected: 'https://preview.example/preview/#/profiles/horse-wiggy',
  },
];

for (const scenario of shareRoutingCases) {
  test(`public buyer link reaches the receiving router: ${scenario.name}`, async () => {
    const result = await build({
      entryPoints: ['src/lib/facebookSharing.ts'],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      define: { 'import.meta.env': JSON.stringify({ ...scenario.env, VITE_FACEBOOK_APP_ID: 'synthetic-app-id' }) },
    });
    const sharing = await import(
      `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
    );
    const globals = globalThis as unknown as {
      window?: { location: { origin: string; hostname: string; pathname: string } };
    };
    const previous = globals.window;
    try {
      globals.window = {
        location: { origin: scenario.origin, hostname: new URL(scenario.origin).hostname, pathname: '/' },
      };
      assert.equal(sharing.buildPublicShareUrl('/profiles/horse-wiggy'), scenario.expected);
      // Preserve pre-existing query parameters and encode the token exactly once.
      const token = 'space / + # ? & = ü';
      assert.equal(
        sharing.buildPublicShareUrl('profiles/horse-wiggy?view=buyer', token),
        `${scenario.expected}?view=buyer&t=${encodeURIComponent(token)}`,
      );
      const dialog = new URL(sharing.buildFacebookShareDialogUrl('/profiles/horse-wiggy', token));
      assert.equal(dialog.searchParams.get('href'), `${scenario.expected}?t=${encodeURIComponent(token)}`);
    } finally {
      if (previous === undefined) delete globals.window;
      else globals.window = previous;
    }
  });
}
