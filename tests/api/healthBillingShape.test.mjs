import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';

import healthHandler from '../../api/health.js';

/*
 * Audit F13: the health endpoint checked that billing values were PRESENT. A
 * product id in a price variable, a publishable key in the secret slot, and an
 * absent annual price all reported healthy, and each one failed only at the
 * moment a customer tried to pay. These pin what the endpoint now refuses and
 * what it says out loud, without calling Stripe.
 */

const HEALTH_ENV = [
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_LEGACY_PRICE_IDS',
  'MANAGED_BILLING_ENABLED',
  'VITE_MANAGED_BILLING_ENABLED',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'EMAIL_FROM_ADDRESS',
  'CRON_SECRET',
  'VERCEL_ENV',
  ...['STARTER', 'PROFESSIONAL', 'RANCH_OPS', 'ENTERPRISE'].flatMap((tier) => [
    `STRIPE_PRICE_ID_${tier}`,
    `STRIPE_PRICE_ID_${tier}_ANNUAL`,
    `VITE_STRIPE_PAYMENT_LINK_${tier}`,
  ]),
];

const READY = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service_role_key',
  STRIPE_SECRET_KEY: 'sk_live_51AbCdEf',
  STRIPE_WEBHOOK_SECRET: 'whsec_AbCdEf123',
  MANAGED_BILLING_ENABLED: 'true',
  VITE_MANAGED_BILLING_ENABLED: 'true',
  STRIPE_PRICE_ID_STARTER: 'price_1Starter',
  STRIPE_PRICE_ID_PROFESSIONAL: 'price_1Pro',
  STRIPE_PRICE_ID_RANCH_OPS: 'price_1Ranch',
  STRIPE_PRICE_ID_ENTERPRISE: 'price_1Ent',
  STRIPE_PRICE_ID_STARTER_ANNUAL: 'price_1StarterY',
  STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL: 'price_1ProY',
  STRIPE_PRICE_ID_RANCH_OPS_ANNUAL: 'price_1RanchY',
  STRIPE_PRICE_ID_ENTERPRISE_ANNUAL: 'price_1EntY',
  RESEND_API_KEY: 're_key',
  EMAIL_FROM_ADDRESS: 'XBAR <records@example.com>',
};

async function health(values) {
  const previous = new Map(HEALTH_ENV.map((key) => [key, process.env[key]]));
  for (const key of HEALTH_ENV) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    const req = Readable.from([]);
    req.method = 'GET';
    req.url = '/api/health';
    req.headers = {};
    return await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        setHeader() {},
        end(payload) {
          resolve({ statusCode: this.statusCode, body: JSON.parse(payload) });
        },
      };
      void healthHandler(req, res);
    });
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const reasons = (response) => (response.body.reasons ?? []).join(' ');
const warnings = (response) => (response.body.warnings ?? []).join(' ');

test('a fully and correctly configured deployment is healthy and says it is live', async () => {
  const response = await health(READY);
  assert.equal(response.statusCode, 200, reasons(response));
  assert.equal(response.body.subsystems.stripeLiveKey, true);
  assert.equal(response.body.subsystems.stripeAnnualPriceIds, true);
  assert.equal(warnings(response), '');
});

test('a value of the wrong kind fails readiness and names the variable', async () => {
  const cases = [
    [{ STRIPE_PRICE_ID_PROFESSIONAL: 'prod_1Pro' }, /STRIPE_PRICE_ID_PROFESSIONAL is set but is not a Stripe price id/],
    [{ STRIPE_PRICE_ID_RANCH_OPS_ANNUAL: 'https://buy.stripe.com/abc' }, /STRIPE_PRICE_ID_RANCH_OPS_ANNUAL/],
    [{ STRIPE_SECRET_KEY: 'pk_live_51AbCdEf' }, /STRIPE_SECRET_KEY is set but is not a Stripe secret key/],
    [{ STRIPE_SECRET_KEY: 'sk_live_51Ab Cd' }, /STRIPE_SECRET_KEY is set but is not a Stripe secret key/],
    [{ STRIPE_WEBHOOK_SECRET: 'sk_live_51AbCdEf' }, /STRIPE_WEBHOOK_SECRET is set but is not a webhook signing secret/],
  ];
  for (const [override, reason] of cases) {
    const response = await health({ ...READY, ...override });
    assert.equal(response.statusCode, 503, JSON.stringify(override));
    assert.equal(response.body.checks.billingReady, false);
    assert.match(reasons(response), reason);
  }
});

test('one price id under two plans fails readiness: a buyer would get the other plan', async () => {
  const response = await health({ ...READY, STRIPE_PRICE_ID_RANCH_OPS: 'price_1Pro' });
  assert.equal(response.statusCode, 503);
  assert.match(reasons(response), /STRIPE_PRICE_ID_PROFESSIONAL and STRIPE_PRICE_ID_RANCH_OPS hold the same price id/);
});

test('approved legacy prices are accepted; unreadable ones fail readiness', async () => {
  const good = await health({ ...READY, STRIPE_LEGACY_PRICE_IDS: 'price_0Pro2025=Professional:monthly' });
  assert.equal(good.statusCode, 200, reasons(good));

  for (const [value, reason] of [
    ['price_0Pro2025=Gold:monthly', /unknown tier "Gold"/],
    ['price_0Pro2025=Professional', /is not price_id=Tier:monthly\|annual/],
    ['price_1Pro=Professional:monthly', /also a current price/],
  ]) {
    const response = await health({ ...READY, STRIPE_LEGACY_PRICE_IDS: value });
    assert.equal(response.statusCode, 503, value);
    assert.match(reasons(response), reason);
  }
});

test('what still works but deserves saying is a warning, not an outage', async () => {
  const noAnnual = await health({ ...READY, STRIPE_PRICE_ID_ENTERPRISE_ANNUAL: undefined });
  assert.equal(noAnnual.statusCode, 200);
  assert.equal(noAnnual.body.subsystems.stripeAnnualPriceIds, false);
  assert.match(warnings(noAnnual), /Checkout refuses annual on those plans/);

  const testKey = await health({ ...READY, STRIPE_SECRET_KEY: 'sk_test_51AbCdEf', VERCEL_ENV: 'production' });
  assert.equal(testKey.statusCode, 200);
  assert.equal(testKey.body.subsystems.stripeLiveKey, false);
  assert.match(warnings(testKey), /Production is using a Stripe TEST key/);

  const noEmail = await health({ ...READY, RESEND_API_KEY: undefined });
  assert.match(warnings(noEmail), /No email provider is configured/);

  const defaultSender = await health({ ...READY, EMAIL_FROM_ADDRESS: undefined });
  assert.match(warnings(defaultSender), /EMAIL_FROM_ADDRESS is not set/);
});
