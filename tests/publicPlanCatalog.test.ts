import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { publicPlanTiers, publicPaidPlanTiers, isPublicPaidPlan } from '../src/lib/publicPlanCatalog.js';
import { subscriptionTierConfig } from '../src/lib/xbarRuntime.js';
import { subscriptionFromCloudRow } from '../src/lib/cloudSubscription.js';
import { recommendedTier } from '../src/lib/subscriptionDecision.js';
import { formatCurrency, formatSubscriptionPrice } from '../src/lib/format.js';
import { startManagedCheckout } from '../src/lib/billingApi.js';
import { getStripePaymentLink, stripeConfig, isBillingConfigured } from '../src/lib/platformConfig.js';

test('exactly three public plans use the approved monthly prices and horse/user limits', () => {
  assert.deepEqual(publicPlanTiers, ['Free', 'Professional', 'Ranch Ops']);
  assert.deepEqual(publicPaidPlanTiers, ['Professional', 'Ranch Ops']);
  assert.deepEqual(
    publicPlanTiers.map((tier) => {
      const plan = subscriptionTierConfig[tier];
      return [tier, plan.monthlyRate, plan.limits.horseLimit, plan.limits.seatLimit];
    }),
    [
      ['Free', 0, 2, 1],
      ['Professional', 20, 30, 5],
      ['Ranch Ops', 49.99, 200, 20],
    ],
  );
});

test('billing shows exact cents without changing unrelated finance rounding', () => {
  assert.equal(formatSubscriptionPrice(49.99), '$49.99');
  assert.equal(formatSubscriptionPrice(20), '$20');
  assert.equal(formatSubscriptionPrice(0), '$0');
  assert.equal(formatCurrency(49.99), '$50');
});

test('legacy subscriber access and recorded monthly/annual rates survive the public catalog change', () => {
  for (const [tier, amount] of [
    ['Starter', 12],
    ['Professional', 29],
    ['Ranch Ops', 79],
    ['Enterprise', 199],
  ] as const) {
    for (const billing_state of ['Active', 'Manual Billing']) {
      const account = subscriptionFromCloudRow({
        tier,
        billing_state,
        monthly_rate: amount,
        billing_period: 'annual',
        payload: { annualRate: amount * 10 },
      })!;
      assert.equal(account.tier, tier);
      assert.equal(account.monthlyRate, amount);
      assert.equal(account.annualRate, amount * 10);
      assert.equal(account.billingPeriod, 'annual');
      assert.equal(account.usage.horseLimit, subscriptionTierConfig[tier].limits.horseLimit);
    }
  }
});

test('Free and retired tiers cannot open new checkout even when legacy payment links exist', async () => {
  for (const tier of ['Free', 'Starter', 'Enterprise'] as const) {
    stripeConfig.paymentLinks[tier] = 'https://example.test/retired-price';
    assert.equal(isPublicPaidPlan(tier), false);
    assert.equal(getStripePaymentLink(tier), '');
    assert.equal((await startManagedCheckout({ tier, workspaceId: 'test', accessToken: 'test' })).ok, false);
  }
  for (const tier of publicPaidPlanTiers) {
    assert.equal(getStripePaymentLink(tier, 'annual'), '');
    assert.equal(
      (await startManagedCheckout({ tier, billingPeriod: 'annual', workspaceId: 'test', accessToken: 'test' })).ok,
      false,
    );
  }
});

test('recommendations never offer retired tiers or paid checkout for Free', () => {
  assert.equal(recommendedTier('Free'), 'Professional');
  assert.equal(recommendedTier('Starter'), 'Professional');
  assert.equal(recommendedTier('Professional'), 'Ranch Ops');
  assert.equal(recommendedTier('Enterprise'), 'Ranch Ops');
  assert.equal(recommendedTier('Free', 'Enterprise'), 'Professional');
  assert.equal(recommendedTier('Free', 'Starter'), 'Professional');
});

test('billing renders only public paid cards while preserving actual legacy account details', async () => {
  const billing = await readFile('src/routes/Subscriptions.tsx', 'utf8');
  assert.match(billing, /const tiers = publicPaidPlanTiers/);
  assert.match(billing, /!isPublicPaidPlan\(subscription.purchasedTier\)/);
  assert.match(billing, /formatSubscriptionPrice\(subscription.monthlyRate\)/);
  assert.match(billing, /formatSubscriptionPrice\(subscription.annualRate\)/);
  assert.doesNotMatch(billing, /formatCurrency\(/);
});

test('no static payment links advertise billing availability', () => {
  const previous = { managed: stripeConfig.managedBillingEnabled, links: { ...stripeConfig.paymentLinks } };
  try {
    stripeConfig.managedBillingEnabled = false;
    stripeConfig.paymentLinks.Professional = '';
    stripeConfig.paymentLinks['Ranch Ops'] = '';
    stripeConfig.paymentLinks.Starter = 'https://example.test/legacy';
    stripeConfig.paymentLinks.Enterprise = 'https://example.test/legacy-enterprise';
    assert.equal(isBillingConfigured(), false);
    stripeConfig.paymentLinks.Professional = 'https://example.test/current';
    assert.equal(isBillingConfigured(), false);
    assert.equal(getStripePaymentLink('Professional'), '');
    stripeConfig.managedBillingEnabled = true;
    assert.equal(isBillingConfigured(), true);
  } finally {
    stripeConfig.managedBillingEnabled = previous.managed;
    Object.assign(stripeConfig.paymentLinks, previous.links);
  }
});

test('paid report copy describes calculation and manual exports without promising scheduled delivery', () => {
  const features = subscriptionTierConfig.Professional.featureFlags.join(' ');
  assert.match(features, /Reports calculated automatically from records; export PDF or CSV manually/);
  assert.doesNotMatch(features, /scheduled|emailed|email delivery/i);
  assert.match(features, /OCR intake and review/);
});

test('old Professional and Ranch Ops static links are never returned for new sales', () => {
  for (const tier of publicPaidPlanTiers) {
    const previous = stripeConfig.paymentLinks[tier];
    try {
      stripeConfig.paymentLinks[tier] = 'https://buy.stripe.com/old-monthly-rate';
      assert.equal(getStripePaymentLink(tier, 'monthly'), '');
      assert.equal(getStripePaymentLink(tier, 'annual'), '');
    } finally {
      stripeConfig.paymentLinks[tier] = previous;
    }
  }
});
