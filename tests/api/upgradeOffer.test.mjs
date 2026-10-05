import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { createUpgradeOfferHandler } from '../../api/_lib/upgrade-offer.js';
import {
  verifiedPortalConfiguration,
  verifyUpgradeCoupon,
  createUpgradeCheckout,
} from '../../api/_lib/upgrade-checkout.js';
import { planCheckoutSession } from '../../api/_lib/checkout-session.js';
import { UPGRADE_FEATURES } from '../../api/_lib/upgrade-features.js';
import { makeClient } from './fixtures/billingSupabaseStub.mjs';

const OWNER = '11111111-1111-4111-8111-111111111111';
const WORKSPACE = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-10-03T20:00:00.000Z');
process.env.STRIPE_PRICE_ID_STARTER = 'price_starter';
process.env.STRIPE_PRICE_ID_PROFESSIONAL = 'price_pro';
process.env.STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL = 'price_pro_annual';
process.env.STRIPE_PRICE_ID_RANCH_OPS = 'price_ranch';
process.env.STRIPE_PRICE_ID_ENTERPRISE = 'price_enterprise';
const prices = { price_pro: 2900, price_pro_annual: 29000, price_ranch: 7900, price_enterprise: 19900 };
const priceObject = (id) => ({
  id,
  active: true,
  livemode: false,
  type: 'recurring',
  currency: 'usd',
  billing_scheme: 'per_unit',
  unit_amount: prices[id],
  transform_quantity: null,
  recurring: { interval: id.endsWith('annual') ? 'year' : 'month', interval_count: 1, usage_type: 'licensed' },
  product: { id: 'prod_xbar', active: true },
});
const couponObject = () => ({
  id: 'coupon_first',
  valid: true,
  livemode: false,
  percent_off: 10,
  amount_off: null,
  duration: 'once',
  duration_in_months: null,
  max_redemptions: null,
  redeem_by: null,
});
const portalConfig = () => ({
  id: 'bpc_upgrade',
  active: true,
  livemode: false,
  features: {
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      billing_cycle_anchor: 'now',
      proration_behavior: 'always_invoice',
      schedule_at_period_end: { conditions: [] },
      products: [{ product: 'prod_xbar', prices: Object.keys(prices) }],
    },
  },
});
const subscription = () => ({
  id: 'sub_existing',
  status: 'active',
  customer: 'cus_existing',
  livemode: false,
  metadata: { workspace_id: WORKSPACE },
  items: { data: [{ id: 'si_existing', price: { id: 'price_starter' }, quantity: 1 }] },
  collection_method: 'charge_automatically',
  latest_invoice: { status: 'paid' },
  billing_mode: { type: 'classic' },
});

