import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const workspaceId = '11111111-1111-4111-8111-111111111111';
const privatePayload = {
  pathname: '/profiles/horse-a',
  search: '?token=private-buyer-capability&code=private-auth-code&email=private@example.test',
  hash: '#access_token=private-access-token',
  url: 'https://example.test/app/profiles/horse-a?token=private-buyer-capability',
  nested: { secret: 'private-nested-token' },
};

async function load(entryPoint, fixture, stubs) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    packages: 'external',
    plugins: [
      {
        name: 'telemetry-boundaries',
        setup(b) {
          for (const [name, contents] of Object.entries(stubs)) {
            b.onResolve({ filter: new RegExp(`${name}(?:\\.js)?$`) }, () => ({ path: name, namespace: 'fixture' }));
            b.onLoad({ filter: new RegExp(`^${name}$`), namespace: 'fixture' }, () => ({ contents }));
          }
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fixture', 'fetch', result.outputFiles[0].text)(
    require,
    module,
    module.exports,
    fixture,
    fixture.fetch,
  );
  return module.exports;
}

function makeFixture(mode = 'direct') {
  const stored = [];
  const posted = [];
  const fixture = {
    stored,
    posted,
    monitoringConfig: { enabled: true, apiFallbackEnabled: true },
    client: {
      auth: {
        getSession: async () => ({
          data: {
            session:
              mode === 'anonymous' ? null : { user: { id: 'verified-user' }, access_token: 'authorization-only' },
          },
        }),
      },
      from: () => ({
        insert: async (row) => {
          stored.push(row);
          if (mode === 'throw') throw new Error('database unavailable');
          return { error: mode === 'fallback' ? { message: 'database unavailable' } : null };
        },
      }),
    },
    fetch: async (url, options) => {
      posted.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true };
    },
  };
  return fixture;
}

for (const mode of ['direct', 'fallback', 'throw', 'anonymous']) {
  test(`navigation privacy at the actual ${mode} runtime transport`, async () => {
    const f = makeFixture(mode);
    const { trackRuntimeEvent } = await load('src/lib/runtimeEvents.ts', f, {
      platformConfig:
        'export const apiConfig = { baseUrl: "https://example.test" }; export const monitoringConfig = fixture.monitoringConfig; export const isSupabaseConfigured = () => true;',
      supabaseClient: 'export const getSupabaseClient = () => fixture.client;',
    });
    const event = { workspaceId, eventName: 'navigation.page_view', payload: structuredClone(privatePayload) };
    await trackRuntimeEvent(event);
    const payloads = [...f.stored.map((row) => row.payload), ...f.posted.map((req) => req.body.payload)];
    assert.ok(payloads.length > 0);
    for (const payload of payloads) {
      assert.deepEqual(payload, { pathname: '/profiles/horse-a' });
      assert.doesNotMatch(JSON.stringify(payload), /private-/);
    }
    assert.deepEqual(event.payload, privatePayload, 'do not mutate router or caller state');
    if (mode !== 'direct') assert.equal(f.posted.length, 1);
    if (mode === 'fallback' || mode === 'throw')
      assert.equal(f.posted[0].headers.Authorization, 'Bearer authorization-only');
  });
}

test('API sanitizes legacy page events before storing them without weakening membership checks', async () => {
  const f = makeFixture();
  f.memberships = [];
  const { default: handler } = await load('api/telemetry.js', f, {
    'supabase-admin':
      'export const getSupabaseAdmin = () => fixture.client; export const requireWorkspaceAccess = async (...args) => { fixture.memberships.push(args); return { ok: true, user: { id: "verified-user" } }; };',
    'rate-limit': 'export const enforceRateLimit = async () => true;',
    cors: 'export const applyCors = () => true;',
  });
  const req = Readable.from([
    JSON.stringify({ workspaceId, eventName: 'navigation.page_view', payload: privatePayload }),
  ]);
  req.method = 'POST';
  req.headers = { authorization: 'Bearer valid-session' };
  const res = {
    statusCode: 200,
    setHeader() {},
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(f.memberships, [['valid-session', workspaceId]]);
  assert.equal(f.stored[0].workspace_id, workspaceId);
  assert.deepEqual(f.stored[0].payload, { pathname: '/profiles/horse-a' });
});

test('navigation strips embedded query/fragment data and rejects non-path values; unrelated events survive', async () => {
  const f = makeFixture();
  const { trackRuntimeEvent } = await load('src/lib/runtimeEvents.ts', f, {
    platformConfig:
      'export const apiConfig = {}; export const monitoringConfig = fixture.monitoringConfig; export const isSupabaseConfigured = () => true;',
    supabaseClient: 'export const getSupabaseClient = () => fixture.client;',
  });
  for (const [pathname, expected] of [
    ['/login?code=private-code#private-fragment', '/login'],
    ['/reset-password#access_token=private-token', '/reset-password'],
    ['https://example.test/?token=private-token', undefined],
    [null, undefined],
  ]) {
    await trackRuntimeEvent({ workspaceId, eventName: 'navigation.page_view', payload: { pathname } });
    assert.deepEqual(f.stored.at(-1).payload, expected ? { pathname: expected } : {});
  }
  const payload = { durationMs: 100, operation: 'upload' };
  await trackRuntimeEvent({ workspaceId, eventName: 'document.uploaded', payload });
  assert.deepEqual(f.stored.at(-1).payload, payload);
  f.monitoringConfig.enabled = false;
  const count = f.stored.length;
  await trackRuntimeEvent({ workspaceId, eventName: 'navigation.page_view', payload: privatePayload });
  assert.equal(f.stored.length, count);
});
