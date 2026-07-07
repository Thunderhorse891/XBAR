import assert from 'node:assert/strict';
import test from 'node:test';
import { documentIntakeGate, sharedListingGate } from '../src/lib/subscriptionGates.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';
import type { SubscriptionProfile, SubscriptionTier } from '../src/types/xbar.js';

function subscription(tier: SubscriptionTier): SubscriptionProfile {
  const config = subscriptionPlans[tier];
  return {
    tier,
    monthlyRate: config.monthlyRate,
    renewalDate: '',
    billingState: 'Active',
    sharedAccessEnabled: config.sharedAccessEnabled,
    featureFlags: config.featureFlags,
    usage: {
      horsesUsed: 0,
      seatsUsed: 1,
      documentsProcessed: 0,
      salePacketsGenerated: 0,
      sharedAccessSeatsUsed: 0,
      storageUsedGb: 0,
      ...config.limits,
    },
  };
}

test('Starter cannot create sale listings while Professional can', () => {
  assert.match(sharedListingGate(subscription('Starter')) ?? '', /Professional/);
  assert.equal(sharedListingGate(subscription('Professional')), null);
});

test('document intake blocks a batch that exceeds the current plan count', () => {
  assert.match(documentIntakeGate(subscription('Starter'), 249, 2) ?? '', /250 document limit/);
  assert.equal(documentIntakeGate(subscription('Starter'), 249, 1), null);
});

test('Enterprise promises only concrete enforced capacity', () => {
  const features = subscriptionPlans.Enterprise.featureFlags.join(' ');
  assert.doesNotMatch(
    features,
    /Custom integrations|Priority support|Unlimited users|audit log|white-label|onboarding/i,
  );
  assert.match(features, /60 team seats/);
  assert.match(features, /20,000 documents/);
  assert.match(features, /200 buyer seats/);
});

test('applying a tier upgrades limits and features while preserving usage counts', async () => {
  const { buildSubscriptionForTier } = await import('../src/lib/xbarRuntime.js');
  const starter = subscription('Starter');
  starter.monthlyRate = 0;
  starter.usage.horsesUsed = 4;
  starter.usage.documentsProcessed = 200;

  const upgraded = buildSubscriptionForTier(starter, 'Professional', { billingState: 'Manual Billing' });
  assert.equal(upgraded.tier, 'Professional');
  assert.equal(upgraded.monthlyRate, subscriptionPlans.Professional.monthlyRate);
  assert.equal(upgraded.billingState, 'Manual Billing');
  assert.equal(upgraded.sharedAccessEnabled, true);
  assert.equal(upgraded.usage.horseLimit, subscriptionPlans.Professional.limits.horseLimit);
  assert.equal(upgraded.usage.documentLimit, subscriptionPlans.Professional.limits.documentLimit);
  assert.equal(upgraded.usage.seatLimit, subscriptionPlans.Professional.limits.seatLimit);
  assert.equal(upgraded.usage.sharedAccessSeatLimit, subscriptionPlans.Professional.limits.sharedAccessSeatLimit);
  // Usage counters carry over untouched.
  assert.equal(upgraded.usage.horsesUsed, 4);
  assert.equal(upgraded.usage.documentsProcessed, 200);
  // An upgrade unlocks gates that blocked the lower tier.
  assert.equal(sharedListingGate(upgraded), null);
  assert.equal(documentIntakeGate(upgraded, 200, 300), null);
});