function scenario() {
  const s = {
    calls: [],
    campaigns: new Map(),
    attempts: new Map(),
    discountClaim: null,
    env: {
      STRIPE_SECRET_KEY: 'sk_test_injected',
      MANAGED_BILLING_ENABLED: 'true',
      UPGRADE_OFFERS_ENABLED: 'true',
      STRIPE_UPGRADE_ACCOUNT_ID: 'acct_xbar',
      STRIPE_UPGRADE_LIVEMODE: 'false',
      STRIPE_UPGRADE_COUPON_ID: 'coupon_first',
      STRIPE_UPGRADE_PORTAL_CONFIGURATION_ID: 'bpc_upgrade',
      STRIPE_UPGRADE_PAID_CONFIRMATIONS_VERIFIED: 'true',
      PUBLIC_APP_URL: 'https://xbar.example',
    },
    owner: OWNER,
    authorized: true,
    effectiveTier: 'Starter',
    billing: {},
    subscriptions: [],
    sessions: [],
    coupon: couponObject(),
    config: portalConfig(),
    priceOverride: {},
    now: NOW,
    account: 'acct_xbar',
    customerOverride: {},
    rpcError: false,
    billingError: false,
    ownerError: false,
    loseLease: false,
    claimBusy: false,
    customerWriteError: false,
    sessionWriteError: false,
    idempotentSessions: new Map(),
    idempotentPortal: new Map(),
    listCount: 0,
    onList: null,
  };
  s.db = makeClient({
    tables: {
      workspaces: async (_mode, ops) => {
        s.calls.push(['workspace', ops]);
        return { data: { id: WORKSPACE, owner_user_id: s.owner }, error: s.ownerError ? {} : null };
      },
      workspace_billing_customers: async (_mode, ops) => {
        s.calls.push(['billing', ops]);
        const update = ops.find((op) => op[0] === 'update')?.[1];
        if (update) {
          if (update.stripe_customer_id) {
            if (s.customerWriteError) return { data: [], error: {} };
            Object.assign(s.billing, update);
            return { data: [{ workspace_id: WORKSPACE, stripe_customer_id: update.stripe_customer_id }], error: null };
          }
          return { data: s.loseLease ? [] : [{ workspace_id: WORKSPACE }], error: null };
        }
        return { data: s.billing, error: s.billingError ? {} : null };
      },
    },
    rpcImpl: async (name, p) => {
      s.calls.push(['rpc', name, p]);
      if (name === 'xbar_claim_checkout_lock') return { data: !s.claimBusy, error: null };
      if (s.rpcError) return { data: null, error: { message: 'missing migration' } };
      assert.equal(name, 'xbar_upgrade_offer_action');
      let a = s.attempts.get(p.p_attempt_id);
      if (
        a &&
        (a.user_id !== p.p_user_id ||
          a.workspace_id !== p.p_workspace_id ||
          a.feature !== p.p_feature ||
          a.billing_period !== p.p_billing_period)
      )
        return { data: { ok: false, code: 'attempt_conflict' }, error: null };
      if (!a) {
        if (p.p_action !== 'attempt') return { data: { ok: false, code: 'attempt_not_found' }, error: null };
        const c = s.campaigns.get(p.p_feature) || { count: 0, declined: false };
        a = {
          attempt_id: p.p_attempt_id,
          user_id: p.p_user_id,
          workspace_id: p.p_workspace_id,
          feature: p.p_feature,
          billing_period: p.p_billing_period,
          attempt_number: ++c.count,
          discount_eligible: c.count === 2 && c.declined,
          declined: false,
          created_at: s.now.toISOString(),
        };
        s.campaigns.set(p.p_feature, c);
        s.attempts.set(p.p_attempt_id, a);
      }
      if (p.p_action === 'decline') {
        a.declined = true;
        if (a.attempt_number === 1) s.campaigns.get(a.feature).declined = true;
      }
      const eligible =
        a.discount_eligible &&
        !a.declined &&
        Date.parse(a.created_at) > s.now.getTime() - 30 * 60_000 &&
        (!s.discountClaim || s.discountClaim === a.attempt_id);
      if (p.p_action === 'begin_checkout') {
        if (a.declined || Date.parse(a.created_at) <= s.now.getTime() - 30 * 60_000)
          return { data: { ok: false, code: 'offer_expired' }, error: null };
        if (p.p_discount_percent === 10 && !eligible)
          return { data: { ok: false, code: 'offer_changed' }, error: null };
        if (
          a.checkout_started_at &&
          (a.checkout_kind !== p.p_kind ||
            a.checkout_price_id !== p.p_price_id ||
            a.checkout_coupon_id !== p.p_coupon_id ||
            a.checkout_discount_percent !== p.p_discount_percent)
        )
          return { data: { ok: false, code: 'offer_changed' }, error: null };
        if (!a.checkout_started_at) {
          if (p.p_discount_percent === 10) s.discountClaim = a.attempt_id;
          Object.assign(a, {
            checkout_started_at: s.now.toISOString(),
            checkout_kind: p.p_kind,
            checkout_price_id: p.p_price_id,
            checkout_coupon_id: p.p_coupon_id,
            checkout_discount_percent: p.p_discount_percent,
          });
        }
      }
      if (p.p_action === 'save_session') {
        if (s.sessionWriteError) return { data: null, error: {} };
        a.session_id = p.p_session_id;
        a.session_url = p.p_session_url;
      }
      return { data: { ok: true, attempt: { ...a }, discountEligible: eligible }, error: null };
    },
  });
  s.stripe = {
    accounts: { retrieve: async () => ({ id: s.account }) },
    prices: {
      retrieve: async (id) => {
        s.calls.push(['price', id]);
        return { ...priceObject(id), ...s.priceOverride };
      },
    },
    coupons: {
      retrieve: async () => {
        s.calls.push(['coupon']);
        if (s.coupon instanceof Error) throw s.coupon;
        return s.coupon;
      },
    },
    customers: {
      retrieve: async (id) => ({ id, livemode: false, metadata: { workspace_id: WORKSPACE }, ...s.customerOverride }),
      create: async (p, options) => {
        s.calls.push(['customer.create', p, options]);
        return { id: 'cus_existing' };
      },
    },
    subscriptions: {
      list: async (p) => {
        s.calls.push(['subscription.list', p]);
        s.listCount++;
        s.onList?.(s.listCount);
        return { data: s.subscriptions, has_more: false };
      },
      retrieve: async (id) => {
        s.calls.push(['subscription.retrieve', id]);
        const sub = s.subscriptions.find((item) => item.id === id) || {
          id,
          customer: 'cus_existing',
          status: 'canceled',
        };
        return s.onRetrieve ? s.onRetrieve(structuredClone(sub)) : sub;
      },
    },
    checkout: {
      sessions: {
        list: async () => {
          s.calls.push(['checkout.list']);
          return { data: s.sessions.filter((item) => item.status === 'open'), has_more: false };
        },
        retrieve: async (id) => s.sessions.find((item) => item.id === id),
        expire: async (id) => {
          s.calls.push(['checkout.expire', id]);
          const found = s.sessions.find((item) => item.id === id);
          if (s.expireError) {
            found.status = 'complete';
            throw new Error('completed');
          }
          found.status = 'expired';
          return found;
        },
        create: async (p, options) => {
          s.calls.push(['checkout.create', p, options]);
          if (!s.idempotentSessions.has(options.idempotencyKey)) {
            const item = {
              id: `cs_${s.idempotentSessions.size + 1}`,
              url: 'https://checkout.stripe.com/c/pay/new',
              status: 'open',
              ...p,
            };
            s.idempotentSessions.set(options.idempotencyKey, item);
            s.sessions.push(item);
          }
          return s.idempotentSessions.get(options.idempotencyKey);
        },
      },
    },
    billingPortal: {
      configurations: { retrieve: async () => s.config },
      sessions: {
        create: async (p, options) => {
          s.calls.push(['portal.create', p, options]);
          if (!s.idempotentPortal.has(options.idempotencyKey))
            s.idempotentPortal.set(options.idempotencyKey, {
              id: 'bps_one',
              url: 'https://billing.stripe.com/p/session/one',
            });
          return s.idempotentPortal.get(options.idempotencyKey);
        },
      },
    },
  };
  const handler = createUpgradeOfferHandler({
    authenticate: async () =>
      s.authorized
        ? { ok: true, supabase: s.db, user: { id: OWNER, email: 'owner@example.invalid' }, role: 'Admin' }
        : { ok: false, status: 401, message: 'Sign in.' },
    entitlements: async () => ({ ok: true, effectiveTier: s.effectiveTier }),
    rateLimit: async () => true,
    env: s.env,
    stripe: s.stripe,
    now: () => s.now,
  });
  s.request = async (overrides = {}, method = 'POST') => {
    const req = Readable.from([
      JSON.stringify({
        workspaceId: WORKSPACE,
        feature: 'buyerDealRoom',
        action: 'attempt',
        attemptId: randomUUID(),
        ...overrides,
      }),
    ]);
    req.method = method;
    req.headers = { authorization: 'Bearer test' };
    let payload;
    const res = {
      statusCode: 0,
      setHeader() {},
      end: (value) => {
        payload = value ? JSON.parse(value) : null;
      },
    };
    await handler(req, res);
    return { status: res.statusCode, body: payload };
  };
  s.discountAttempt = async (extra = {}) => {
    const first = randomUUID();
    const second = randomUUID();
    await s.request({ attemptId: first, ...extra });
    await s.request({ attemptId: first, action: 'decline', ...extra });
    const response = await s.request({ attemptId: second, ...extra });
    return { attemptId: second, ...response };
  };
  s.created = (kind) => s.calls.filter(([action]) => action === `${kind}.create`);
  return s;
}

