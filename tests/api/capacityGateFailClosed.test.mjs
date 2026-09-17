import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkDocumentCapacity,
  checkHorseCapacity,
  checkSalePacketCapacity,
  checkSeatCapacity,
  checkStorageCapacity,
  getWorkspaceEntitlements,
} from '../../api/_lib/entitlements.js';
import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';
import { BASELINE_TIER } from '../../api/_lib/subscription-status.js';

/*
 * Every paid tier is sold on its limits, and these gates are the only thing
 * enforcing them server-side. Each one used to discard the error from its usage
 * query:
 *
 *     const { count } = await supabase.from('horses')...
 *     const used = Number(count || 0);
 *
 * On a failed read `count` is null, `used` collapses to 0, and the limit stops
 * applying — while the request returns a clean pass. A transient database error
 * therefore removed the enforcement behind every tier at once, with nothing in
 * the response to show it.
 *
 * These tests assert the gates refuse when usage is unknown, and that they say
 * so in retryable language rather than telling the customer to upgrade —
 * nothing at that point establishes the customer is over any limit.
 */

const limits = subscriptionPlans.Starter.limits;
const dbError = { message: 'permission denied for function' };

// Chainable thenable: every builder method returns itself, awaiting it yields
// the error result. Matches how the helpers use the query builder
// (.from().select().eq()... then await) without pinning the exact call chain.
function failingQuery() {
  const query = {
    from: () => query,
    select: () => query,
    eq: () => query,
    neq: () => query,
    // getWorkspaceEntitlements terminates with .maybeSingle(); the capacity
    // gates await the builder directly. Supporting both keeps one mock.
    maybeSingle: () => Promise.resolve({ data: null, error: dbError }),
    then: (resolve) => resolve({ count: null, data: null, error: dbError }),
  };
  return query;
}

function failingSupabase() {
  return {
    from: () => failingQuery(),
    rpc: () => Promise.resolve({ data: null, error: dbError }),
  };
}

const gates = [
  ['document capacity', (supabase) => checkDocumentCapacity(supabase, 'ws-1', 1, limits)],
  ['horse capacity', (supabase) => checkHorseCapacity(supabase, 'ws-1', 1, limits)],
  ['team seat capacity', (supabase) => checkSeatCapacity(supabase, 'ws-1', 1, limits)],
  ['sale packet capacity', (supabase) => checkSalePacketCapacity(supabase, 'ws-1', 1, limits)],
  ['storage capacity', (supabase) => checkStorageCapacity(supabase, 'ws-1', 1, limits)],
];

for (const [name, run] of gates) {
  test(`${name} refuses when current usage cannot be read`, async () => {
    const result = await run(failingSupabase());

    assert.equal(result.ok, false, `${name} passed an action it could not verify against the plan limit`);
    assert.match(result.message, /could not be verified/);

    // The customer must be told to retry, not to upgrade: nothing here
    // establishes that they are actually over their limit.
    assert.doesNotMatch(result.message, /Upgrade to continue/);
    assert.equal(result.retryable, true);
    assert.equal(result.status, 503, 'a failed lookup is a service problem, not a 403 billing refusal');
  });
}

test('the pending-invitation half of the seat gate fails closed on its own', async () => {
  // Seats in use are active members plus pending invites. The membership query
  // succeeding does not make the total known, so the gate must still refuse.
  const supabase = {
    from: (table) => {
      if (table === 'workspace_memberships') {
        const ok = {
          select: () => ok,
          eq: () => ok,
          neq: () => ok,
          then: (resolve) => resolve({ count: 0, error: null }),
        };
        return ok;
      }
      return failingQuery();
    },
  };

  const result = await checkSeatCapacity(supabase, 'ws-1', 1, limits);
  assert.equal(result.ok, false);
  assert.match(result.message, /pending invitation count could not be verified/);
});

test('a healthy gate still enforces the limit it is given', async () => {
  // Guards the fix itself: refusing on error is only correct if the success
  // path is untouched, otherwise these tests would pass against a gate that
  // refuses everything.
  const healthy = { rpc: () => Promise.resolve({ data: 0, error: null }) };

  const allowed = await checkStorageCapacity(healthy, 'ws-1', 1, limits);
  assert.deepEqual(allowed, { ok: true, usedBytes: 0 });

  const overLimit = await checkStorageCapacity(healthy, 'ws-1', (limits.storageLimitGb + 1) * 1024 ** 3, limits);
  assert.equal(overLimit.ok, false);
  assert.match(overLimit.message, /Upgrade to continue/);
  assert.notEqual(overLimit.status, 503, 'a genuine limit breach is not a service outage');
});

/*
 * The entitlement lookup itself is the gate before the gates: if it cannot read
 * the workspace's plan, every limit downstream is computed from a guess.
 */

test('the entitlement lookup refuses when the profile query fails', async () => {
  const result = await getWorkspaceEntitlements(failingSupabase(), 'ws-1', '');

  assert.equal(result.ok, false, 'a failed profile read must not be reported as a plan');
  assert.equal(result.status, 503);
  assert.equal(result.retryable, true);
  assert.match(result.message, /Cloud services are unavailable/);
  assert.doesNotMatch(result.message, /Upgrade/);
  assert.equal(result.limits, undefined, 'no limits may be handed out from a failed lookup');
});

function profileSupabase(row) {
  const query = {
    from: () => query,
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  };
  return query;
}

test('a workspace with no subscription row resolves to the safe baseline', async () => {
  const result = await getWorkspaceEntitlements(profileSupabase(null), 'ws-1', '');

  assert.equal(result.ok, true);
  assert.equal(result.tier, BASELINE_TIER);
  assert.equal(result.effectiveTier, BASELINE_TIER);
  assert.equal(result.billingState, 'Inactive', 'a missing row is not manual billing');
  assert.deepEqual(result.limits, subscriptionPlans[BASELINE_TIER].limits);
});

test('a canceled workspace loses its paid limits', async () => {
  const result = await getWorkspaceEntitlements(
    profileSupabase({ tier: 'Enterprise', billing_state: 'Inactive' }),
    'ws-1',
    '',
  );

  assert.equal(result.ok, true);
  assert.equal(result.tier, 'Enterprise', 'the purchased tier is still reported for display');
  assert.equal(result.effectiveTier, BASELINE_TIER, 'but it grants nothing');
  assert.deepEqual(result.limits, subscriptionPlans[BASELINE_TIER].limits);
});

test('a garbage billing_state value grants nothing', async () => {
  const result = await getWorkspaceEntitlements(
    profileSupabase({ tier: 'Enterprise', billing_state: 'whatever' }),
    'ws-1',
    '',
  );

  assert.equal(result.billingState, 'Inactive');
  assert.equal(result.effectiveTier, BASELINE_TIER);
});

test('a garbage tier value resolves to baseline and is reported as unrecognized', async () => {
  const result = await getWorkspaceEntitlements(
    profileSupabase({ tier: 'Platinum Deluxe', billing_state: 'Active' }),
    'ws-1',
    '',
  );

  assert.equal(result.tierRecognized, false);
  assert.equal(result.tier, BASELINE_TIER);
  assert.equal(result.effectiveTier, BASELINE_TIER);
});

test('an explicitly manual-billed workspace keeps its tier', async () => {
  const result = await getWorkspaceEntitlements(
    profileSupabase({ tier: 'Ranch Ops', billing_state: 'Manual Billing' }),
    'ws-1',
    '',
  );

  assert.equal(result.effectiveTier, 'Ranch Ops');
  assert.deepEqual(result.limits, subscriptionPlans['Ranch Ops'].limits);
});
