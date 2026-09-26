/*
 * Direct behavioral tests for api/_lib/account-trial-start.js.
 *
 * Until now the 14-day Professional trial was covered only through the
 * policy unit (api/_lib/trial-status.js) and the entitlement/parity suites.
 * These tests drive the real HTTP handler with a scripted Supabase boundary
 * (see fixtures/trialSupabaseAdminStub.mjs) and assert the user-visible
 * contract:
 *
 * - the trial starts with no card and no Stripe: the success case runs with
 *   STRIPE_SECRET_KEY and MANAGED_BILLING_ENABLED unset, and still returns
 *   a 14-day Professional trial;
 * - only workspace admins can start it, and denial happens before any
 *   database write;
 * - the one-trial rule holds for active, expired, AND malformed records;
 * - a lost write race reports "already used" instead of restarting the
 *   window;
 * - a failed subscription read fails closed instead of writing over an
 *   unreadable row.
 *
 * The trial policy, validation, rate limiting and CORS run for real — only
 * the database/auth boundary is scripted.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

// The trial must not depend on Stripe or managed billing: prove it by
// removing both before the handler module is linked.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.MANAGED_BILLING_ENABLED;

register(new URL('./fixtures/trialLoader.mjs', import.meta.url));

const { default: handler } = await import('../../api/_lib/account-trial-start.js');
const { __setTrialBoundary, calls } = await import('./fixtures/trialSupabaseAdminStub.mjs');

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.9.8.${ipCounter}`;
}

function mockReq({ method = 'POST', headers = {}, body } = {}) {
  async function* gen() {
    if (body !== undefined) yield JSON.stringify(body);
  }
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

async function postTrialStart({ body = { workspaceId: 'ws_1' }, token = 'Bearer tok_1', role = 'Admin' } = {}) {
  __setTrialBoundary({
    access: token
      ? { ok: true, role, message: '' }
      : { ok: false, status: 401, message: 'Missing workspace access token.' },
  });
  const req = mockReq({ headers: { authorization: token, 'x-forwarded-for': nextIp() }, body });
  const res = mockRes();
  await handler(req, res);
  return { res, payload: JSON.parse(res.body) };
}

function dbWrites() {
  return calls.db.filter((call) => call.steps.some((step) => step.op === 'update' || step.op === 'insert'));
}

test('rejects non-POST methods with 405', async () => {
  const req = mockReq({ method: 'GET', headers: { 'x-forwarded-for': nextIp() } });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 405);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('rejects a missing workspace id with 400', async () => {
  const { res, payload } = await postTrialStart({ body: {} });
  assert.equal(res.statusCode, 400);
  assert.equal(payload.ok, false);
});

test('rejects an unauthenticated caller with 401 before touching the database', async () => {
  const { res, payload } = await postTrialStart({ token: '' });
  assert.equal(res.statusCode, 401);
  assert.equal(payload.ok, false);
  assert.equal(calls.db.length, 0);
});

test('rejects a non-admin with 403 before any database write', async () => {
  const { res, payload } = await postTrialStart({ role: 'Member' });
  assert.equal(res.statusCode, 403);
  assert.equal(payload.ok, false);
  assert.match(payload.message, /admin/i);
  assert.equal(dbWrites().length, 0);
});

test('refuses a second trial for a workspace that already trialed, without writing', async () => {
  __setTrialBoundary({
    access: { ok: true, role: 'Admin', message: '' },
    row: {
      tier: 'Starter',
      billing_state: 'Inactive',
      payload: {
        trial: { startedAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-01-15T00:00:00.000Z', plan: 'Professional' },
      },
    },
  });
  const req = mockReq({
    headers: { authorization: 'Bearer tok_1', 'x-forwarded-for': nextIp() },
    body: { workspaceId: 'ws_1' },
  });
  const res = mockRes();
  await handler(req, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 409);
  assert.equal(payload.code, 'trial_already_used');
  assert.equal(dbWrites().length, 0);
});

test('refuses a trial for a workspace with an active paid subscription, without writing', async () => {
  __setTrialBoundary({
    access: { ok: true, role: 'Admin', message: '' },
    row: { tier: 'Professional', billing_state: 'Active', payload: {} },
  });
  const req = mockReq({
    headers: { authorization: 'Bearer tok_1', 'x-forwarded-for': nextIp() },
    body: { workspaceId: 'ws_1' },
  });
  const res = mockRes();
  await handler(req, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 409);
  assert.equal(payload.code, 'already_entitled');
  assert.equal(dbWrites().length, 0);
});

test('fails closed with 503 when the subscription row cannot be read, without writing', async () => {
  __setTrialBoundary({
    access: { ok: true, role: 'Admin', message: '' },
    readError: { message: 'connection reset' },
  });
  const req = mockReq({
    headers: { authorization: 'Bearer tok_1', 'x-forwarded-for': nextIp() },
    body: { workspaceId: 'ws_1' },
  });
  const res = mockRes();
  await handler(req, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 503);
  assert.equal(payload.code, 'subscription_unavailable');
  assert.equal(dbWrites().length, 0);
});

test('starts a 14-day Professional trial on an untrialed workspace, guarded against write races', async () => {
  __setTrialBoundary({
    access: { ok: true, role: 'Admin', message: '' },
    row: { tier: 'Starter', billing_state: 'Inactive', payload: {} },
  });
  const req = mockReq({
    headers: { authorization: 'Bearer tok_1', 'x-forwarded-for': nextIp() },
    body: { workspaceId: 'ws_1' },
  });
  const res = mockRes();
  await handler(req, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.trial.plan, 'Professional');
  const windowMs = Date.parse(payload.trial.endsAt) - Date.parse(payload.trial.startedAt);
  assert.equal(windowMs, FOURTEEN_DAYS_MS);

  // The update carried the same no-trial condition the decision read, so a
  // concurrent start cannot silently restart the window.
  const writes = dbWrites();
  assert.equal(writes.length, 1);
  const raceGuard = writes[0].steps.find((step) => step.op === 'filter');
  assert.deepEqual(raceGuard, {
    op: 'filter',
    column: 'payload->trial->>startedAt',
    operator: 'is',
    value: null,
  });
});

test('creates a baseline subscription row when the workspace never touched billing', async () => {
  __setTrialBoundary({
    access: { ok: true, role: 'Admin', message: '' },
    row: null,
  });
  const req = mockReq({
    headers: { authorization: 'Bearer tok_1', 'x-forwarded-for': nextIp() },
    body: { workspaceId: 'ws_1' },
  });
  const res = mockRes();
  await handler(req, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);

  const writes = dbWrites();
  assert.equal(writes.length, 1);
  const inserted = writes[0].inserted;
  assert.equal(inserted.workspace_id, 'ws_1');
  assert.equal(inserted.tier, 'Starter');
  assert.equal(inserted.billing_state, 'Inactive');
  assert.equal(inserted.payload.trial.plan, 'Professional');
});

test('a malformed trial record blocks a restart without granting anything', async () => {
  __setTrialBoundary({
    access: { ok: true, role: 'Admin', message: '' },
    row: { tier: 'Starter', billing_state: 'Inactive', payload: { trial: { startedAt: 'not-a-date' } } },
  });
  const req = mockReq({
    headers: { authorization: 'Bearer tok_1', 'x-forwarded-for': nextIp() },
    body: { workspaceId: 'ws_1' },
  });
  const res = mockRes();
  await handler(req, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 409);
  assert.equal(payload.code, 'trial_already_used');
  assert.equal(dbWrites().length, 0);
});

test('a lost write race reports already-used instead of restarting the window', async () => {
  __setTrialBoundary({
    access: { ok: true, role: 'Admin', message: '' },
    row: { tier: 'Starter', billing_state: 'Inactive', payload: {} },
    // Zero rows affected: another request won the race between our read and
    // our write.
    updated: [],
  });
  const req = mockReq({
    headers: { authorization: 'Bearer tok_1', 'x-forwarded-for': nextIp() },
    body: { workspaceId: 'ws_1' },
  });
  const res = mockRes();
  await handler(req, res);
  const payload = JSON.parse(res.body);
  assert.equal(res.statusCode, 409);
  assert.equal(payload.code, 'trial_already_used');
});
