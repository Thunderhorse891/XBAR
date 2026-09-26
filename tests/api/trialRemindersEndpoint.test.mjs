/*
 * Direct behavioral tests for api/_lib/reminders-trial.js.
 *
 * The selection logic (selectTrialReminders) and the idempotent send
 * orchestration (processTrialReminders) are covered in
 * tests/api/lifecycleEmails.test.mjs. These tests pin the HTTP handler's own
 * contract: the CRON_SECRET bearer gate, method gating, the unconfigured-
 * Supabase refusal, and the success passthrough. The trial reminders cron in
 * vercel.json is the only caller, so an auth or wiring regression here would
 * silently stop every trial email.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register(new URL('./fixtures/trialLoader.mjs', import.meta.url));

const { default: handler } = await import('../../api/_lib/reminders-trial.js');
const { __setTrialBoundary } = await import('./fixtures/trialSupabaseAdminStub.mjs');

process.env.CRON_SECRET = 'test_cron_secret_123';

function mockReq({ method = 'GET', headers = {} } = {}) {
  async function* gen() {}
  return Object.assign(gen(), { method, headers });
}

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(chunk) {
      this.body = typeof chunk === 'string' ? chunk : '';
    },
  };
}

async function callHandler({ method = 'GET', secret = 'test_cron_secret_123' } = {}) {
  const headers = secret ? { authorization: `Bearer ${secret}` } : {};
  const req = mockReq({ method, headers });
  const res = mockRes();
  await handler(req, res);
  return { res, payload: JSON.parse(res.body) };
}

test('rejects methods other than GET and POST with 405', async () => {
  const { res, payload } = await callHandler({ method: 'PUT' });
  assert.equal(res.statusCode, 405);
  assert.equal(payload.ok, false);
});

test('rejects a missing cron secret with 401', async () => {
  const { res, payload } = await callHandler({ secret: '' });
  assert.equal(res.statusCode, 401);
  assert.equal(payload.ok, false);
});

test('rejects a wrong cron secret with 401', async () => {
  const { res, payload } = await callHandler({ secret: 'wrong-secret' });
  assert.equal(res.statusCode, 401);
  assert.equal(payload.ok, false);
});

test('returns 503 when Supabase admin credentials are not configured', async () => {
  __setTrialBoundary({ admin: null });
  const { res, payload } = await callHandler();
  assert.equal(res.statusCode, 503);
  assert.equal(payload.ok, false);
});

test('runs the reminder pass and reports the scan on a valid cron call', async () => {
  __setTrialBoundary({ admin: 'fake', listRows: [] });
  const { res, payload } = await callHandler({ method: 'POST' });
  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.checked, 0);
  assert.equal(payload.emailed, 0);
});
