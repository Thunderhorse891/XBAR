/*
 * Direct behavioral tests for api/stripe/checkout.js.
 *
 * Until now the endpoint was covered only indirectly (through
 * api/_lib/checkout-session.js unit tests and the unconfigured-refusal case).
 * These tests drive the real handler with scripted Stripe and Supabase
 * boundaries (see fixtures/billingLoader.mjs) and assert the user-visible
 * contract:
 *
 * - session creation params per tier and billing period, including the full
 *   metadata the webhook later matches on;
 * - seat-count clamping;
 * - refusal when managed billing is paused or Stripe is not configured;
 * - the admin-only restriction (denial before any privileged write);
 * - the duplicate-subscription and lock-contention refusals.
 *
 * Different module-scope env postures are loaded as distinct module
 * instances via query-string dynamic imports, because MANAGED_BILLING_ENABLED
 * and STRIPE_SECRET_KEY are read once at import time.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { register } from 'node:module';

// Full posture: module-scope reads happen on the dynamic imports below.
process.env.STRIPE_SECRET_KEY = 'sk_test_checkout_endpoint';
process.env.MANAGED_BILLING_ENABLED = 'true';
process.env.STRIPE_PRICE_ID_STARTER = 'price_starter_m';
process.env.STRIPE_PRICE_ID_PROFESSIONAL = 'price_pro_m';
process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL = 'price_pro_a';
process.env.STRIPE_PRICE_ID_RANCH_OPS = 'price_ranch_m';
process.env.STRIPE_PRICE_ID_RANCH_OPS_ANNUAL = 'price_ranch_a';
process.env.STRIPE_PRICE_ID_ENTERPRISE = 'price_ent_m';
process.env.SUPABASE_URL = 'https://billing-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test_service_role_key';

register(new URL('./fixtures/billingLoader.mjs', import.meta.url));

const { __setBillingStripe } = await import('./fixtures/billingStripeStub.mjs');
const { __setBillingSupabase, makeClient } = await import('./fixtures/billingSupabaseStub.mjs');

const PRICES = {
  Starter: { monthly: process.env.STRIPE_PRICE_ID_STARTER },
  Professional: {
    monthly: process.env.STRIPE_PRICE_ID_PROFESSIONAL,
    annual: process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL,
  },
  'Ranch Ops': { monthly: process.env.STRIPE_PRICE_ID_RANCH_OPS, annual: process.env.STRIPE_PRICE_ID_RANCH_OPS_ANNUAL },
  Enterprise: { monthly: process.env.STRIPE_PRICE_ID_ENTERPRISE },
};

/* Scripted Stripe boundary; reset per test. */
const stripeScenario = {
  calls: [],
  createdCustomers: [],
  createdSessions: [],
  subscriptions: [],
  openSessions: [],
  priceOverrides: {},
  priceError: null,
  accountId: 'acct_expected',
  accountError: null,
  reset() {
    this.calls = [];
    this.createdCustomers = [];
    this.createdSessions = [];
    this.subscriptions = [];
    this.openSessions = [];
    this.priceOverrides = {};
    this.priceError = null;
    this.accountId = 'acct_expected';
    this.accountError = null;
  },
};

const stripePriceAmounts = {
  price_starter_m: 1200,
  price_pro_m: 2900,
  price_pro_a: 29000,
  price_ranch_m: 7900,
  price_ranch_a: 79000,
  price_ent_m: 19900,
};

