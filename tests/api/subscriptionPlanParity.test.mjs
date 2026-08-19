import assert from 'node:assert/strict';
import test from 'node:test';
import { subscriptionPlans as serverPlans } from '../../api/_lib/subscription-plans.js';
import { marketingPlans } from '../../scripts/marketing/pricing-data.mjs';

// The tier definitions exist in three places, and none of them can import
// another directly:
//
//   src/lib/xbarRuntime.ts        drives the app          (bundler TS graph)
//   scripts/marketing/pricing-data.mjs  drives /pricing   (plain ESM)
//   api/_lib/subscription-plans.js      drives enforcement (functions runtime)
//
// tests/marketingSite.test.ts already asserts marketing === client, from inside
// the compiled TS suite where the client config is importable. This file closes
// the remaining side — server === marketing — from the plain-ESM suite where the
// server module is importable. Together the two pin all three to one set of
// numbers.
//
// The server side is the one that had no guard, and it is the one that matters
// most: if its limits drift, the app enforces something different from what it
// sold, and the first sign is a customer hitting a wall the UI never showed.
//
// The server used to carry a `brandedListings` flag with no client counterpart.
// It was removed rather than asserted: every capability it could have gated is
// already gated elsewhere — listings by sharedAccessEnabled, packet export by
// the Professional minimum in commercialEngine, and the branded asset pack by
// its own template minimumPlan — so it was an entitlement the product implied
// and never enforced.

const ASCENDING_TIERS = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
const LIMIT_KEYS = ['horseLimit', 'seatLimit', 'documentLimit', 'salePacketLimit', 'storageLimitGb'];

test('the server defines exactly the published tiers, in the same order', () => {
  // Order matters: the client's planOrder and the server's TIER_ORDER both rely
  // on it to decide whether a tier includes a lower plan's features.
  assert.deepEqual(Object.keys(serverPlans), ASCENDING_TIERS);
  assert.deepEqual(
    marketingPlans.map((plan) => plan.tier),
    ASCENDING_TIERS,
  );
});

test('every tier charges the price it is sold at', () => {
  for (const plan of marketingPlans) {
    assert.equal(serverPlans[plan.tier].monthlyRate, plan.monthlyRate, `${plan.tier} monthlyRate drifted`);
  }
});

test('every enforced limit matches the limit that was published', () => {
  for (const plan of marketingPlans) {
    assert.deepEqual(
      serverPlans[plan.tier].limits,
      plan.limits,
      `${plan.tier} limits drifted — the server would enforce something /pricing never showed`,
    );
  }
});

test('the feature list a customer is shown is the same on both sides', () => {
  // The server persists these strings onto the workspace subscription profile,
  // so a divergent copy means a synced workspace and a local one describe the
  // same paid tier differently.
  for (const plan of marketingPlans) {
    assert.deepEqual(serverPlans[plan.tier].featureFlags, plan.features, `${plan.tier} feature copy drifted`);
  }
});

test('shared access is enabled from Professional up', () => {
  assert.equal(serverPlans.Starter.sharedAccessEnabled, false, 'Starter must not grant shared access');
  for (const tier of ['Professional', 'Ranch Ops', 'Enterprise']) {
    assert.equal(serverPlans[tier].sharedAccessEnabled, true, `${tier} must grant shared access`);
  }
  // Buyers never consume a seat — they open a share link with no account — so
  // sharedAccessEnabled is the whole tier boundary here, and there is no buyer
  // capacity number to keep in sync. /pricing publishes the same boundary as a
  // yes/no, so pin the two together.
  for (const plan of marketingPlans) {
    assert.equal(
      serverPlans[plan.tier].sharedAccessEnabled,
      plan.sharedAccess,
      `${plan.tier} buyer sharing drifted between /pricing and the server`,
    );
  }
});

test('every tier publishes a complete, usable set of limits', () => {
  // Guards a tier being added with a limit omitted: it would read as undefined
  // and compare falsely in every capacity check, silently granting nothing.
  for (const tier of ASCENDING_TIERS) {
    for (const key of LIMIT_KEYS) {
      const value = serverPlans[tier].limits[key];
      assert.equal(typeof value, 'number', `${tier} is missing ${key}`);
      assert.ok(Number.isFinite(value) && value >= 0, `${tier} ${key} must be a non-negative number`);
    }
    // Every paid tier must be able to hold at least one horse and one seat, or
    // the plan cannot be used at all.
    assert.ok(serverPlans[tier].limits.horseLimit > 0, `${tier} grants no horses`);
    assert.ok(serverPlans[tier].limits.seatLimit > 0, `${tier} grants no seats`);
  }
});

test('paying more never grants less', () => {
  // A higher tier that grants less than a lower one is always a mistake, and it
  // would take capacity away from the customer who just upgraded.
  for (let index = 1; index < ASCENDING_TIERS.length; index += 1) {
    const lowerTier = ASCENDING_TIERS[index - 1];
    const higherTier = ASCENDING_TIERS[index];
    const lower = serverPlans[lowerTier];
    const higher = serverPlans[higherTier];

    assert.ok(higher.monthlyRate > lower.monthlyRate, `${higherTier} must cost more than ${lowerTier}`);

    for (const key of LIMIT_KEYS) {
      assert.ok(
        higher.limits[key] >= lower.limits[key],
        `${higherTier} grants less ${key} (${higher.limits[key]}) than ${lowerTier} (${lower.limits[key]})`,
      );
    }
  }
});
