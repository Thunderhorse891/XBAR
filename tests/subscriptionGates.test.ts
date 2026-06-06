import assert from 'node:assert/strict';
import test from 'node:test';
import { documentIntakeGate, sharedListingGate } from '../src/lib/subscriptionGates.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';
import type { SubscriptionProfile, SubscriptionTier } from '../src/types/xbar.js';

function subscription(tier: SubscriptionTier): SubscriptionProfile {
  const config = subscriptionPlans[tier];
  return { tier, monthlyRate: config.monthlyRate, renewalDate: '', billingState: 'Active', sharedAccessEnabled: config.sharedAccessEnabled, brandedListings: config.brandedListings, featureFlags: config.featureFlags, usage: { seatsUsed: 1, sharedAccessSeatsUsed: 0, storageUsedGb: 0, ...config.limits } };
}

test('Starter cannot create sale listings while Professional can', () => {
  assert.match(sharedListingGate(subscription('Starter')) ?? '', /Professional/);
  assert.equal(sharedListingGate(subscription('Professional')), null);
});

test('document intake blocks a batch that exceeds the current plan count', () => {
  assert.match(documentIntakeGate(subscription('Starter'), 249, 2) ?? '', /250 document limit/);
  assert.equal(documentIntakeGate(subscription('Starter'), 249, 1), null);
});

test('Enterprise promises only concrete deliverables', () => {
  const features = subscriptionPlans.Enterprise.featureFlags.join(' ');
  assert.doesNotMatch(features, /Custom integrations|Priority support|Unlimited users/);
  assert.match(features, /Dedicated onboarding/);
  assert.match(features, /Workspace audit log/);
});