__setBillingStripe({
  accounts: {
    retrieve: async () => {
      stripeScenario.calls.push(['accounts.retrieve']);
      if (stripeScenario.accountError) throw stripeScenario.accountError;
      return { id: stripeScenario.accountId };
    },
  },
  prices: {
    retrieve: async (id) => {
      stripeScenario.calls.push(['prices.retrieve', id]);
      if (stripeScenario.priceError) throw stripeScenario.priceError;
      return {
        id,
        active: true,
        livemode: false,
        type: 'recurring',
        currency: 'usd',
        billing_scheme: 'per_unit',
        unit_amount: stripePriceAmounts[id],
        transform_quantity: null,
        recurring: { interval: id.endsWith('_a') ? 'year' : 'month', interval_count: 1, usage_type: 'licensed' },
        product: { id: 'prod_xbar', active: true },
        ...stripeScenario.priceOverrides,
      };
    },
  },
  customers: {
    create: async (params) => {
      stripeScenario.calls.push(['customers.create', params]);
      const customer = { id: `cus_new_${stripeScenario.createdCustomers.length + 1}` };
      stripeScenario.createdCustomers.push({ customer, params });
      return customer;
    },
  },
  subscriptions: {
    list: async (params) => {
      stripeScenario.calls.push(['subscriptions.list', params]);
      return { data: stripeScenario.subscriptions, has_more: false };
    },
  },
  checkout: {
    sessions: {
      create: async (params) => {
        stripeScenario.calls.push(['sessions.create', params]);
        stripeScenario.createdSessions.push(params);
        return { id: `cs_new_${stripeScenario.createdSessions.length}`, url: 'https://checkout.stripe.com/pay/cs_new' };
      },
      expire: async (id) => {
        stripeScenario.calls.push(['sessions.expire', id]);
        return { id, status: 'expired' };
      },
      retrieve: async (id) => {
        stripeScenario.calls.push(['sessions.retrieve', id]);
        return stripeScenario.openSessions.find((s) => s.id === id) || null;
      },
      list: async (params) => {
        stripeScenario.calls.push(['sessions.list', params]);
        return { data: stripeScenario.openSessions, has_more: false };
      },
    },
  },
});

const { default: fullHandler } = await import('../../api/stripe/checkout.js');

async function importWithEnv(overrides, tag) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return (await import(`../../api/stripe/checkout.js?posture=${tag}`)).default;
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

let ipCounter = 0;

