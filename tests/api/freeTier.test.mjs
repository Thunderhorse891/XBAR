import assert from 'node:assert/strict';
import test from 'node:test';
import {
  subscriptionPlans,
  buildSubscriptionProfile,
  findTierByPriceId,
  getStripePriceIdByTier,
  sellablePrices,
} from '../../api/_lib/subscription-plans.js';
import { BASELINE_TIER, entitledTierForBillingState } from '../../api/_lib/subscription-status.js';
import { getWorkspaceEntitlements } from '../../api/_lib/entitlements.js';
import { verifyCheckoutPrice } from '../../api/_lib/checkout-price.js';

// Free is an entitlement, never a Stripe subscription. Preserve paid access and legacy prices.
const paidTiers = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
function db(row) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: row, error: null }) };
            },
          };
        },
      };
    },
  };
}
function row(tier, billing_state, payload = {}) {
  return { tier, billing_state, payload };
}
function trial(active) {
  const now = Date.now();
  const start = now - (active ? 1 : 15) * 86400000;
  return {
    trial: {
      startedAt: new Date(start).toISOString(),
      endsAt: new Date(start + 14 * 86400000).toISOString(),
      plan: 'Professional',
    },
  };
}
test('Free is an explicit zero-price entitlement with configurable finite capacities', () => {
  const plan = subscriptionPlans.Free;
  assert.ok(plan, 'An explicit Free plan must exist; Starter must remain a paid plan');
  assert.equal(plan.monthlyRate, 0);
  assert.equal(plan.annualRate, 0);
  for (const key of Object.keys(subscriptionPlans.Starter.limits)) {
    assert.ok(Number.isFinite(plan.limits[key]), key);
    assert.ok(plan.limits[key] >= 0, key);
    assert.ok(plan.limits[key] <= subscriptionPlans.Starter.limits[key], key);
  }
  assert.equal(plan.limits.horseLimit, 2);
  assert.equal(plan.limits.seatLimit, 1);
  assert.equal(plan.limits.documentLimit, 10);
  assert.equal(plan.limits.storageLimitGb, 1);
  assert.equal(plan.limits.salePacketLimit, 0);
  assert.equal(plan.limits.sharedAccessSeatLimit, 0);
});
test('Free, not paid Starter, is the unentitled baseline', () => {
  assert.equal(BASELINE_TIER, 'Free');
  for (const state of ['Inactive', 'Past Due', 'unexpected', undefined]) {
    for (const tier of paidTiers) assert.equal(entitledTierForBillingState(tier, state), 'Free');
  }
});
test('active and explicitly comped subscribers keep their exact paid tier', () => {
  for (const state of ['Active', 'Manual Billing']) {
    for (const tier of paidTiers) assert.equal(entitledTierForBillingState(tier, state), tier);
  }
});
test('a workspace without a subscription gets Free from the authoritative API', async () => {
  const result = await getWorkspaceEntitlements(db(null), 'fixture');
  assert.equal(result.ok, true);
  assert.equal(result.effectiveTier, 'Free');
});
test('expired trial returns to Free without deleting the payload or records', async () => {
  const original = row('Starter', 'Inactive', trial(false));
  const before = structuredClone(original);
  const result = await getWorkspaceEntitlements(db(original), 'fixture');
  assert.equal(result.effectiveTier, 'Free');
  assert.deepEqual(original, before);
});
test('active Professional trial survives introducing Free', async () => {
  const result = await getWorkspaceEntitlements(db(row('Starter', 'Inactive', trial(true))), 'fixture');
  assert.equal(result.effectiveTier, 'Professional');
});
test('a leftover trial does not override any active paid subscriber, including Starter', async () => {
  for (const tier of paidTiers) {
    const result = await getWorkspaceEntitlements(db(row(tier, 'Active', trial(true))), 'fixture');
    assert.equal(result.effectiveTier, tier);
  }
});
test('Free is never sold by the Stripe checkout configuration', () => {
  assert.equal(getStripePriceIdByTier('Free', 'monthly'), '');
  assert.equal(getStripePriceIdByTier('Free', 'annual'), '');
  const sold = sellablePrices();
  assert.ok(!sold.monthly.Free);
  assert.ok(!sold.annual.Free);
});
test('Free checkout is refused before touching Stripe even with a configured-looking price ID', async () => {
  const stripe = new Proxy(
    {},
    {
      get() {
        throw new Error('Free must never call Stripe');
      },
    },
  );
  assert.equal(
    await verifyCheckoutPrice(stripe, { tier: 'Free', billingPeriod: 'monthly', priceId: 'price_free' }),
    false,
  );
});
test('legacy paid price mappings continue to grant the original tier', () => {
  const old = process.env.STRIPE_LEGACY_PRICE_IDS;
  try {
    process.env.STRIPE_LEGACY_PRICE_IDS = paidTiers.map((tier, i) => `price_grandfather${i}=${tier}:monthly`).join(',');
    for (const [i, tier] of paidTiers.entries()) assert.equal(findTierByPriceId(`price_grandfather${i}`), tier);
  } finally {
    if (old === undefined) delete process.env.STRIPE_LEGACY_PRICE_IDS;
    else process.env.STRIPE_LEGACY_PRICE_IDS = old;
  }
});
test('active paid profiles preserve every currently purchased limit', () => {
  for (const tier of paidTiers) {
    const profile = buildSubscriptionProfile({ tier, billingStatus: 'active' });
    assert.equal(profile.tier, tier);
    for (const [key, value] of Object.entries(subscriptionPlans[tier].limits)) assert.equal(profile.usage[key], value);
  }
});