test('first attempt, explicit decline, exactly second attempt, retry, and third attempt', async () => {
  const s = scenario();
  const first = randomUUID();
  assert.equal((await s.request({ attemptId: first })).body.offer.discountPercent, 0);
  await s.request({ attemptId: first, action: 'decline' });
  await s.request({ attemptId: first, action: 'decline' });
  const second = randomUUID();
  for (let i = 0; i < 3; i++) assert.equal((await s.request({ attemptId: second })).body.offer.discountPercent, 10);
  assert.equal(s.campaigns.get('buyerDealRoom').count, 2);
  assert.equal((await s.request()).body.offer.discountPercent, 0);
  assert.equal(s.created('checkout').length, 0, 'display is not purchase');
});
test('late decline never retroactively grants a second attempt; other features have separate histories', async () => {
  const s = scenario();
  const first = randomUUID();
  const second = randomUUID();
  await s.request({ attemptId: first });
  assert.equal((await s.request({ attemptId: second })).body.offer.discountPercent, 0);
  await s.request({ attemptId: first, action: 'decline' });
  assert.equal((await s.request({ attemptId: second })).body.offer.discountPercent, 0);
  assert.equal((await s.request({ feature: 'reportWhiteLabel' })).body.offer.discountPercent, 0);
});
test('every shared feature uses the authoritative required tier', async () => {
  for (const [feature, value] of Object.entries(UPGRADE_FEATURES)) {
    const s = scenario();
    const result = await s.request({ feature });
    assert.equal(result.body.offer.targetTier, value.tier);
  }
});
test('monthly and annual quote actual verified base price and exactly one 10% period', async () => {
  for (const [billingPeriod, normal] of [
    ['monthly', 2900],
    ['annual', 29000],
  ]) {
    const s = scenario();
    const result = await s.discountAttempt({ billingPeriod });
    assert.equal(result.body.offer.regularAmountCents, normal);
    assert.equal(result.body.offer.firstPeriodAmountCents, normal * 0.9);
  }
});
test('forged price/tier/coupon is rejected before auth or persistence', async () => {
  for (const addition of [
    { targetTier: 'Enterprise' },
    { couponId: 'coupon_forged' },
    { discountPercent: 10 },
    { feature: '__proto__' },
  ]) {
    const s = scenario();
    assert.equal((await s.request(addition)).status, 400);
    assert.equal(s.calls.length, 0);
  }
});
test('anonymous, non-owner admin, and unreadable ownership cannot write offer state', async () => {
  for (const mode of ['anonymous', 'nonowner', 'unknown']) {
    const s = scenario();
    if (mode === 'anonymous') s.authorized = false;
    if (mode === 'nonowner') s.owner = randomUUID();
    if (mode === 'unknown') s.ownerError = true;
    assert.equal((await s.request()).status, mode === 'anonymous' ? 401 : mode === 'nonowner' ? 403 : 503);
    assert.equal(s.calls.filter(([name]) => name === 'rpc').length, 0);
  }
});
test('already entitled including trial/comp skips offers and writes', async () => {
  const s = scenario();
  s.effectiveTier = 'Enterprise';
  assert.deepEqual((await s.request()).body, { ok: true, allowed: true, offer: null });
  assert.equal(s.attempts.size, 0);
});
test('attempt replay across workspace, feature, or cadence fails instead of reassigning', async () => {
  const s = scenario();
  const id = randomUUID();
  await s.request({ attemptId: id });
  for (const changed of [{ workspaceId: OTHER_WORKSPACE }, { feature: 'packetExport' }, { billingPeriod: 'annual' }]) {
    assert.equal((await s.request({ attemptId: id, ...changed })).body.code, 'attempt_conflict');
  }
});
test('missing migration fails closed, without fabricated discount or Stripe writes', async () => {
  const s = scenario();
  s.rpcError = true;
  assert.equal((await s.request()).status, 503);
  assert.equal(s.calls.filter(([action]) => action === 'price').length, 0);
});
test('unverified price/account/mode or paused billing returns no invented numerical quote', async () => {
  for (const change of [
    (s) => {
      s.priceOverride.unit_amount = 1;
    },
    (s) => {
      s.account = 'acct_wrong';
    },
    (s) => {
      s.env.STRIPE_UPGRADE_LIVEMODE = 'true';
    },
    (s) => {
      s.env.VERCEL_ENV = 'production';
    },
    (s) => {
      s.env.UPGRADE_OFFERS_ENABLED = 'false';
    },
    (s) => {
      s.billingError = true;
    },
  ]) {
    const s = scenario();
    change(s);
    const offer = (await s.request()).body.offer;
    assert.equal(offer.checkoutAvailable, false);
    assert.equal(offer.regularAmountCents, null);
    assert.equal(offer.discountPercent, 0);
    assert.equal(s.created('checkout').length, 0);
  }
});
test('coupon absence/invalidity honestly falls back to full price', async () => {
  for (const coupon of [
    new Error('unavailable'),
    { ...couponObject(), duration: 'forever' },
    { ...couponObject(), percent_off: 20 },
  ]) {
    const s = scenario();
    s.coupon = coupon;
    const result = await s.discountAttempt();
    assert.equal(result.body.offer.discountPercent, 0);
    assert.equal(result.body.offer.checkoutAvailable, true);
    assert.match(result.body.offer.message, /regular price/);
  }
});
test('coupon verification rejects every unsupported duration, restriction, expiry, redemption, or mode', async () => {
  for (const override of [
    { valid: false },
    { deleted: true },
    { percent_off: 9.9 },
    { amount_off: 290 },
    { duration: 'repeating' },
    { duration: 'forever' },
    { duration_in_months: 1 },
    { livemode: true },
    { redeem_by: NOW.getTime() / 1000 - 1 },
    { max_redemptions: 1, times_redeemed: 1 },
    { applies_to: { products: ['prod_other'] } },
    { applies_to: { products: [] } },
  ]) {
    const stripe = { coupons: { retrieve: async () => ({ ...couponObject(), ...override }) } };
    assert.equal(
      await verifyUpgradeCoupon(stripe, 'coupon_first', priceObject('price_pro'), NOW),
      false,
      JSON.stringify(override),
    );
  }
});
test('checkout requires displayed discount acceptance and refuses changed discount', async () => {
  const s = scenario();
  const { attemptId } = await s.discountAttempt();
  assert.equal((await s.request({ attemptId, action: 'checkout' })).status, 400);
  s.coupon = new Error('coupon removed');
  const result = await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 });
  assert.equal(result.body.code, 'offer_changed');
  assert.equal(s.created('checkout').length, 0);
});
test('new purchase creates one coupon-bound checkout, retry reuses it, no entitlements written', async () => {
  const s = scenario();
  const { attemptId } = await s.discountAttempt();
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 })).body.kind,
      'checkout',
    );
  assert.equal(s.created('checkout').length, 1);
  const params = s.created('checkout')[0][1];
  assert.deepEqual(params.discounts, [{ coupon: 'coupon_first' }]);
  assert.deepEqual(params.line_items, [{ price: 'price_pro', quantity: 1 }]);
  assert.deepEqual(params.payment_method_types, ['card']);
  assert.equal(params.success_url, 'https://xbar.example/app/billing?checkout=success');
  assert.equal(params.cancel_url, 'https://xbar.example/app/billing?checkout=cancelled');
  assert.equal(params.subscription_data.trial_period_days, undefined);
  assert.equal(params.metadata.upgrade_offer_attempt_id, attemptId);
  assert.equal(s.discountClaim, attemptId);
  assert.equal(
    s.calls.some(([, ops]) => Array.isArray(ops) && ops.some((op) => op[1]?.entitlement_payload)),
    false,
  );
});
test('account-wide claim prevents a second feature’s discount session', async () => {
  const s = scenario();
  const first = await s.discountAttempt();
  await s.request({ attemptId: first.attemptId, action: 'checkout', expectedDiscountPercent: 10 });
  const second = await s.discountAttempt({ feature: 'packetExport' });
  assert.equal(second.body.offer.discountPercent, 0);
});
test('unrecorded customer never gets a billable session', async () => {
  const s = scenario();
  s.customerWriteError = true;
  const attemptId = randomUUID();
  await s.request({ attemptId });
  assert.equal((await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 0 })).status, 503);
  assert.equal(s.created('checkout').length, 0);
});
test('failed session save is safely retryable without a second hosted purchase', async () => {
  const s = scenario();
  const { attemptId } = await s.discountAttempt();
  s.sessionWriteError = true;
  assert.equal((await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 })).status, 503);
  s.sessionWriteError = false;
  assert.equal((await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 })).status, 200);
  assert.equal(s.created('checkout').length, 1);
});
test('lost lease or busy checkout never creates payment session', async () => {
  for (const flag of ['loseLease', 'claimBusy']) {
    const s = scenario();
    const attemptId = randomUUID();
    await s.request({ attemptId });
    s[flag] = true;
    assert.equal((await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 0 })).status, 409);
    assert.equal(s.created('checkout').length, 0);
  }
});
test('subscription completed between quote and hosted creation prevents duplicate checkout', async () => {
  const s = scenario();
  s.billing.stripe_customer_id = 'cus_existing';
  const attemptId = randomUUID();
  await s.request({ attemptId });
  s.onList = (n) => {
    if (n >= 3) s.subscriptions = [subscription()];
  };
  assert.equal(
    (await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 0 })).body.code,
    'billing_changed',
  );
  assert.equal(s.created('checkout').length, 0);
});
test('active paid subscription uses hosted confirm on existing item, never Checkout', async () => {
  const s = scenario();
  s.billing = { stripe_customer_id: 'cus_existing', stripe_subscription_id: 'sub_existing' };
  s.subscriptions = [subscription()];
  const result = await s.discountAttempt();
  assert.equal(result.body.offer.discountPercent, 10);
  assert.match(result.body.offer.message, /credit for unused time/);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await s.request({ attemptId: result.attemptId, action: 'checkout', expectedDiscountPercent: 10 })).body.kind,
      'subscription_update',
    );
  assert.equal(s.created('checkout').length, 0);
  assert.equal(s.created('portal').length, 1);
  const flow = s.created('portal')[0][1].flow_data;
  assert.equal(flow.type, 'subscription_update_confirm');
  assert.equal(flow.subscription_update_confirm.subscription, 'sub_existing');
  assert.deepEqual(flow.subscription_update_confirm.items, [{ id: 'si_existing', price: 'price_pro', quantity: 1 }]);
  assert.deepEqual(flow.subscription_update_confirm.discounts, [{ coupon: 'coupon_first' }]);
});
test('expired discounted portal is never reissued', async () => {
  const s = scenario();
  s.billing.stripe_customer_id = 'cus_existing';
  s.subscriptions = [subscription()];
  const { attemptId } = await s.discountAttempt();
  await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 });
  s.now = new Date(NOW.getTime() + 5 * 60_000);
  assert.equal(
    (await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 })).body.code,
    'offer_expired',
  );
  assert.equal(s.created('portal').length, 1);
});
test('paid review states never fall back to a second Checkout subscription', async () => {
  for (const override of [
    { status: 'past_due' },
    { status: 'trialing' },
    { status: 'unpaid' },
    { status: 'paused' },
    { status: 'mystery' },
    { pending_update: {} },
    { discounts: [{}] },
    { schedule: 'sub_sched' },
    { latest_invoice: { status: 'open' } },
    { customer: 'cus_other' },
    { cancel_at_period_end: true },
  ]) {
    const s = scenario();
    s.billing.stripe_customer_id = 'cus_existing';
    s.subscriptions = [{ ...subscription(), ...override }];
    const result = await s.request();
    assert.equal(result.body.offer.checkoutAvailable, false, JSON.stringify(override));
    assert.equal(s.created('checkout').length, 0);
  }
});
test('multiple active subscriptions or wrong customer identity fail closed', async () => {
  for (const mode of ['multiple', 'identity', 'discount']) {
    const s = scenario();
    s.billing.stripe_customer_id = 'cus_existing';
    if (mode === 'multiple') s.subscriptions = [subscription(), { ...subscription(), id: 'sub_second' }];
    if (mode === 'identity') s.customerOverride.metadata = { workspace_id: OTHER_WORKSPACE };
    if (mode === 'discount') s.customerOverride.discount = { id: 'discount_existing' };
    assert.equal((await s.request()).body.offer.checkoutAvailable, false);
  }
});
test('portal terms must start a full period and invoice proration credits, never silently schedule', () => {
  const price = priceObject('price_pro');
  assert.equal(verifiedPortalConfiguration(portalConfig(), price, 'bpc_upgrade'), true);
  for (const override of [
    { billing_cycle_anchor: 'unchanged' },
    { proration_behavior: 'none' },
    { enabled: false },
    { schedule_at_period_end: { conditions: [{}] } },
    { products: [] },
    { default_allowed_updates: [] },
  ]) {
    const config = portalConfig();
    Object.assign(config.features.subscription_update, override);
    assert.equal(verifiedPortalConfiguration(config, price, 'bpc_upgrade'), false);
  }
});
test('ordinary checkout and separate offer attempts cannot reuse discounted session', () => {
  const intent = {
    workspaceId: WORKSPACE,
    tier: 'Professional',
    seatCount: 1,
    billingPeriod: 'monthly',
    priceId: 'price_pro',
  };
  const session = {
    id: 'cs_offer',
    status: 'open',
    mode: 'subscription',
    url: 'https://checkout.stripe.com/c/pay/offer',
    metadata: {
      workspace_id: WORKSPACE,
      workspace_tier: 'Professional',
      workspace_seats: '1',
      workspace_billing_period: 'monthly',
      workspace_price_id: 'price_pro',
      upgrade_offer_attempt_id: 'attempt-2',
      upgrade_offer_coupon_id: 'coupon_first',
    },
  };
  assert.equal(planCheckoutSession([session], intent).action, 'create');
  assert.equal(
    planCheckoutSession([session], { ...intent, offerAttemptId: 'attempt-2', couponId: 'coupon_first' }).action,
    'reuse',
  );
  assert.equal(
    planCheckoutSession([session], { ...intent, offerAttemptId: 'attempt-3', couponId: 'coupon_first' }).action,
    'create',
  );
});
test('SQL contract is durable, serialized, owner-only, service-only and rollback-safe', () => {
  const sql = readFileSync('supabase/migrations/20261003200000_upgrade_offers.sql', 'utf8');
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /campaign.attempt_count = 1 and campaign.first_declined/);
  assert.match(sql, /attempt\.user_id <> p_user_id/);
  assert.match(sql, /owner_id is distinct from p_user_id/);
  assert.match(sql, /user_id uuid primary key references auth.users/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /to service_role/);
  assert.match(sql, /Keep\n-- these additive tables/);
  assert.doesNotMatch(sql, /grant[^;]+to authenticated/i);
  assert.ok(readFileSync('api/account/[action].js', 'utf8').includes("action === 'upgrade-offer'"));
});

