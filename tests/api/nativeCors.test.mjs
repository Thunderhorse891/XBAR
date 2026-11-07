import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';
import { applyCors } from '../../api/_lib/cors.js';

const IOS_ORIGIN = 'capacitor://localhost';
const envKeys = ['PUBLIC_APP_URL', 'VITE_PUBLIC_APP_URL', 'VERCEL_URL'];
const require = createRequire(import.meta.url);

function response() {
  return {
    statusCode: 200,
    headers: {},
    ended: false,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.ended = true;
      this.body = body ? JSON.parse(body) : null;
    },
  };
}

function withOrigins(values, run) {
  const previous = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    return run();
  } finally {
    for (const key of envKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('the exact bundled iOS origin permits bearer/content-type preflight without cookies', () => {
  withOrigins({}, () => {
    const res = response();
    assert.equal(applyCors({ method: 'OPTIONS', headers: { origin: IOS_ORIGIN } }, res), false);
    assert.equal(res.statusCode, 204);
    assert.equal(res.ended, true);
    assert.deepEqual(res.headers, {
      vary: 'Origin',
      'access-control-allow-origin': IOS_ORIGIN,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-max-age': '86400',
    });
  });
});

test('configured web origins remain exact and retain endpoint-specific methods', () => {
  withOrigins(
    {
      PUBLIC_APP_URL: 'https://ranch.example/app',
      VITE_PUBLIC_APP_URL: 'http://localhost:5173',
      VERCEL_URL: 'preview.example',
    },
    () => {
      for (const origin of [IOS_ORIGIN, 'https://ranch.example', 'http://localhost:5173', 'https://preview.example']) {
        const res = response();
        assert.equal(applyCors({ method: 'GET', headers: { origin } }, res, { methods: 'GET, POST, OPTIONS' }), true);
        assert.equal(res.ended, false);
        assert.equal(res.headers['access-control-allow-origin'], origin);
        assert.equal(res.headers['access-control-allow-methods'], 'GET, POST, OPTIONS');
        assert.equal(res.headers['access-control-allow-credentials'], undefined);
      }
    },
  );
});

test('unknown, opaque and lookalike origins are never reflected', () => {
  for (const config of [
    {},
    { PUBLIC_APP_URL: 'https://ranch.example' },
    { PUBLIC_APP_URL: IOS_ORIGIN, VITE_PUBLIC_APP_URL: 'file:///tmp/app' },
    { PUBLIC_APP_URL: 'data:text/plain,example', VITE_PUBLIC_APP_URL: 'invalid' },
  ]) {
    withOrigins(config, () => {
      for (const origin of [
        undefined,
        'null',
        '*',
        'https://untrusted.example',
        'https://ranch.example.attacker.test',
        'capacitor://localhost.attacker.test',
        'capacitor://localhost:443',
        'capacitor://localhost/',
        'capacitor://other',
        'ionic://localhost',
        'http://localhost',
        'https://localhost',
        'https://ranch.example:444',
        ['capacitor://localhost'],
      ]) {
        const res = response();
        assert.equal(applyCors({ method: 'OPTIONS', headers: { origin } }, res), false);
        assert.equal(res.statusCode, 204);
        assert.deepEqual(res.headers, { vary: 'Origin' }, JSON.stringify({ config, origin }));
      }
    });
  }
});

// Execute real endpoint control flow. Only external services are replaced;
// the CORS helper, method checks and authentication logic remain untouched.
async function endpoint(entry, state) {
  globalThis.__nativeCorsFixture = state;
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    define: { 'process.env.STRIPE_SECRET_KEY': '""' },
    plugins: [
      {
        name: 'synthetic-native-services',
        setup(builder) {
          builder.onResolve({ filter: /(?:supabase-admin|rate-limit|lifecycleTriggers)\.js$/ }, ({ path }) => ({
            path,
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: path.endsWith('supabase-admin.js')
              ? 'export function getSupabaseAdmin() { const s=globalThis.__nativeCorsFixture; s.adminReads++; return s.admin; }'
              : path.endsWith('rate-limit.js')
                ? 'export async function enforceRateLimit(req,res) { const s=globalThis.__nativeCorsFixture; s.rateCalls++; if(s.limited){res.statusCode=429;res.end(JSON.stringify({ok:false}));return false;} return true; }'
                : 'export async function sendWelcomeForUser({user}) { const s=globalThis.__nativeCorsFixture; s.sent.push(user.id); return {ok:true}; }',
          }));
        },
      },
    ],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  return mod.exports.default;
}

function fixture() {
  const state = { adminReads: 0, rateCalls: 0, sent: [], tokens: [], limited: false, admin: null };
  state.admin = {
    auth: {
      async getUser(token) {
        state.tokens.push(token);
        return token === 'synthetic-valid'
          ? { data: { user: { id: 'synthetic-user' } }, error: null }
          : { data: {}, error: new Error('Invalid token') };
      },
    },
  };
  return state;
}

test('native preflights finish before auth, rate limiting, email, packet or deletion work', async () => {
  for (const [entry, methods] of [
    ['api/_lib/account-send-welcome.js', 'POST, OPTIONS'],
    ['api/_lib/account-delete.js', 'POST, OPTIONS'],
    ['api/_lib/buyer-verify.js', 'GET, POST, OPTIONS'],
  ]) {
    const state = fixture();
    const handler = await endpoint(entry, state);
    const res = response();
    await handler({ method: 'OPTIONS', headers: { origin: IOS_ORIGIN } }, res);
    assert.equal(res.statusCode, 204, entry);
    assert.equal(res.headers['access-control-allow-origin'], IOS_ORIGIN, entry);
    assert.equal(res.headers['access-control-allow-methods'], methods, entry);
    assert.equal(state.adminReads, 0);
    assert.equal(state.rateCalls, 0);
    assert.deepEqual(state.sent, []);
    assert.deepEqual(state.tokens, []);
  }
});

test('native origin never substitutes for welcome or deletion authentication', async () => {
  for (const entry of ['api/_lib/account-send-welcome.js', 'api/_lib/account-delete.js']) {
    for (const authorization of [undefined, 'Bearer synthetic-invalid']) {
      const state = fixture();
      const handler = await endpoint(entry, state);
      const res = response();
      await handler({ method: 'POST', headers: { origin: IOS_ORIGIN, authorization } }, res);
      assert.equal(res.statusCode, 401);
      assert.equal(res.headers['access-control-allow-origin'], IOS_ORIGIN);
      assert.deepEqual(state.sent, []);
      assert.deepEqual(state.tokens, authorization ? ['synthetic-invalid'] : []);
    }
  }
});

test('welcome preserves method, configuration and rate-limit refusals and authenticated dispatch', async () => {
  for (const scenario of ['method', 'unconfigured', 'limited', 'signed-in']) {
    const state = fixture();
    if (scenario === 'unconfigured') state.admin = null;
    if (scenario === 'limited') state.limited = true;
    const handler = await endpoint('api/_lib/account-send-welcome.js', state);
    const res = response();
    await handler(
      {
        method: scenario === 'method' ? 'GET' : 'POST',
        headers: { origin: IOS_ORIGIN, authorization: 'Bearer synthetic-valid' },
      },
      res,
    );
    assert.equal(res.statusCode, { method: 405, unconfigured: 503, limited: 429, 'signed-in': 200 }[scenario]);
    assert.equal(res.headers['access-control-allow-origin'], IOS_ORIGIN);
    assert.deepEqual(state.sent, scenario === 'signed-in' ? ['synthetic-user'] : []);
    if (scenario === 'method' || scenario === 'limited') assert.equal(state.adminReads, 0);
  }
});
