import assert from 'node:assert/strict';
import test from 'node:test';

import { checkHorseCapacity, checkSeatCapacity } from '../../api/_lib/entitlements.js';
import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';

/*
 * Server-side horse-limit enforcement. The client-side check is UX only —
 * this capacity gate is what actually stops a direct API caller from
 * exceeding the tier they pay for.
 */

function fakeSupabaseWithCount(count) {
  return {
    from(table) {
      assert.equal(table, 'horses');
      return {
        select(column, options) {
          assert.equal(column, 'horse_id');
          assert.deepEqual(options, { count: 'exact', head: true });
          return {
            eq(field, value) {
              assert.equal(field, 'workspace_id');
              assert.equal(value, 'ws-1');
              return Promise.resolve({ count });
            },
          };
        },
      };
    },
  };
}

const starterLimits = subscriptionPlans.Starter.limits;

test('an import that would exceed the tier horse limit is rejected', async () => {
  const supabase = fakeSupabaseWithCount(starterLimits.horseLimit - 1);
  const result = await checkHorseCapacity(supabase, 'ws-1', 2, starterLimits);
  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`${starterLimits.horseLimit} horse limit`));
  assert.match(result.message, /Upgrade to continue/);
});

test('an import that exactly fills the tier horse limit is allowed', async () => {
  const supabase = fakeSupabaseWithCount(starterLimits.horseLimit - 2);
  const result = await checkHorseCapacity(supabase, 'ws-1', 2, starterLimits);
  assert.deepEqual(result, { ok: true, used: starterLimits.horseLimit - 2 });
});

test('a workspace already at its limit cannot add a single horse', async () => {
  const supabase = fakeSupabaseWithCount(starterLimits.horseLimit);
  const result = await checkHorseCapacity(supabase, 'ws-1', 1, starterLimits);
  assert.equal(result.ok, false);
});

test('a null count (empty workspace) is treated as zero in use', async () => {
  const supabase = fakeSupabaseWithCount(null);
  const result = await checkHorseCapacity(supabase, 'ws-1', starterLimits.horseLimit, starterLimits);
  assert.deepEqual(result, { ok: true, used: 0 });
});

test('every published tier enforces its own horse limit', async () => {
  for (const [tier, plan] of Object.entries(subscriptionPlans)) {
    const supabase = fakeSupabaseWithCount(plan.limits.horseLimit);
    const result = await checkHorseCapacity(supabase, 'ws-1', 1, plan.limits);
    assert.equal(result.ok, false, `${tier} should reject at its limit`);
  }
});

/* Seat capacity: active members plus pending invites count against the tier. */

function fakeSupabaseWithSeats({ members, invites, excludedInvites = 0 }, observed = {}) {
  return {
    from(table) {
      const expectedStatus = table === 'workspace_memberships' ? 'active' : 'pending';
      let excluded = false;
      const builder = {
        select() {
          return builder;
        },
        neq(field, value) {
          assert.equal(table, 'workspace_invitations', 'only the invitation count may exclude a row');
          assert.equal(field, 'invitation_id');
          observed.excludedInvitationId = value;
          excluded = true;
          return builder;
        },
        eq(field, value) {
          if (field === 'status') {
            assert.equal(value, expectedStatus, `${table} must filter on ${expectedStatus}`);
            const count = table === 'workspace_memberships' ? members : excluded ? invites - excludedInvites : invites;
            return Promise.resolve({ count });
          }
          assert.equal(field, 'workspace_id');
          return builder;
        },
      };
      return builder;
    },
  };
}

test('an invite that would exceed the seat limit (members + pending) is rejected', async () => {
  const limits = subscriptionPlans.Professional.limits; // 5 seats
  const supabase = fakeSupabaseWithSeats({ members: 3, invites: 2 });
  const result = await checkSeatCapacity(supabase, 'ws-1', 1, limits);
  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`${limits.seatLimit} team seat limit`));
  assert.match(result.message, /pending invites/);
});

test('an invite that exactly fills the seat limit is allowed', async () => {
  const limits = subscriptionPlans.Professional.limits;
  const supabase = fakeSupabaseWithSeats({ members: 3, invites: 1 });
  const result = await checkSeatCapacity(supabase, 'ws-1', 1, limits);
  assert.deepEqual(result, { ok: true, used: 4 });
});

test('a solo Starter workspace cannot invite a second seat', async () => {
  const limits = subscriptionPlans.Starter.limits; // 1 seat
  const supabase = fakeSupabaseWithSeats({ members: 1, invites: 0 });
  const result = await checkSeatCapacity(supabase, 'ws-1', 1, limits);
  assert.equal(result.ok, false);
});

test('the invite being sent is not double-counted against its own reservation', async () => {
  // The app inserts the pending invitation row BEFORE calling /api/invite.
  // With 4 of 5 seats used and this invite's own row already reserved,
  // excluding it must let the send go through (4 others + this 1 = 5 = limit).
  const limits = subscriptionPlans.Professional.limits; // 5 seats
  const observed = {};
  const supabase = fakeSupabaseWithSeats({ members: 4, invites: 1, excludedInvites: 1 }, observed);
  const result = await checkSeatCapacity(supabase, 'ws-1', 1, limits, { excludeInvitationId: 'invite-self' });
  assert.equal(observed.excludedInvitationId, 'invite-self');
  assert.deepEqual(result, { ok: true, used: 4 });
});
