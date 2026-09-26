import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRIAL_LENGTH_DAYS,
  TRIAL_PLAN_TIER,
  applyTrialToProfile,
  getTrialState,
  parseTrialStart,
  trialDaysRemaining,
  trialEndDate,
  trialStatusCopy,
} from '../src/lib/trialSubscription.js';
import { subscriptionTierConfig } from '../src/lib/xbarRuntime.js';
import type { SubscriptionProfile } from '../src/types/xbar.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function profile(overrides: Partial<SubscriptionProfile> = {}): SubscriptionProfile {
  return {
    tier: 'Starter',
    monthlyRate: 0,
    renewalDate: '',
    billingState: 'Inactive',
    sharedAccessEnabled: false,
    featureFlags: ['seed'],
    usage: {
      horsesUsed: 0,
      horseLimit: 5,
      seatsUsed: 0,
      seatLimit: 1,
      documentsProcessed: 0,
      documentLimit: 250,
      salePacketsGenerated: 0,
      salePacketLimit: 2,
      storageUsedGb: 0,
      storageLimitGb: 25,
      sharedAccessSeatsUsed: 0,
      sharedAccessSeatLimit: 0,
    },
    ...overrides,
  };
}

const NOW = new Date('2026-09-24T12:00:00.000Z');
const iso = (date: Date) => date.toISOString();

test('the trial grants the Professional plan for exactly 14 days', () => {
  assert.equal(TRIAL_PLAN_TIER, 'Professional');
  assert.equal(TRIAL_LENGTH_DAYS, 14);
});

test('parseTrialStart rejects garbage without throwing', () => {
  assert.equal(parseTrialStart(undefined), null);
  assert.equal(parseTrialStart(''), null);
  assert.equal(parseTrialStart('not-a-date'), null);
  assert.equal(parseTrialStart(12345), null);
  assert.ok(parseTrialStart(iso(NOW)) instanceof Date);
});

test('a fresh trial is active and lasts the full window', () => {
  const start = iso(NOW);
  assert.equal(getTrialState(start, NOW), 'active');
  assert.equal(getTrialState(start, new Date(NOW.getTime() + 13 * DAY_MS)), 'active');
  assert.equal(trialDaysRemaining(start, NOW), 14);
  assert.equal(trialDaysRemaining(start, new Date(NOW.getTime() + 13.5 * DAY_MS)), 1);
});

test('the trial lapses the instant the window passes', () => {
  const start = iso(NOW);
  const end = trialEndDate(new Date(start));
  assert.equal(getTrialState(start, new Date(end.getTime() - 1)), 'active');
  assert.equal(getTrialState(start, end), 'expired');
  assert.equal(getTrialState(start, new Date(end.getTime() + DAY_MS)), 'expired');
  assert.equal(trialDaysRemaining(start, end), 0);
});

test('no trialStart means no trial', () => {
  assert.equal(getTrialState(undefined, NOW), 'none');
  assert.equal(getTrialState('garbage', NOW), 'none');
  assert.equal(trialDaysRemaining(undefined, NOW), 0);
});

test('a future-dated trial start is not active yet', () => {
  const future = iso(new Date(NOW.getTime() + DAY_MS));
  assert.equal(getTrialState(future, NOW), 'none');
});

test('an active trial grants Professional entitlements', () => {
  const before = profile({ trialStart: iso(NOW) });
  const after = applyTrialToProfile(before, NOW);
  const professional = subscriptionTierConfig.Professional;

  assert.equal(after.tier, 'Professional');
  assert.equal(after.sharedAccessEnabled, professional.sharedAccessEnabled);
  assert.deepEqual(after.featureFlags, professional.featureFlags);
  assert.equal(after.usage.horseLimit, professional.limits.horseLimit);
  assert.equal(after.usage.seatLimit, professional.limits.seatLimit);
  assert.equal(after.usage.documentLimit, professional.limits.documentLimit);
  assert.equal(after.usage.salePacketLimit, professional.limits.salePacketLimit);
  assert.equal(after.usage.storageLimitGb, professional.limits.storageLimitGb);
  assert.equal(after.usage.sharedAccessSeatLimit, professional.limits.sharedAccessSeatLimit);

  // Usage COUNTS survive — only the limits move.
  const withUsage = profile({ trialStart: iso(NOW), usage: { ...profile().usage, horsesUsed: 23 } });
  assert.equal(applyTrialToProfile(withUsage, NOW).usage.horsesUsed, 23);
});

test('a trial is not a purchase: billing fields survive untouched', () => {
  const before = profile({
    trialStart: iso(NOW),
    purchasedTier: 'Starter',
    monthlyRate: 0,
    billingState: 'Inactive',
  });
  const after = applyTrialToProfile(before, NOW);
  assert.equal(after.purchasedTier, 'Starter');
  assert.equal(after.monthlyRate, 0);
  assert.equal(after.billingState, 'Inactive');
  assert.equal(after.trialStart, iso(NOW));
});

test('an expired trial drops back to the baseline profile', () => {
  const start = iso(new Date(NOW.getTime() - 15 * DAY_MS));
  const before = profile({ trialStart: start });
  const after = applyTrialToProfile(before, NOW);
  assert.equal(after.tier, 'Starter');
  assert.equal(after.usage.horseLimit, 5);
  // The marker stays: an expired trial cannot be restarted.
  assert.equal(after.trialStart, start);
});

test('a trial never downgrades a workspace the billing state already entitles', () => {
  const entitled = profile({
    trialStart: iso(NOW),
    tier: 'Ranch Ops',
    billingState: 'Active',
    monthlyRate: 79,
  });
  const after = applyTrialToProfile(entitled, NOW);
  assert.equal(after.tier, 'Ranch Ops');

  const comped = profile({
    trialStart: iso(NOW),
    tier: 'Enterprise',
    billingState: 'Manual Billing',
    monthlyRate: 199,
  });
  assert.equal(applyTrialToProfile(comped, NOW).tier, 'Enterprise');
});

test('trial copy is professional and states the terms plainly', () => {
  const active = trialStatusCopy('active', 9);
  assert.match(active.message, /ends in 9 days/);
  assert.match(active.message, /Choose a plan/);

  const oneDay = trialStatusCopy('active', 1);
  assert.match(oneDay.message, /ends in 1 day\./);

  const expired = trialStatusCopy('expired', 0);
  assert.match(expired.message, /trial has ended/);
  assert.match(expired.message, /Choose a plan/);

  const none = trialStatusCopy('none', 0);
  assert.match(none.message, /14 days/);
  assert.match(none.message, /No card required/);
});