test('unverified paid confirmation flow defaults off, with no discount CTA or new session', async () => {
  for (const flag of [undefined, 'false']) {
    const s = scenario();
    delete s.env.STRIPE_UPGRADE_PAID_CONFIRMATIONS_VERIFIED;
    if (flag) s.env.STRIPE_UPGRADE_PAID_CONFIRMATIONS_VERIFIED = flag;
    s.billing.stripe_customer_id = 'cus_existing';
    s.subscriptions = [subscription()];
    const { attemptId, body } = await s.discountAttempt();
    assert.equal(body.offer.discountPercent, 0);
    assert.equal(body.offer.firstPeriodAmountCents, null);
    assert.equal(body.offer.checkoutAvailable, false);
    assert.match(body.offer.message, /billing management/);
    assert.equal((await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 0 })).status, 503);
    assert.equal(s.created('portal').length, 0);
    assert.equal(s.created('checkout').length, 0);
  }
});
test('all paid subscription invariants are rechecked on the final expanded read', async () => {
  for (const override of [
    { cancel_at_period_end: true },
    { pause_collection: { behavior: 'void' } },
    { collection_method: 'send_invoice' },
    { latest_invoice: { status: 'open' } },
    { billing_mode: { type: 'flexible' } },
    { customer: 'cus_other' },
    { metadata: { workspace_id: OTHER_WORKSPACE } },
    { items: { data: [{ id: 'si_other', price: { id: 'price_starter' }, quantity: 1 }] } },
  ]) {
    const s = scenario();
    s.billing.stripe_customer_id = 'cus_existing';
    s.subscriptions = [subscription()];
    const { attemptId } = await s.discountAttempt();
    let reads = 0;
    s.onRetrieve = (sub) => (++reads === 2 ? { ...sub, ...override } : sub);
    const result = await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 });
    assert.equal(result.status, 409, JSON.stringify(override));
    assert.equal(s.created('portal').length, 0);
  }
});

test('stale discounted paid offer cannot bypass a disabled confirmation gate', async () => {
  const s = scenario();
  s.billing.stripe_customer_id = 'cus_existing';
  s.subscriptions = [subscription()];
  const { attemptId, body } = await s.discountAttempt();
  assert.equal(body.offer.discountPercent, 10);
  s.env.STRIPE_UPGRADE_PAID_CONFIRMATIONS_VERIFIED = 'false';
  const result = await s.request({ attemptId, action: 'checkout', expectedDiscountPercent: 10 });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'paid_confirmation_unverified');
  assert.equal(s.created('portal').length, 0);
  assert.equal(s.created('checkout').length, 0);
  assert.equal(s.discountClaim, null);
});
test('checkout helper independently refuses paid flow when release gate is absent', async () => {
  const s = scenario();
  await assert.rejects(
    createUpgradeCheckout({
      stripe: s.stripe,
      supabase: s.db,
      input: {},
      user: {},
      quote: { subscription: subscription() },
      claimToken: 'untrusted',
      env: {},
    }),
    (error) => error.code === 'paid_confirmation_unverified',
  );
  assert.equal(s.calls.length, 0);
});