function invoke(handler, { body = {}, token = 'token-admin', ip = `10.9.0.${++ipCounter}`, method = 'POST' } = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = method;
  req.url = '/api/stripe/checkout';
  req.headers = {
    'content-type': 'application/json',
    'x-forwarded-for': ip,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[String(name).toLowerCase()] = value;
      },
      end(payload) {
        let parsed;
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

/*
 * Scripted Supabase boundary for the checkout flow.
 *
 * role: 'Admin' when the token's user owns the workspace, otherwise the
 * membership role (or null for no access). billingRow is the
 * workspace_billing_customers row (null for a first purchase). lockClaimed
 * controls the xbar_claim_checkout_lock RPC; renewRows controls the
 * pre-create lock renewal.
 */
function supabaseFor({ role = 'Admin', billingRow = null, lockClaimed = true, renewRows = null } = {}) {
  const calls = { upserts: [], updates: [], rpcs: [] };
  const userId = role === 'Admin' ? 'user_admin' : 'user_member';
  const client = makeClient({
    tables: {
      workspaces: async (mode) => {
        if (mode === 'maybeSingle') return { data: { id: 'ws_1', owner_user_id: 'user_admin' }, error: null };
        return { data: [], error: null };
      },
      workspace_memberships: async (mode) => {
        if (mode === 'maybeSingle')
          return { data: role && role !== 'Admin' ? { role, status: 'active' } : null, error: null };
        return { data: [], error: null };
      },
      workspace_billing_customers: async (mode, ops) => {
        const kinds = ops.map(([name]) => name);
        if (kinds.includes('upsert')) {
          calls.upserts.push(ops.find(([name]) => name === 'upsert')[1]);
          return { data: [{}], error: null };
        }
        if (kinds.includes('update')) {
          calls.updates.push(ops);
          // renewCheckoutLock needs a matched row; the release does not care.
          return { data: renewRows === null ? [{ workspace_id: 'ws_1' }] : renewRows, error: null };
        }
        if (mode === 'maybeSingle') return { data: billingRow, error: null };
        return { data: [], error: null };
      },
    },
    rpcImpl: async (name, params) => {
      calls.rpcs.push([name, params]);
      if (name === 'xbar_claim_checkout_lock') return { data: lockClaimed, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    authImpl: {
      getUser: async (token) => {
        if (token === 'token-admin' || token === 'token-member') {
          return { data: { user: { id: userId, email: `${userId}@example.com` } }, error: null };
        }
        return { data: { user: null }, error: { message: 'invalid token' } };
      },
    },
  });
  __setBillingSupabase(client);
  return calls;
}

const FALLBACK_ORIGIN = 'https://xbar-horse-management-app.vercel.app';

test('checkout return URLs preserve the billing page and replace old outcomes before the fragment', async () => {
  const savedOrigin = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = FALLBACK_ORIGIN;
  try {
    for (const suffix of [
      '/app/billing#professional',
      '/app/billing?plan=Professional#professional',
      '/app/billing?checkout=cancelled&plan=Professional&checkout=success#professional',
    ]) {
      stripeScenario.reset();
      supabaseFor();
      const response = await invoke(fullHandler, {
        body: { tier: 'Professional', workspaceId: 'ws_1', returnUrl: `${FALLBACK_ORIGIN}${suffix}` },
      });
      assert.equal(response.statusCode, 200);
      for (const [key, outcome] of [
        ['success_url', 'success'],
        ['cancel_url', 'cancelled'],
      ]) {
        const actual = new URL(stripeScenario.createdSessions[0][key]);
        assert.equal(actual.pathname, '/app/billing');
        assert.equal(actual.hash, '#professional');
        assert.deepEqual(actual.searchParams.getAll('checkout'), [outcome]);
        assert.equal(actual.searchParams.get('plan'), new URL(`${FALLBACK_ORIGIN}${suffix}`).searchParams.get('plan'));
      }
    }
  } finally {
    if (savedOrigin === undefined) delete process.env.PUBLIC_APP_URL;
    else process.env.PUBLIC_APP_URL = savedOrigin;
  }
});

test('missing or untrusted return URLs land on the trusted billing screen', async () => {
  for (const returnUrl of [undefined, 'https://untrusted.example/app/billing']) {
    stripeScenario.reset();
    supabaseFor();
    const response = await invoke(fullHandler, { body: { tier: 'Professional', workspaceId: 'ws_1', returnUrl } });
    assert.equal(response.statusCode, 200);
    const actual = new URL(stripeScenario.createdSessions[0].success_url);
    assert.equal(actual.origin, FALLBACK_ORIGIN);
    assert.equal(actual.pathname, '/app/billing');
    assert.equal(actual.searchParams.get('checkout'), 'success');
  }
});

function expectedSessionParams({ tier, priceId, seatCount, billingPeriod, customerId, userId = 'user_admin' }) {
  return {
    mode: 'subscription',
    // Pinned: a delayed method would complete Checkout before it settles.
    payment_method_types: ['card'],
    customer: customerId,
    line_items: [{ price: priceId, quantity: seatCount }],
    success_url: `${FALLBACK_ORIGIN}/app/billing?checkout=success`,
    cancel_url: `${FALLBACK_ORIGIN}/app/billing?checkout=cancelled`,
    metadata: {
      workspace_id: 'ws_1',
      workspace_tier: tier,
      workspace_seats: String(seatCount),
      workspace_billing_period: billingPeriod,
      workspace_price_id: priceId,
      owner_user_id: userId,
    },
    subscription_data: {
      metadata: { workspace_id: 'ws_1', workspace_tier: tier },
    },
  };
}

test('a Professional annual checkout creates a session with the annual price and full metadata', async () => {
  stripeScenario.reset();
  const calls = supabaseFor();

  const response = await invoke(fullHandler, {
    body: { tier: 'Professional', workspaceId: 'ws_1', billingPeriod: 'annual', seatCount: 3 },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.url, 'https://checkout.stripe.com/pay/cs_new');

  assert.equal(stripeScenario.createdSessions.length, 1);
  assert.deepEqual(
    stripeScenario.createdSessions[0],
    expectedSessionParams({
      tier: 'Professional',
      priceId: PRICES.Professional.annual,
      seatCount: 3,
      billingPeriod: 'annual',
      customerId: 'cus_new_1',
    }),
  );

  // The billing row is written for the new purchase, pointing at the price
  // the customer is about to pay — with an EMPTY subscription id until the
  // webhook lands, and an incomplete (non-entitling) profile.
  assert.equal(calls.upserts.length, 1);
  const [upsert] = calls.upserts;
  assert.equal(upsert.workspace_id, 'ws_1');
  assert.equal(upsert.stripe_customer_id, 'cus_new_1');
  assert.equal(upsert.stripe_subscription_id, '');
  assert.equal(upsert.stripe_price_id, PRICES.Professional.annual);
  assert.equal(upsert.seat_count, 3);
  assert.equal(upsert.entitlement_payload.billingState, 'Inactive');
  assert.equal(upsert.entitlement_payload.purchasedTier, 'Professional');
  assert.equal(upsert.entitlement_payload.monthlyRate, 29);
});

test('each tier buys its own price id, monthly by default', async () => {
  const cases = [
    { tier: 'Starter', billingPeriod: undefined, priceId: PRICES.Starter.monthly, period: 'monthly' },
    { tier: 'Professional', billingPeriod: 'monthly', priceId: PRICES.Professional.monthly, period: 'monthly' },
    { tier: 'Ranch Ops', billingPeriod: 'annual', priceId: PRICES['Ranch Ops'].annual, period: 'annual' },
    { tier: 'Enterprise', billingPeriod: 'monthly', priceId: PRICES.Enterprise.monthly, period: 'monthly' },
  ];

  for (const { tier, billingPeriod, priceId, period } of cases) {
    stripeScenario.reset();
    supabaseFor();

    const response = await invoke(fullHandler, {
      body: { tier, workspaceId: 'ws_1', ...(billingPeriod ? { billingPeriod } : {}), seatCount: 1 },
    });

    assert.equal(response.statusCode, 200, `${tier}/${period} should create a session`);
    assert.equal(stripeScenario.createdSessions.length, 1, `${tier}/${period} creates exactly one session`);
    const [params] = stripeScenario.createdSessions;
    assert.equal(params.line_items[0].price, priceId, `${tier}/${period} is sold at its own price`);
    assert.equal(params.metadata.workspace_tier, tier);
    assert.equal(params.metadata.workspace_billing_period, period);
    assert.equal(params.metadata.workspace_price_id, priceId);
    assert.equal(params.subscription_data.metadata.workspace_tier, tier);
  }
});

test('seat counts are clamped to 1..100', async () => {
  for (const [requested, expected] of [
    [500, 100],
    [0, 1],
    ['not-a-number', 1],
    [2.5, 1],
  ]) {
    stripeScenario.reset();
    supabaseFor();

    const response = await invoke(fullHandler, {
      body: { tier: 'Starter', workspaceId: 'ws_1', seatCount: requested },
    });

    assert.equal(response.statusCode, 200);
    const [params] = stripeScenario.createdSessions;
    assert.equal(params.line_items[0].quantity, expected, `seatCount ${requested} clamps to ${expected}`);
    assert.equal(params.metadata.workspace_seats, String(expected));
  }
});

test('a non-admin is refused before anything billable happens', async () => {
  stripeScenario.reset();
  supabaseFor({ role: 'Member' });

  const response = await invoke(fullHandler, {
    body: { tier: 'Professional', workspaceId: 'ws_1' },
    token: 'token-member',
  });

  assert.equal(response.statusCode, 403);
  assert.match(response.body.message, /Only workspace admins/);
  assert.deepEqual(
    stripeScenario.calls,
    [],
    'no customer, session, or other Stripe call after an authorization refusal',
  );
});

test('a missing access token is refused', async () => {
  stripeScenario.reset();
  supabaseFor();

  const response = await invoke(fullHandler, { body: { tier: 'Professional', workspaceId: 'ws_1' }, token: null });

  assert.equal(response.statusCode, 401);
  assert.deepEqual(stripeScenario.createdSessions, []);
});

test('an active subscription is not sold a second one', async () => {
  stripeScenario.reset();
  supabaseFor({
    billingRow: {
      stripe_customer_id: 'cus_live',
      stripe_subscription_id: 'sub_live',
      entitlement_payload: { billingState: 'Active', subscriptionRecoverable: false },
    },
  });

  const response = await invoke(fullHandler, { body: { tier: 'Ranch Ops', workspaceId: 'ws_1' } });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'subscription_active');
  assert.deepEqual(stripeScenario.createdSessions, [], 'refusal happens before any session exists');
});

test('a contended checkout lock is refused as retryable', async () => {
  stripeScenario.reset();
  supabaseFor({ lockClaimed: false });

  const response = await invoke(fullHandler, { body: { tier: 'Professional', workspaceId: 'ws_1' } });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'billing_unavailable');
  assert.equal(response.body.retryable, true);
  assert.deepEqual(stripeScenario.createdSessions, []);
});

test('a lost lock renewal aborts before the billable create', async () => {
  stripeScenario.reset();
  supabaseFor({ renewRows: [] });

  const response = await invoke(fullHandler, { body: { tier: 'Professional', workspaceId: 'ws_1' } });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'billing_unavailable');
  assert.deepEqual(stripeScenario.createdSessions, [], 'the session must not be created on a stale claim');
});

test('refuses when managed billing is paused', async () => {
  const pausedHandler = await importWithEnv({ MANAGED_BILLING_ENABLED: undefined }, 'paused');
  stripeScenario.reset();
  supabaseFor();

  const response = await invoke(pausedHandler, { body: { tier: 'Professional', workspaceId: 'ws_1' } });

  assert.equal(response.statusCode, 503);
  assert.match(response.body.message, /Managed billing is paused/);
  assert.deepEqual(stripeScenario.calls, [], 'nothing billable is touched while paused');
});

test('refuses when Stripe is not configured', async () => {
  const unconfiguredHandler = await importWithEnv({ STRIPE_SECRET_KEY: undefined }, 'nostripe');
  stripeScenario.reset();
  supabaseFor();

  const response = await invoke(unconfiguredHandler, { body: { tier: 'Professional', workspaceId: 'ws_1' } });

  assert.equal(response.statusCode, 503);
  assert.match(response.body.message, /not configured/);
  assert.deepEqual(stripeScenario.calls, []);
});

/*
 * Production offered annual billing with no annual price set (2026-10-02): the
 * toggle appeared because managed billing was on, and a buyer who chose annual
 * got "a configured Stripe price id are required" at the moment of paying. The
 * screen now asks the server what it can sell before offering a cadence, and a
 * cadence it cannot sell is refused in the buyer's terms.
 */
async function withEnv(overrides, action) {
  const saved = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await action();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('GET says which plans and cadences can be sold, and names no price id', async () => {
  const { default: handler } = await import('../../api/stripe/checkout.js');
  const response = await invoke(handler, { method: 'GET', token: null });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.managed, true);
  assert.deepEqual(response.body.sellable, {
    monthly: { Starter: true, Professional: true, 'Ranch Ops': true, Enterprise: true },
    annual: { Starter: false, Professional: true, 'Ranch Ops': true, Enterprise: false },
  });
  assert.doesNotMatch(JSON.stringify(response.body), /price_/, 'price ids stay on the server');
  assert.equal(response.headers['cache-control'], 'no-store, max-age=0');
});

test('a value that is not a price id is not sellable', async () => {
  const { default: handler } = await import('../../api/stripe/checkout.js');
  const response = await withEnv({ STRIPE_PRICE_ID_ENTERPRISE_ANNUAL: 'prod_1Ent', STRIPE_PRICE_ID_STARTER: ' ' }, () =>
    invoke(handler, { method: 'GET', token: null }),
  );
  assert.equal(response.body.sellable.annual.Enterprise, false, 'a product id cannot be checked out');
  assert.equal(response.body.sellable.monthly.Starter, false, 'blank is not a price');
});

test('a paused deployment reports nothing as managed', async () => {
  const pausedHandler = await importWithEnv({ MANAGED_BILLING_ENABLED: undefined }, 'paused-get');
  const response = await invoke(pausedHandler, { method: 'GET', token: null });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.managed, false, 'the screen must not offer what a POST would refuse');
});

test("a cadence the deployment cannot sell is refused in the buyer's terms", async () => {
  stripeScenario.reset();
  supabaseFor();
  const { default: handler } = await import('../../api/stripe/checkout.js');

  const response = await invoke(handler, { body: { tier: 'Starter', workspaceId: 'ws_1', billingPeriod: 'annual' } });

  assert.equal(response.statusCode, 409);
  assert.equal(response.body.code, 'cadence_unavailable', 'coded, so the client never falls back to a payment link');
  assert.equal(response.body.message, 'Annual billing is not available for Starter yet. Nothing was charged.');
  assert.deepEqual(stripeScenario.calls, [], 'nothing billable is touched');
});

test('a stale $499 Stripe price cannot be sold as the advertised $199 Enterprise plan', async () => {
  stripeScenario.reset();
  stripeScenario.priceOverrides = { unit_amount: 49900 };
  const calls = supabaseFor();
  const response = await invoke(fullHandler, { body: { tier: 'Enterprise', workspaceId: 'ws_1' } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'price_unavailable');
  assert.match(response.body.message, /price could not be verified/i);
  assert.deepEqual(stripeScenario.createdCustomers, []);
  assert.deepEqual(stripeScenario.createdSessions, []);
  assert.deepEqual(calls.upserts, [], 'no billing identity or purchase is recorded');
});

for (const [label, overrides] of [
  ['wrong currency', { currency: 'cad' }],
  [
    'annual price for monthly selection',
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
  ],
  ['multi-month interval', { recurring: { interval: 'month', interval_count: 3, usage_type: 'licensed' } }],
  ['metered billing', { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } }],
  ['one-time price', { type: 'one_time', recurring: null }],
  ['tiered amount', { billing_scheme: 'tiered', unit_amount: null }],
  ['transformed quantity', { transform_quantity: { divide_by: 5, round: 'up' } }],
  ['inactive price', { active: false }],
  ['inactive product', { product: { id: 'prod_xbar', active: false } }],
  ['deleted product', { product: { id: 'prod_xbar', deleted: true } }],
  ['unexpanded product', { product: 'prod_xbar' }],
  ['wrong price identity', { id: 'price_other' }],
  ['missing amount', { unit_amount: null }],
]) {
  test(`checkout refuses ${label} before Stripe or billing writes`, async () => {
    stripeScenario.reset();
    stripeScenario.priceOverrides = overrides;
    const calls = supabaseFor();
    const response = await invoke(fullHandler, { body: { tier: 'Enterprise', workspaceId: 'ws_1' } });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'price_unavailable');
    assert.deepEqual(stripeScenario.createdCustomers, []);
    assert.deepEqual(stripeScenario.createdSessions, []);
    assert.deepEqual(calls.upserts, []);
  });
}

