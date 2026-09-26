import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceRateLimit } from '../../api/_lib/rate-limit.js';

test('production fails closed for missing, broken and malformed shared limiter, including explicit memory mode', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  const invoke = async () => {
    const res = {
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    const allowed = await enforceRateLimit({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }, res, {
      bucket: 'closed',
      limit: 2,
      windowSeconds: 60,
    });
    return { allowed, ...res };
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL = '1';
    process.env.RATE_LIMIT_MODE = 'memory';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    let result = await invoke();
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 503);
    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.invalid';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
    for (const fake of [
      async () => {
        throw Error('offline');
      },
      async () => ({ ok: false }),
      async () => ({ ok: true, json: async () => ({ result: 0 }) }),
      async () => ({ ok: true, json: async () => ({ error: 'failed' }) }),
    ]) {
      globalThis.fetch = fake;
      result = await invoke();
      assert.equal(result.allowed, false);
      assert.equal(result.statusCode, 503);
    }
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(options.body)[0], 'EVAL');
      return { ok: true, json: async () => ({ result: 1 }) };
    };
    assert.equal((await invoke()).allowed, true);
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: 3 }) });
    result = await invoke();
    assert.equal(result.allowed, false);
    assert.equal(result.statusCode, 429);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
