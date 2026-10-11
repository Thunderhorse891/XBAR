import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const profile = '00000000-0000-0000-0000-000000000000';
const query = '?view=buyer&t=space%20%2F%20%2B%20%23%20%3F%20%26%20%3D%20%C3%BC';
const legacy = `#/profiles/${profile}${query}`;
const canonical = `/app/profiles/${profile}${query}`;
const siteScript = readFileSync('scripts/marketing/site.js', 'utf8');

async function appBootstrap(env = {}) {
  // Execute the real entrypoint and route helpers. Stub only React/UI, runtime
  // side effects and CSS: this test is about URL changes BEFORE React mounts.
  const result = await build({
    entryPoints: ['src/main.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    define: { 'import.meta.env': JSON.stringify(env) },
    plugins: [
      {
        name: 'bootstrap-boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path, importer }) => {
            if (importer.endsWith('/src/main.tsx') && path !== './lib/routeCanon') {
              return { path, namespace: 'bootstrap-fixture' };
            }
          });
          b.onLoad({ filter: /.*/, namespace: 'bootstrap-fixture' }, () => ({
            contents: `
            export default { createElement() {}, createRoot() { return { render() {} }; } };
            export const jsx = () => {};
            export const jsxs = () => {};
            export const CloudBootstrap = () => {};
            export const InteractionBootstrap = () => {};
            export const registerGlobalErrorHandlers = () => {};
            export const registerOfflineRuntime = () => {};
          `,
          }));
        },
      },
    ],
  });
  return result.outputFiles[0].text;
}

function run(script, path, hash, hostname = 'ranch.example', search = '') {
  const initial = `https://${hostname}${path}${search}${hash}`;
  const calls = [];
  const location = new URL(initial);
  location.replace = (target) => {
    calls.push(['replace', target]);
    location.href = new URL(target, location).href;
  };
  const window = {
    location,
    history: {
      replaceState(_state, _title, target) {
        calls.push(['replaceState', target]);
        location.href = new URL(target, location).href;
      },
    },
  };
  const document = {
    documentElement: { classList: { add() {} } },
    body: { classList: { contains: () => true } },
    querySelectorAll: () => [],
    addEventListener() {},
    getElementById: () => ({}),
  };
  // No navigator means analytics does not run; no network or real tokens.
  runInNewContext(script, { window, location, document, URL, URLSearchParams, Map, Set, console });
  return { calls, href: location.href, initial };
}

for (const [surface, script] of [
  ['marketing', siteScript],
  ['browser app', await appBootstrap({ VITE_ROUTER_MODE: 'browser' })],
]) {
  test(`${surface}: an issued root hash link reaches the public profile with the raw query intact`, () => {
    const result = run(script, '/', legacy);
    assert.equal(result.href, `https://ranch.example${canonical}`);
    assert.equal(result.calls.length, 1);
  });

  test(`${surface}: legacy local profile IDs and links without a token still reach the public route`, () => {
    assert.equal(
      run(script, '/', '#/profiles/horse_local-123').href,
      'https://ranch.example/app/profiles/horse_local-123',
    );
  });

  test(`${surface}: unrelated, malformed and authentication fragments are never treated as public profiles`, () => {
    for (const hash of [
      '',
      '#overview',
      '#/horses',
      '#/reset-password',
      '#access_token=dummy&type=recovery',
      '#/profiles/',
      '#/profiles/../settings',
      '#/profiles/id/extra?t=dummy',
      '#/profiles/id#access_token=dummy',
      '#/profiles/%2e%2e?t=dummy',
      '#/profiles/id%2fsettings',
      '#//evil.example/profiles/id',
      '#/profiles/id?x=a#b',
    ]) {
      // /app is already canonical so normal development-prefix handling does
      // not obscure whether this compatibility rule touched the fragment.
      const result = run(script, surface === 'marketing' ? '/' : '/app', hash);
      assert.equal(result.href, result.initial, hash);
    }
  });

  test(`${surface}: query-based OAuth callbacks and unrelated paths are outside compatibility scope`, () => {
    for (const [path, search] of [
      [surface === 'marketing' ? '/' : '/app', '?code=dummy'],
      ['/app/login', ''],
      ['/app/reset-password', ''],
      [surface === 'marketing' ? '/pricing' : '/app/pricing', ''],
    ]) {
      const result = run(script, path, legacy, 'ranch.example', search);
      assert.equal(result.href, result.initial);
    }
  });
}

const browserApp = await appBootstrap({ VITE_ROUTER_MODE: 'browser' });
test('browser app: both previously configured /app hash URL spellings recover without a reload loop', () => {
  for (const path of ['/app', '/app/']) {
    const migrated = run(browserApp, path, legacy);
    assert.equal(migrated.href, `https://ranch.example${canonical}`);
    assert.equal(migrated.calls.length, 1);
    const afterReload = run(browserApp, `/app/profiles/${profile}`, '', 'ranch.example', query);
    assert.equal(afterReload.calls.length, 0);
  }
});

test('native and explicit hash app builds keep their existing profile fragment', async () => {
  const hashApp = await appBootstrap({ VITE_ROUTER_MODE: 'hash', VITE_NATIVE_APP: 'true' });
  const result = run(hashApp, '/', legacy, 'localhost');
  assert.equal(result.href, result.initial);
  assert.equal(result.calls.length, 0);
});

test('GitHub Pages keeps its hash route even without an explicit router flag', async () => {
  for (const script of [siteScript, await appBootstrap({})]) {
    const result = run(script, '/', legacy, 'owner.github.io');
    assert.equal(result.href, result.initial);
    assert.equal(result.calls.length, 0);
  }
});

test('existing failed-auth callback handling remains intact on both app routers', async () => {
  const rejected = '#error=access_denied&error_description=Consent+cancelled';
  assert.equal(
    run(browserApp, '/app/login', rejected).href,
    'https://ranch.example/app/login?authError=Consent+cancelled',
  );
  const hashApp = await appBootstrap({ VITE_ROUTER_MODE: 'hash' });
  assert.equal(run(hashApp, '/', rejected).href, 'https://ranch.example/#/login?authError=Consent%20cancelled');
  const marketing = run(siteScript, '/', rejected);
  assert.equal(marketing.href, marketing.initial);
});