test('a failed Stripe price lookup fails closed without exposing provider details', async () => {
  stripeScenario.reset();
  stripeScenario.priceError = new Error('No such price: price_private_diagnostic');
  supabaseFor();
  const response = await invoke(fullHandler, { body: { tier: 'Enterprise', workspaceId: 'ws_1' } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'price_unavailable');
  assert.doesNotMatch(JSON.stringify(response.body), /price_private_diagnostic/);
  assert.deepEqual(stripeScenario.createdSessions, []);
});

test('reusing an unfinished checkout also requires a freshly verified price', async () => {
  stripeScenario.reset();
  stripeScenario.priceOverrides = { unit_amount: 49900 };
  stripeScenario.openSessions = [reusableEnterpriseSession()];
  supabaseFor({
    billingRow: { stripe_customer_id: 'cus_existing', stripe_subscription_id: '', entitlement_payload: {} },
  });
  const response = await invoke(fullHandler, { body: { tier: 'Enterprise', workspaceId: 'ws_1' } });
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.code, 'price_unavailable');
  assert.equal(response.body.url, undefined);
  assert.deepEqual(stripeScenario.createdSessions, []);
  assert.deepEqual(stripeScenario.calls, [['prices.retrieve', PRICES.Enterprise.monthly]]);
});

