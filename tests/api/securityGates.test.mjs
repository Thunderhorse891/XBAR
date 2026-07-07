import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

import healthHandler from '../../api/health.js';
import telemetryHandler from '../../api/telemetry.js';
import inviteHandler from '../../api/invite.js';
import checkoutHandler from '../../api/stripe/checkout.js';
import webhookHandler from '../../api/stripe/webhook.js';

// Dynamic-route dispatchers have a bracket in the filename, so import them by
// resolved file URL rather than a static specifier.
const horsesDispatcher = (await import(pathToFileURL(path.resolve('api/horses/[action].js')).href)).default;
const documentsDispatcher = (await import(pathToFileURL(path.resolve('api/documents/[action].js')).href)).default;

/*
 * Runtime assertions for the API's auth/config gates. These run without any
 * environment variables configured, which is exactly the posture the gates
 * must fail safe in: no service-role writes, no billing sessions, no invites.
 */

function invoke(handler, { method = 'POST', body, headers = {}, url = '/api/test', query } = {}) {
  const req = body === undefined ? Readable.from([]) : Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  if (query) {
    req.query = query;
  }
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

test('horses dynamic route dispatches import/export and 404s unknown actions', async () => {
  // Unknown action never reaches a sub-handler.
  const unknown = await invoke(horsesDispatcher, { query: { action: 'bogus' }, body: {} });
  assert.equal(unknown.statusCode, 404);
  assert.match(unknown.body.message, /Unknown horses action/);

  // Known actions route through to the real handlers (which then fail safe on
  // missing admin credentials / method), i.e. anything but a routing 404.
  const importRouted = await invoke(horsesDispatcher, {
    query: { action: 'import' },
    body: { workspaceId: 'w1', csv: 'name\nA' },
  });
  assert.notEqual(importRouted.statusCode, 404);

  // The dispatcher also resolves the action from the URL path (no req.query).
  const exportRouted = await invoke(horsesDispatcher, {
    method: 'GET',
    url: '/api/horses/export?workspaceId=w1&horseId=h1',
  });
  assert.notEqual(exportRouted.statusCode, 404);
});

test('documents dynamic route dispatches both actions and 404s unknown actions', async () => {
  const unknown = await invoke(documentsDispatcher, { query: { action: 'nope' }, body: {} });
  assert.equal(unknown.statusCode, 404);
  assert.match(unknown.body.message, /Unknown documents action/);

  const bulk = await invoke(documentsDispatcher, { query: { action: 'bulk-upload-with-ocr' }, body: {} });
  assert.notEqual(bulk.statusCode, 404);

  const template = await invoke(documentsDispatcher, {
    url: '/api/documents/generate-from-template',
    body: {},
  });
  assert.notEqual(template.statusCode, 404);
});
