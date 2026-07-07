import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import healthHandler from '../../api/health.js';
import telemetryHandler from '../../api/telemetry.js';
import inviteHandler from '../../api/invite.js';
import checkoutHandler from '../../api/stripe/checkout.js';
import webhookHandler from '../../api/stripe/webhook.js';

/*
 * Runtime assertions for the API's auth/config gates. These run without any
 * environment variables configured, which is exactly the posture the gates
 * must fail safe in: no service-role writes, no billing sessions, no invites.
 */

function invoke(handler, { method = 'POST', body, headers = {} } = {}) {
  const req = body === undefined ? Readable.from([]) : Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = '/api/test';
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

test('health endpoint answers GET with liveness and subsystem booleans', async () => {
  const response = await invoke(healthHandler, { method: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, 'healthy');
  // Without env configured every subsystem reports false — booleans only.
  assert.deepEqual(
    Object.values(response.body.subsystems).every((v) => v === false),
    true,
  );
});

test('health endpoint rejects mutating methods', async () => {
  const response = await invoke(healthHandler, { method: 'POST', body: {} });
  assert.equal(response.statusCode, 405);
});

test('telemetry rejects non-POST and skips without admin credentials', async () => {
  const rejected = await invoke(telemetryHandler, { method: 'GET' });
  assert.equal(rejected.statusCode, 405);

  const skipped = await invoke(telemetryHandler, { body: { eventName: 'x' } });
  assert.equal(skipped.statusCode, 202);
  assert.match(skipped.body.message, /admin credentials are not configured/);
});

test('telemetry enforces the per-IP rate limit', async () => {
  // The limit is 60/min per IP; earlier tests consumed a few slots already,
  // so drive well past the ceiling and assert the tail is throttled.
  let last = null;
  for (let i = 0; i < 70; i += 1) {
    last = await invoke(telemetryHandler, { body: { eventName: `flood-${i}` } });
  }
  assert.equal(last.statusCode, 429);
  assert.equal(last.headers['retry-after'] !== undefined, true);
});

test('invite validates the body before any privileged work', async () => {
  const badEmail = await invoke(inviteHandler, { body: { email: 'not-an-email', workspaceId: 'w1' } });
  assert.equal(badEmail.statusCode, 400);

  const missingWorkspace = await invoke(inviteHandler, { body: { email: 'a@b.com' } });
  assert.equal(missingWorkspace.statusCode, 400);
});

test('invite fails safe when admin credentials are missing', async () => {
  const response = await invoke(inviteHandler, {
    body: { email: 'a@b.com', workspaceId: 'w1', role: 'Admin' },
    headers: { authorization: 'Bearer fake-token' },
  });
  assert.equal(response.statusCode, 503);
  assert.match(response.body.message, /not configured/);
});

test('checkout refuses to create sessions while managed billing is disabled', async () => {
  const response = await invoke(checkoutHandler, { body: { tier: 'Starter', workspaceId: 'w1' } });
  assert.equal(response.statusCode, 503);
  assert.match(response.body.message, /Managed billing is paused/);
});

test('webhook refuses unsigned traffic when Stripe is not configured', async () => {
  const rejected = await invoke(webhookHandler, { method: 'GET' });
  assert.equal(rejected.statusCode, 405);

  const unconfigured = await invoke(webhookHandler, { body: { type: 'checkout.session.completed' } });
  assert.equal(unconfigured.statusCode, 503);
  assert.match(unconfigured.body.message, /configuration is missing/);
});
