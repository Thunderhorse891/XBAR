import assert from 'node:assert/strict';
import test from 'node:test';

import { getWorkspaceEntitlements } from '../../api/_lib/entitlements.js';
import { TRIAL_LENGTH_MS } from '../../api/_lib/trial-status.js';
import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';

/*
 * Server-side entitlement honors an active trial.
 *
 * The client gates read the profile, but the API is the security boundary —
 * a direct caller must get Professional limits during the trial and the
 * baseline the moment it lapses, with the server's clock deciding.
 */

const NOW_MS = Date.parse('2026-09-24T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function trialPayload(startedAtMs, endsAtMs) {
  return {
    trial: {
      startedAt: new Date(startedAtMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
      plan: 'Professional',
    },
  };
}

function activeTrialPayload() {
  return trialPayload(NOW_MS, NOW_MS + TRIAL_LENGTH_MS);
}

function fakeSupabase(row) {
  return {
    from(table) {
      assert.equal(table, 'workspace_subscription_profiles');
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: () => Promise.resolve({ data: row, error: null }),
              };
            },
          };
        },
      };
    },
  };
}

const realDateNow = Date.now;

test.beforeEach(() => {
  Date.now = () => NOW_MS;
});

test.afterEach(() => {
  Date.now = realDateNow;
});

test('an active trial entitles Professional limits on the server', async () => {
  const supabase = fakeSupabase({
    tier: 'Starter',
    billing_state: 'Inactive',
    payload: activeTrialPayload(),
  });
  const result = await getWorkspaceEntitlements(supabase, 'ws-1', 'rancher@example.com');

  assert.equal(result.ok, true);
  assert.equal(result.effectiveTier, 'Professional');
  assert.deepEqual(result.limits, subscriptionPlans.Professional.limits);
  assert.equal(result.trial.status, 'active');
});

test('an expired trial falls back to the baseline', async () => {
  const supabase = fakeSupabase({
    tier: 'Starter',
    billing_state: 'Inactive',
    payload: trialPayload(NOW_MS - 30 * DAY_MS, NOW_MS - 16 * DAY_MS),
  });
  const result = await getWorkspaceEntitlements(supabase, 'ws-1', 'rancher@example.com');

  assert.equal(result.ok, true);
  assert.equal(result.effectiveTier, 'Starter');
  assert.deepEqual(result.limits, subscriptionPlans.Starter.limits);
  assert.equal(result.trial.status, 'expired');
});

test('a trial never overrides a paid subscription', async () => {
  const supabase = fakeSupabase({
    tier: 'Ranch Ops',
    billing_state: 'Active',
    payload: activeTrialPayload(),
  });
  const result = await getWorkspaceEntitlements(supabase, 'ws-1', 'rancher@example.com');

  assert.equal(result.ok, true);
  assert.equal(result.effectiveTier, 'Ranch Ops');
});

test('a workspace with no trial record is unaffected', async () => {
  const supabase = fakeSupabase({ tier: 'Starter', billing_state: 'Inactive', payload: {} });
  const result = await getWorkspaceEntitlements(supabase, 'ws-1', 'rancher@example.com');

  assert.equal(result.ok, true);
  assert.equal(result.effectiveTier, 'Starter');
  assert.equal(result.trial.status, 'none');
});

test('a malformed trial record grants nothing', async () => {
  const supabase = fakeSupabase({
    tier: 'Starter',
    billing_state: 'Inactive',
    payload: { trial: { startedAt: 'garbage', endsAt: 'worse', plan: 'Professional' } },
  });
  const result = await getWorkspaceEntitlements(supabase, 'ws-1', 'rancher@example.com');

  assert.equal(result.ok, true);
  assert.equal(result.effectiveTier, 'Starter');
});
