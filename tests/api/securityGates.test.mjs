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

const runtimeEnvKeys = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_ID_STARTER',
  'STRIPE_PRICE_ID_PROFESSIONAL',
  'STRIPE_PRICE_ID_RANCH_OPS',
  'STRIPE_PRICE_ID_ENTERPRISE',
  'MANAGED_BILLING_ENABLED',
  'VITE_MANAGED_BILLING_ENABLED',
  'VITE_STRIPE_PAYMENT_LINK_STARTER',
  'VITE_STRIPE_PAYMENT_LINK_PROFESSIONAL',
  'VITE_STRIPE_PAYMENT_LINK_RANCH_OPS',
  'VITE_STRIPE_PAYMENT_LINK_ENTERPRISE',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'CRON_SECRET',
];

async function withRuntimeEnv(values, action) {
  const keys = new Set([...runtimeEnvKeys, ...Object.keys(values)]);
  const previous = new Map();

  for (const key of keys) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await action();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test('health endpoint answers GET with liveness and subsystem booleans', async () => {
  const response = await withRuntimeEnv({}, () => invoke(healthHandler, { method: 'GET' }));
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, 'healthy');
  // Without env configured every subsystem reports false — booleans only.
  assert.deepEqual(
    Object.values(response.body.subsystems).every((v) => v === false),
    true,
  );
});

test('health endpoint fails readiness when billing is only partly configured', async () => {
  const response = await withRuntimeEnv(
    {
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_configured',
    },
    () => invoke(healthHandler, { method: 'GET' }),
  );

  assert.equal(response.statusCode, 503);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.status, 'unhealthy');
  assert.equal(response.body.checks.billingReady, false);
  assert.equal(response.body.subsystems.stripeBilling, true);
  assert.equal(response.body.subsystems.stripeWebhook, true);
  assert.match(response.body.reasons.join(' '), /Supabase admin credentials/);
  assert.match(response.body.reasons.join(' '), /STRIPE_PRICE_ID/);
  assert.match(response.body.reasons.join(' '), /MANAGED_BILLING_ENABLED/);
  assert.match(response.body.reasons.join(' '), /VITE_MANAGED_BILLING_ENABLED/);
});

test('health endpoint reports ready when managed billing can sync entitlements', async () => {
  const response = await withRuntimeEnv(
    {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
      STRIPE_SECRET_KEY: 'sk_test_configured',
      STRIPE_WEBHOOK_SECRET: 'whsec_configured',
      STRIPE_PRICE_ID_STARTER: 'price_starter',
      STRIPE_PRICE_ID_PROFESSIONAL: 'price_professional',
      STRIPE_PRICE_ID_RANCH_OPS: 'price_ranch_ops',
      STRIPE_PRICE_ID_ENTERPRISE: 'price_enterprise',
      MANAGED_BILLING_ENABLED: 'true',
      VITE_MANAGED_BILLING_ENABLED: 'true',
    },
    () => invoke(healthHandler, { method: 'GET' }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.checks.billingReady, true);
  assert.equal(response.body.subsystems.supabaseAdmin, true);
  assert.equal(response.body.subsystems.stripePriceIds, true);
  assert.equal(response.body.subsystems.managedBilling, true);
  assert.equal('reasons' in response.body, false);
});

test('health endpoint stays healthy on hosted payment links alone', async () => {
  /*
   * Hosted links are a complete configuration: the client redirects to a
   * Stripe-hosted page and this deployment holds no secret, receives no
   * webhook and knows no price ID. Requiring the managed stack of it returned
   * 503 for a deployment whose checkout works — and README.md points uptime
   * monitors and load balancers at this endpoint, so the probe would have
   * pulled a working deployment out of service.
   */
  const response = await withRuntimeEnv(
    {
      VITE_STRIPE_PAYMENT_LINK_STARTER: 'https://buy.stripe.com/test_starter',
      VITE_STRIPE_PAYMENT_LINK_PROFESSIONAL: 'https://buy.stripe.com/test_professional',
      VITE_STRIPE_PAYMENT_LINK_RANCH_OPS: 'https://buy.stripe.com/test_ranch_ops',
      VITE_STRIPE_PAYMENT_LINK_ENTERPRISE: 'https://buy.stripe.com/test_enterprise',
    },
    () => invoke(healthHandler, { method: 'GET' }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.status, 'healthy');
  assert.equal(response.body.checks.billingReady, true);
  assert.equal(response.body.subsystems.paymentLinks, true);
  assert.equal('reasons' in response.body, false, 'a complete configuration must not be given remediation steps');

  /*
   * Healthy, but not silently: without a webhook nothing tells this deployment
   * that a link payment succeeded, so entitlements are granted by hand. Said
   * out loud rather than left for an operator to infer from a boolean.
   */
  assert.match(response.body.warnings.join(' '), /payment links only/i);
  assert.match(response.body.warnings.join(' '), /manually/i);
});

test('a half-configured managed stack is still unhealthy, with or without links', async () => {
  // The over-correction guard. Loosening the trigger must not excuse a managed
  // stack that is partly wired, which is the failure this probe exists for —
  // those pieces are useless apart and produce a checkout that dies mid-flow.
  for (const withLinks of [false, true]) {
    const response = await withRuntimeEnv(
      {
        STRIPE_SECRET_KEY: 'sk_test_configured',
        MANAGED_BILLING_ENABLED: 'true',
        ...(withLinks ? { VITE_STRIPE_PAYMENT_LINK_STARTER: 'https://buy.stripe.com/test_starter' } : {}),
      },
      () => invoke(healthHandler, { method: 'GET' }),
    );

    assert.equal(response.statusCode, 503, `partial managed billing must fail readiness (links: ${withLinks})`);
    assert.equal(response.body.checks.billingReady, false);
    assert.match(response.body.reasons.join(' '), /STRIPE_WEBHOOK_SECRET/);
    assert.equal(
      'warnings' in response.body,
      false,
      'the link-only warning must not appear once the managed stack is in play',
    );
  }
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
