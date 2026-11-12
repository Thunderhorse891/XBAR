import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineCloudSubscription, subscriptionFromCloudRow } from '../src/lib/cloudSubscription.js';
import { canUseOcr, featureGate } from '../src/lib/commercialEngine.js';
import { applyTrialToProfile, canStartTrial } from '../src/lib/trialSubscription.js';
import { recommendedTier, hasActivePaidPlan, clampSubscriptionToEntitlement } from '../src/lib/subscriptionDecision.js';
import { getStripePaymentLink, stripeConfig } from '../src/lib/platformConfig.js';
import { startManagedCheckout } from '../src/lib/billingApi.js';
import { subscriptionTierConfig, buildDocumentRecord } from '../src/lib/xbarRuntime.js';

test('Free is a distinct card-free baseline with conservative review limits', () => {
  const free = baselineCloudSubscription();
  assert.equal(free.tier, 'Free');
  assert.equal(hasActivePaidPlan(free), false);
  assert.deepEqual(subscriptionTierConfig.Free.limits, {
    horseLimit: 2,
    seatLimit: 1,
    documentLimit: 10,
    salePacketLimit: 0,
    storageLimitGb: 1,
    sharedAccessSeatLimit: 0,
  });
  assert.equal(canUseOcr(free), false);
  assert.ok(featureGate(free, 'packetExport'));
  assert.equal(recommendedTier('Free'), 'Professional');
  assert.equal(subscriptionTierConfig.Starter.monthlyRate, 12);
  assert.equal(canStartTrial(free, { nativeApp: false, canManageBilling: true }), true);
});

test('paid and manually granted Starter never become a trial or Free', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  for (const billing_state of ['Active', 'Manual Billing']) {
    const paid = subscriptionFromCloudRow({
      tier: 'Starter',
      billing_state,
      monthly_rate: 12,
      billing_period: 'annual',
      payload: { annualRate: 120 },
    })!;
    assert.equal(paid.tier, 'Starter');
    assert.equal(canUseOcr(paid), true);
    assert.equal(applyTrialToProfile({ ...paid, trialStart: '2026-11-11T12:00:00Z' }, now).tier, 'Starter');
    assert.equal(paid.monthlyRate, 12);
    assert.equal(paid.annualRate, 120);
    assert.equal(paid.billingPeriod, 'annual');
    assert.equal(canStartTrial(paid, { nativeApp: false, canManageBilling: true }), false);
  }
});

test('all new annual and Free checkout paths stop before network', async () => {
  stripeConfig.annualPaymentLinks.Starter = 'https://example.com/legacy-annual';
  assert.equal(getStripePaymentLink('Starter', 'annual'), '');
  assert.equal(getStripePaymentLink('Free'), '');
  assert.equal((await startManagedCheckout({ tier: 'Free', workspaceId: 'w', accessToken: 't' })).ok, false);
  assert.equal(
    (await startManagedCheckout({ tier: 'Starter', billingPeriod: 'annual', workspaceId: 'w', accessToken: 't' })).ok,
    false,
  );
});

test('stale Free limits cannot retain Enterprise capabilities', () => {
  const free = baselineCloudSubscription();
  const clamped = clampSubscriptionToEntitlement({
    ...free,
    billingState: 'Manual Billing',
    sharedAccessEnabled: true,
    usage: { ...free.usage, horseLimit: 2000 },
  });
  assert.equal(clamped.usage.horseLimit, 2);
  assert.equal(clamped.sharedAccessEnabled, false);
});

test('manual Free upload does not extract text or infer a horse assignment', async () => {
  const file = new File(['Horse Name: SECRET HORSE\nRegistration Number: 1234567'], 'record.txt', {
    type: 'text/plain',
  });
  const result = await buildDocumentRecord({
    file,
    uploadedBy: 'owner',
    source: 'Manual Upload',
    horses: [],
    existingDocuments: [],
    allowOcr: false,
  });
  assert.equal(result.extractedTextPreview, '');
  assert.deepEqual(result.entities, {});
  assert.equal(result.horseId, undefined);
  assert.match(result.processingNote ?? '', /Manual upload on Free/);
});
