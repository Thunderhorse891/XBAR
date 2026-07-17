import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import metricsHandler from '../../api/metrics.js';

/*
 * The first-party marketing beacon endpoint must stay anonymous, validated,
 * and safe with zero configuration: no Supabase, no cookies, no identifiers.
 */

function invoke(handler, { method = 'POST', body, rawBody, headers = {} } = {}) {
  const req =
    rawBody !== undefined
      ? Readable.from([rawBody])
      : body === undefined
        ? Readable.from([])
        : Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = '/api/metrics';
  req.headers = headers;
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      end(payload) {
        let parsed = null;
        try {
          parsed = payload ? JSON.parse(payload) : null;
        } catch {
          parsed = null;
        }
        resolve({ statusCode: this.statusCode, body: parsed, headers: this.headers });
      },
    };
    void handler(req, res);
  });
}

test('metrics rejects non-POST methods', async () => {
  const response = await invoke(metricsHandler, { method: 'GET' });
  assert.equal(response.statusCode, 405);
});

test('metrics rejects malformed JSON', async () => {
  const response = await invoke(metricsHandler, { rawBody: '{not json' });
  assert.equal(response.statusCode, 400);
});

test('metrics rejects unknown event types', async () => {
  const response = await invoke(metricsHandler, { body: { type: 'evil', path: '/' } });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /Unknown metric type/);
});

test('metrics requires a site-relative path', async () => {
  const missing = await invoke(metricsHandler, { body: { type: 'pageview' } });
  assert.equal(missing.statusCode, 400);

  const absolute = await invoke(metricsHandler, {
    body: { type: 'pageview', path: 'https://evil.example/' },
  });
  assert.equal(absolute.statusCode, 400);
});

test('metrics accepts a valid pageview with 204 and no body, even unconfigured', async () => {
  const response = await invoke(metricsHandler, {
    body: { type: 'pageview', path: '/pricing', referrer: 'www.google.com' },
  });
  assert.equal(response.statusCode, 204);
  assert.equal(response.body, null);
  // Anonymous by design: the endpoint must never set cookies.
  assert.equal(response.headers['set-cookie'], undefined);
});

test('metrics accepts CTA click events', async () => {
  const response = await invoke(metricsHandler, {
    body: { type: 'signup_click', path: '/', href: '/app/login?mode=signup' },
  });
  assert.equal(response.statusCode, 204);
});
