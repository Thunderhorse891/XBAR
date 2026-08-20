import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkDocumentCapacity,
  checkHorseCapacity,
  checkSalePacketCapacity,
  checkSeatCapacity,
  checkStorageCapacity,
} from '../../api/_lib/entitlements.js';
import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';

/*
 * Every paid tier is sold on its limits, and these five gates are the only
 * thing that enforces them server-side. Each one used to discard the error from
 * its usage query, so a failed read produced a null count, `used` collapsed to
 * 0, and the limit silently stopped applying — a request that should have been
 * refused came back as a clean pass.
 *
 * That is not hypothetical for storage: the service role holds EXECUTE on
 * xbar_workspace_storage_bytes only through PostgreSQL's default PUBLIC grant,
 * so a revoke of that grant (see 20260819_restrict_anon_rpc_surface.sql) makes
 * the RPC fail while every upload sails through.
 *
 * These tests assert the gates refuse rather than pass when usage is unknown.
 * They are written against a query that errors, which is the state the old code
 * could not distinguish from an empty workspace.
 */

const limits = subscriptionPlans.Starter.limits;
const dbError = { message: 'permission denied for function' };

// Chainable thenable: every builder method returns itself, awaiting it yields
// the error result. Matches how the helpers actually use the query builder
// (.from().select().eq()... then await) without pinning the exact call chain.
function failingQuery() {
  const query = {
    from: () => query,
    select: () => query,
    eq: () => query,
    neq: () => query,
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
  ['seat capacity', (supabase) => checkSeatCapacity(supabase, 'ws-1', 1, limits)],
  ['sale packet capacity', (supabase) => checkSalePacketCapacity(supabase, 'ws-1', 1, limits)],
  ['storage capacity', (supabase) => checkStorageCapacity(supabase, 'ws-1', 1, limits)],
];

for (const [name, run] of gates) {
  test(`${name} refuses when current usage cannot be read`, async () => {
    const result = await run(failingSupabase());

    assert.equal(result.ok, false, `${name} passed an action it could not verify against the plan limit`);
    assert.match(result.message, /could not be verified/);

    // The customer must be told to retry, not to upgrade: nothing here says
    // they are actually over their limit.
    assert.doesNotMatch(result.message, /Upgrade to continue/);
  });
}

test('a healthy gate still enforces the limit it is given', async () => {
  // Guards the fix itself: refusing on error is only correct if the success
  // path is untouched, otherwise these tests would pass against a gate that
  // refuses everything.
  const healthy = {
    rpc: () => Promise.resolve({ data: 0, error: null }),
  };
  const allowed = await checkStorageCapacity(healthy, 'ws-1', 1, limits);
  assert.deepEqual(allowed, { ok: true, usedBytes: 0 });

  const overLimit = await checkStorageCapacity(healthy, 'ws-1', (limits.storageLimitGb + 1) * 1024 ** 3, limits);
  assert.equal(overLimit.ok, false);
  assert.match(overLimit.message, /Upgrade to continue/);
});
