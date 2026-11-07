import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
let scenario = 0;

async function bundle(entry, env = {}, plugins = []) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    define: { 'import.meta.env': JSON.stringify(env) },
    plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function mobileBuildEnvironment(values) {
  // Execute the real build launcher, intercepting only the expensive child build
  // and Vite's environment read. This proves what reaches Vite, not a source grep.
  globalThis.__mobileBuildInput = values;
  globalThis.__mobileBuildOutput = undefined;
  await bundle('scripts/build-mobile.mjs', {}, [
    {
      name: 'capture-mobile-build',
      setup(b) {
        b.onResolve({ filter: /^(node:child_process|vite)$/ }, ({ path }) => ({ path, namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
          contents:
            path === 'vite'
              ? 'export const loadEnv = () => globalThis.__mobileBuildInput;'
              : 'export function spawn(command, args, options) { globalThis.__mobileBuildOutput = options.env; return { on() {} }; }',
        }));
        // Unique module per scenario; Node otherwise caches the data URL.
        b.onEnd((r) => {
          r.outputFiles[0].contents = Buffer.from(r.outputFiles[0].text + `\n// scenario ${++scenario}`);
        });
      },
    },
  ]);
  return globalThis.__mobileBuildOutput;
}

test('mobile build sends API calls to the configured HTTPS backend origin', async () => {
  const original = { ...process.env };
  try {
    for (const key of ['VITE_PUBLIC_APP_URL', 'VITE_PUBLIC_SITE_URL', 'VITE_API_BASE_URL', 'CAP_SERVER_URL'])
      delete process.env[key];
    const standard = await mobileBuildEnvironment({});
    assert.equal(standard.VITE_API_BASE_URL, 'https://xbar-horse-management-app.vercel.app');
    const custom = await mobileBuildEnvironment({ VITE_PUBLIC_APP_URL: 'https://ranch.example/app' });
    assert.equal(custom.VITE_API_BASE_URL, 'https://ranch.example');
    const split = await mobileBuildEnvironment({
      VITE_PUBLIC_SITE_URL: 'https://marketing.example',
      VITE_API_BASE_URL: 'https://api.example/',
    });
    assert.equal(split.VITE_API_BASE_URL, 'https://api.example');
  } finally {
    process.env = original;
    delete globalThis.__mobileBuildInput;
    delete globalThis.__mobileBuildOutput;
  }
});

test('native account actions reach the backend and preserve failed-deletion identity', async () => {
  const { useCloudStore } = await bundle('src/store/useCloudStore.ts', { VITE_API_BASE_URL: 'https://api.example' }, [
    {
      name: 'synthetic-auth-client',
      setup(b) {
        b.onResolve({ filter: /supabaseClient$/ }, () => ({ path: 'client', namespace: 'fixture' }));
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents:
            'export const getSupabaseClient = () => ({auth:{signOut:async()=>({})}}); export const authStorageKey = () => "test-auth";',
        }));
      },
    },
  ]);
  const originalFetch = globalThis.fetch;
  try {
    const requests = [];
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ ok: false, message: 'Synthetic refusal' }), { status: 403 });
    };
    useCloudStore.setState({
      session: { access_token: 'synthetic-token', user: { id: 'test-user' } },
      status: 'signed-in',
    });
    assert.equal(await useCloudStore.getState().requestWelcomeEmail(), false);
    assert.equal((await useCloudStore.getState().deleteAccount('test@example.invalid')).ok, false);
    assert.deepEqual(
      requests.map((r) => r.url),
      ['https://api.example/api/account/send-welcome', 'https://api.example/api/account/delete'],
    );
    for (const { options } of requests) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    }
    assert.equal(useCloudStore.getState().session.user.id, 'test-user');
    assert.equal(useCloudStore.getState().status, 'signed-in');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mobile release refuses insecure, path-bearing and live-reload backends', async () => {
  const original = { ...process.env };
  try {
    for (const key of ['VITE_PUBLIC_APP_URL', 'VITE_PUBLIC_SITE_URL', 'VITE_API_BASE_URL', 'CAP_SERVER_URL'])
      delete process.env[key];
    for (const value of [
      'http://api.example',
      'capacitor://localhost',
      'https://api.example/api',
      'https://user:secret@api.example',
      'https://api.example?token=x',
    ]) {
      await assert.rejects(mobileBuildEnvironment({ VITE_API_BASE_URL: value }), /HTTPS origin/);
    }
    process.env.CAP_SERVER_URL = 'http://192.0.2.1:5173';
    await assert.rejects(mobileBuildEnvironment({}), /CAP_SERVER_URL/);
  } finally {
    process.env = original;
  }
});

test('packet verification uses the configured backend from a native app', async () => {
  const { verifyPacket } = await bundle('src/lib/buyerVerify.ts', { VITE_API_BASE_URL: 'https://api.example' });
  const originalFetch = globalThis.fetch;
  try {
    let request;
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ found: false }), { status: 404 });
    };
    assert.equal((await verifyPacket('packet / 1')).state, 'not-found');
    assert.equal(request.url, 'https://api.example/api/buyer/verify?packetId=packet%20%2F%201');
    assert.equal(request.options.method, 'GET');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the existing backend URL builder keeps web same-origin behavior', async () => {
  const previousWindow = globalThis.window;
  try {
    delete globalThis.window;
    const { buildApiUrl } = await bundle('src/lib/backendApi.ts');
    assert.equal(buildApiUrl('/api/account/delete'), '/api/account/delete');
    globalThis.window = { location: { origin: 'https://ranch.example' } };
    assert.equal(buildApiUrl('api/account/delete'), 'https://ranch.example/api/account/delete');
    const configured = await bundle('src/lib/backendApi.ts', { VITE_API_BASE_URL: 'https://api.example/' });
    assert.equal(configured.buildApiUrl('/api/account/delete'), 'https://api.example/api/account/delete');
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('native API routing does not implicitly enable telemetry API fallback', async () => {
  const original = { ...process.env };
  try {
    for (const key of [
      'VITE_PUBLIC_APP_URL',
      'VITE_PUBLIC_SITE_URL',
      'VITE_API_BASE_URL',
      'CAP_SERVER_URL',
      'VITE_RUNTIME_TELEMETRY_API_ENABLED',
    ])
      delete process.env[key];
    for (const values of [
      {},
      { VITE_RUNTIME_TELEMETRY_API_ENABLED: 'false' },
      { VITE_RUNTIME_TELEMETRY_API_ENABLED: 'true' },
      { VITE_RUNTIME_TELEMETRY_API_ENABLED: 'invalid' },
      { VITE_API_BASE_URL: 'https://api.example' },
      { VITE_API_BASE_URL: 'https://api.example', VITE_RUNTIME_TELEMETRY_API_ENABLED: 'false' },
    ]) {
      const before = await bundle('src/lib/platformConfig.ts', values);
      const env = await mobileBuildEnvironment(values);
      const after = await bundle('src/lib/platformConfig.ts', {
        ...values,
        VITE_API_BASE_URL: env.VITE_API_BASE_URL,
        VITE_RUNTIME_TELEMETRY_API_ENABLED: env.VITE_RUNTIME_TELEMETRY_API_ENABLED,
      });
      assert.equal(
        after.monitoringConfig.apiFallbackEnabled,
        before.monitoringConfig.apiFallbackEnabled,
        JSON.stringify(values),
      );
    }
  } finally {
    process.env = original;
    delete globalThis.__mobileBuildInput;
    delete globalThis.__mobileBuildOutput;
  }
});