test('public monthly prices are 0/20/49.99 and retired tiers retain legacy reference rates without repricing historical subscribers', () => {
  assert.deepEqual(
    Object.values(subscriptionPlans).map((p) => p.monthlyRate),
    [0, 12, 20, 49.99, 199],
  );
});
test('Starter historical monthly price survives with authenticated Stripe amount or stored amount', () => {
  const stored = { tier: 'Starter', monthly_rate: 12, payload: { monthlyRate: 12, annualRate: 120 } };
  const historical = { currency: 'usd', unit_amount: 1200, recurring: { interval: 'month', interval_count: 1 } };
  assert.equal(
    buildSubscriptionProfile({ tier: 'Starter', billingStatus: 'active', billedPrice: historical }).monthlyRate,
    12,
  );
  assert.equal(
    buildSubscriptionProfile({ tier: 'Starter', billingStatus: 'canceled', existingProfile: stored }).monthlyRate,
    12,
  );
  assert.equal(buildSubscriptionProfile({ tier: 'Starter', billingStatus: 'active' }).monthlyRate, 12);
});
test('authenticated annual amount and legacy annual mapping survive disabled new annual selling', () => {
  const old = process.env.STRIPE_PRICE_ID_STARTER_ANNUAL;
  try {
    process.env.STRIPE_PRICE_ID_STARTER_ANNUAL = 'price_historical_annual';
    assert.equal(findTierByPriceId('price_historical_annual'), 'Starter');
    assert.equal(getStripePriceIdByTier('Starter', 'annual'), 'price_historical_annual');
    assert.equal(sellablePrices().annual.Starter, false);
    const profile = buildSubscriptionProfile({
      tier: 'Starter',
      billingStatus: 'active',
      priceId: 'price_historical_annual',
      billedPrice: { currency: 'usd', unit_amount: 12000, recurring: { interval: 'year', interval_count: 1 } },
    });
    assert.equal(profile.billingPeriod, 'annual');
    assert.equal(profile.annualRate, 120);
  } finally {
    if (old === undefined) delete process.env.STRIPE_PRICE_ID_STARTER_ANNUAL;
    else process.env.STRIPE_PRICE_ID_STARTER_ANNUAL = old;
  }
});

test('historical Professional, Ranch Ops and Enterprise rates survive public repricing', () => {
  for (const [tier, monthly, annual] of [
    ['Professional', 29, 290],
    ['Ranch Ops', 79, 790],
    ['Enterprise', 199, 1990],
  ]) {
    const stored = { tier, monthly_rate: monthly, payload: { monthlyRate: monthly, annualRate: annual } };
    const profile = buildSubscriptionProfile({ tier, billingStatus: 'active', existingProfile: stored });
    assert.equal(profile.monthlyRate, monthly);
    assert.equal(profile.annualRate, annual);
    assert.equal(profile.tier, tier);
    assert.equal(
      buildSubscriptionProfile({
        tier,
        billingStatus: 'active',
        billedPrice: {
          currency: 'usd',
          unit_amount: monthly * 100,
          recurring: { interval: 'month', interval_count: 1 },
        },
      }).monthlyRate,
      monthly,
    );
  }
});
