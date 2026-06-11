import assert from 'node:assert/strict';
import test from 'node:test';
import { documentIntakeGate, horseLimitGate, salePacketLimitGate, sharedListingGate } from '../src/lib/subscriptionGates.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';
import { buildUpgradePressure, buildUsageMeters, getPlanCapacity } from '../src/lib/subscriptionUsage.js';
import type { SubscriptionProfile, SubscriptionTier } from '../src/types/xbar.js';

function subscription(tier: SubscriptionTier): SubscriptionProfile {
  const config = subscriptionPlans[tier];
  return { tier, monthlyRate: config.monthlyRate, renewalDate: '', billingState: 'Active', sharedAccessEnabled: config.sharedAccessEnabled, featureFlags: config.featureFlags, usage: { seatsUsed: 1, documentsProcessed: 0, sharedAccessSeatsUsed: 0, storageUsedGb: 0, ...config.limits } };
}

test('Starter cannot create sale listings while Professional can', () => {
  assert.match(sharedListingGate(subscription('Starter')) ?? '', /Professional/);
  assert.equal(sharedListingGate(subscription('Professional')), null);
});

test('document intake blocks a batch that exceeds the current plan count', () => {
  assert.match(documentIntakeGate(subscription('Starter'), 249, 2) ?? '', /250 document limit/);
  assert.equal(documentIntakeGate(subscription('Starter'), 249, 1), null);
});

test('horse and packet limits enforce plan capacity', () => {
  assert.match(horseLimitGate(subscription('Starter'), 25) ?? '', /25 horse limit/);
  assert.equal(horseLimitGate(subscription('Starter'), 24), null);
  assert.match(salePacketLimitGate(subscription('Starter'), 10) ?? '', /10 sale packet limit/);
  assert.equal(salePacketLimitGate(subscription('Starter'), 9), null);
});

test('usage meters create warning and upgrade pressure', () => {
  const profile = subscription('Starter');
  const meters = buildUsageMeters({ subscription: profile, horsesUsed: 23, documentsUsed: 201, salePacketsGenerated: 10 });
  assert.equal(meters.find((meter) => meter.key === 'documents')?.level, 'warning');
  assert.equal(meters.find((meter) => meter.key === 'horses')?.level, 'upgrade');
  assert.equal(meters.find((meter) => meter.key === 'salePackets')?.level, 'hardGate');
  const pressure = buildUpgradePressure(profile, meters);
  assert.equal(pressure.level, 'hardGate');
  assert.match(pressure.message, /Upgrade/);
});

test('plan capacity exposes horse and sale packet limits without changing prices', () => {
  assert.equal(getPlanCapacity('Starter').horseLimit, 25);
  assert.equal(getPlanCapacity('Professional').salePacketLimit, 75);
  assert.equal(subscriptionPlans.Starter.monthlyRate, 29);
  assert.equal(subscriptionPlans.Professional.monthlyRate, 79);
  assert.equal(subscriptionPlans['Ranch Ops'].monthlyRate, 199);
  assert.equal(subscriptionPlans.Enterprise.monthlyRate, 499);
});

test('Enterprise promises only concrete enforced capacity', () => {
  const features = subscriptionPlans.Enterprise.featureFlags.join(' ');
  assert.doesNotMatch(features, /Custom integrations|Priority support|Unlimited users|audit log|white-label|onboarding/i);
  assert.match(features, /60 team seats/);
  assert.match(features, /20,000 document capacity/);
  assert.match(features, /200 shared-access seats/);
});
