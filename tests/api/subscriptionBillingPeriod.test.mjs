import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSubscriptionProfile,
  findBillingPeriodByPriceId,
  findTierByPriceId,
} from '../../api/_lib/subscription-plans.js';

/*
 * An annual buyer used to be stored as `monthlyRate: 29` with no period
 * recorded — indistinguishable from a $29/mo monthly buyer in the profile,
 * the payload, and the database column. The price id is what knows the
 * period: a Stripe Price pins its own billing interval, so the mapping from
 * price id to period is derived from the same STRIPE_PRICE_ID_* env table
 * that already maps price ids to tiers.
 */

const PRICE_IDS = {
  STRIPE_PRICE_ID_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_ID_PROFESSIONAL: 'price_pro_monthly',
  STRIPE_PRICE_ID_RANCH_OPS: 'price_ranchops_monthly',
  STRIPE_PRICE_ID_ENTERPRISE: 'price_ent_monthly',
  STRIPE_PRICE_ID_STARTER_ANNUAL: 'price_starter_annual',
  STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL: 'price_pro_annual',
  STRIPE_PRICE_ID_RANCH_OPS_ANNUAL: 'price_ranchops_annual',
  STRIPE_PRICE_ID_ENTERPRISE_ANNUAL: 'price_ent_annual',
};

for (const [name, value] of Object.entries(PRICE_IDS)) {
  process.env[name] = value;
}

test('a monthly price id resolves to the monthly period', () => {
  assert.equal(findBillingPeriodByPriceId('price_pro_monthly'), 'monthly');
  assert.equal(findBillingPeriodByPriceId('price_ent_monthly'), 'monthly');
});

test('an annual price id resolves to the annual period', () => {
  assert.equal(findBillingPeriodByPriceId('price_pro_annual'), 'annual');
  assert.equal(findBillingPeriodByPriceId('price_starter_annual'), 'annual');
});

test('an unrecognized price id resolves to no period, not a guess', () => {
  // A guess here would write a period the customer was never billed on.
  assert.equal(findBillingPeriodByPriceId('price_unknown'), null);
  assert.equal(findBillingPeriodByPriceId(''), null);
  assert.equal(findBillingPeriodByPriceId(undefined), null);
});

test('price ids match after trimming, like the tier lookup', () => {
  assert.equal(findBillingPeriodByPriceId('  price_pro_annual  '), 'annual');
});

test('the tier lookup still resolves annual price ids to tiers', () => {
  assert.equal(findTierByPriceId('price_pro_annual'), 'Professional');
  assert.equal(findTierByPriceId('price_ent_monthly'), 'Enterprise');
});

test('an annual purchase records the annual period on the profile', () => {
  const profile = buildSubscriptionProfile({
    tier: 'Professional',
    billingStatus: 'active',
    priceId: 'price_pro_annual',
  });

  assert.equal(profile.billingPeriod, 'annual');
  assert.equal(profile.tier, 'Professional');
});

test('a monthly purchase records the monthly period on the profile', () => {
  const profile = buildSubscriptionProfile({
    tier: 'Professional',
    billingStatus: 'active',
    priceId: 'price_pro_monthly',
  });

  assert.equal(profile.billingPeriod, 'monthly');
});

test('monthlyRate stays the monthly list rate and annualRate the annual one', () => {
  // monthlyRate is NOT the amount charged on an annual purchase. Recording the
  // period next to it is what keeps a $290/yr buyer from reading as $29/mo.
  // The amount charged is monthlyRate when billingPeriod is 'monthly' and
  // annualRate when it is 'annual'.
  const annual = buildSubscriptionProfile({
    tier: 'Professional',
    billingStatus: 'active',
    priceId: 'price_pro_annual',
  });
  assert.equal(annual.monthlyRate, 29);
  assert.equal(annual.annualRate, 290);

  const monthly = buildSubscriptionProfile({
    tier: 'Ranch Ops',
    billingStatus: 'active',
    priceId: 'price_ranchops_monthly',
  });
  assert.equal(monthly.monthlyRate, 79);
  assert.equal(monthly.annualRate, 790);
});

test('a profile built without a price id records no period rather than guessing', () => {
  // Legacy callers and rows written before the period was recorded carry no
  // price id; claiming 'monthly' would rewrite history for annual buyers.
  const profile = buildSubscriptionProfile({ tier: 'Professional', billingStatus: 'active' });
  assert.equal(profile.billingPeriod, null);
});

test('an unrecognized price id records no period on the profile', () => {
  const profile = buildSubscriptionProfile({
    tier: 'Professional',
    billingStatus: 'active',
    priceId: 'price_unknown',
  });
  assert.equal(profile.billingPeriod, null);
});