function reusableEnterpriseSession() {
  return {
    id: 'cs_stale',
    status: 'open',
    mode: 'subscription',
    url: 'https://checkout.stripe.com/stale',
    metadata: {
      workspace_id: 'ws_1',
      workspace_tier: 'Enterprise',
      workspace_seats: '1',
      workspace_billing_period: 'monthly',
      workspace_price_id: PRICES.Enterprise.monthly,
    },
  };
}

test('an unchanged correctly priced Enterprise checkout is reused without a second session or billing write', async () => {
  stripeScenario.reset();
  stripeScenario.openSessions = [reusableEnterpriseSession()];
  const calls = supabaseFor({
    billingRow: { stripe_customer_id: 'cus_existing', stripe_subscription_id: '', entitlement_payload: {} },
  });
  const response = await invoke(fullHandler, { body: { tier: 'Enterprise', workspaceId: 'ws_1' } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.url, 'https://checkout.stripe.com/stale');
  assert.equal(response.body.sessionId, 'cs_stale');
  assert.deepEqual(stripeScenario.createdCustomers, []);
  assert.deepEqual(stripeScenario.createdSessions, []);
  assert.deepEqual(calls.upserts, []);
  assert.deepEqual(stripeScenario.calls[0], ['prices.retrieve', PRICES.Enterprise.monthly]);
});

for (const [label, env, priceOverrides, accountId, accountError] of [
  ['test price in production', { VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_fixture' }, { livemode: false }],
  [
    'unknown mode in production',
    { VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_fixture' },
    { livemode: undefined },
  ],
  ['test key in production', { VERCEL_ENV: 'production' }, { livemode: true }],
  ['live price with a test key', {}, { livemode: true }],
  ['wrong Stripe account', { STRIPE_ACCOUNT_ID: 'acct_expected' }, {}, 'acct_other'],
  ['malformed expected account', { STRIPE_ACCOUNT_ID: 'not-an-account' }, {}],
  [
    'unreadable Stripe account',
    { STRIPE_ACCOUNT_ID: 'acct_expected' },
    {},
    'acct_expected',
    new Error('private account details'),
  ],
]) {
  test(`checkout refuses ${label} before customer, session, or billing writes`, async () => {
    stripeScenario.reset();
    stripeScenario.priceOverrides = priceOverrides;
    if (accountId) stripeScenario.accountId = accountId;
    stripeScenario.accountError = accountError;
    const calls = supabaseFor();
    const handler = await importWithEnv({ VERCEL_ENV: undefined, STRIPE_ACCOUNT_ID: undefined, ...env }, label);
    const response = await invoke(handler, { body: { tier: 'Enterprise', workspaceId: 'ws_1' } });
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, 'price_unavailable');
    assert.deepEqual(stripeScenario.createdCustomers, []);
    assert.deepEqual(stripeScenario.createdSessions, []);
    assert.deepEqual(calls.upserts, []);
    assert.doesNotMatch(JSON.stringify(response.body), /acct_other|private account details/);
  });
}

test('production checkout accepts the verified live price and pinned account', async () => {
  stripeScenario.reset();
  stripeScenario.priceOverrides = { livemode: true };
  supabaseFor();
  const handler = await importWithEnv(
    { VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_endpoint_fixture', STRIPE_ACCOUNT_ID: 'acct_expected' },
    'verified-live-account',
  );
  const response = await invoke(handler, { body: { tier: 'Enterprise', workspaceId: 'ws_1' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(stripeScenario.calls[0], ['accounts.retrieve']);
  assert.equal(stripeScenario.createdSessions.length, 1);
});

for (const [label, env, managed] of [
  ['production test mode', { VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_fixture' }, false],
  ['production live mode', { VERCEL_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_fixture' }, true],
  ['preview test mode', { VERCEL_ENV: 'preview', STRIPE_SECRET_KEY: 'sk_test_fixture' }, true],
]) {
  test(`GET availability reports ${label} truthfully`, async () => {
    stripeScenario.reset();
    const handler = await importWithEnv(env, `readiness-${label}`);
    const response = await invoke(handler, { method: 'GET', token: null });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.managed, managed);
    assert.deepEqual(stripeScenario.calls, [], 'public readiness never calls privileged Stripe APIs');
  });
}

for (const [STRIPE_ACCOUNT_ID, managed] of [
  [undefined, true],
  ['', true],
  ['acct_expected', true],
  ['acct_', false],
  ['not-an-account', false],
]) {
  test(`GET reflects optional account-pin shape: ${STRIPE_ACCOUNT_ID || 'unset'}`, async () => {
    stripeScenario.reset();
    const handler = await importWithEnv({ STRIPE_ACCOUNT_ID }, `account-readiness-${STRIPE_ACCOUNT_ID}`);
    const response = await invoke(handler, { method: 'GET', token: null });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.managed, managed);
    assert.deepEqual(stripeScenario.calls, []);
    assert.doesNotMatch(JSON.stringify(response.body), /acct_|not-an-account/);
  });
}
