import assert from 'node:assert/strict';
import test from 'node:test';

import { checkStorageCapacity } from '../../api/_lib/entitlements.js';
import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';

/*
 * Server-side storage-limit enforcement. Legacy tier caps remain unchanged; this
 * gate — backed by the authoritative xbar_workspace_storage_bytes usage and the
 * DB trigger — is what actually stops a workspace from exceeding it. The
 * client-side figure is UX only.
 */

const GB = 1024 * 1024 * 1024; // binary GB, matches estimateStorageGb + the migration

function fakeSupabaseWithBytes(usedBytes) {
  return {
    rpc(fn, params) {
      assert.equal(fn, 'xbar_workspace_storage_bytes');
      assert.deepEqual(params, { p_workspace_id: 'ws-1' });
      return Promise.resolve({ data: usedBytes });
    },
  };
}

const starter = subscriptionPlans.Starter.limits; // storageLimitGb: 25
const professional = subscriptionPlans.Professional.limits; // storageLimitGb: 100

test('an upload that would exceed the tier storage cap is rejected', async () => {
  const used = (starter.storageLimitGb - 1) * GB; // 1 GB free
  const result = await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 2 * GB, starter);
  assert.equal(result.ok, false);
  assert.match(result.message, /workspace storage limit/);
  assert.doesNotMatch(result.message, /Upgrade|25 GB storage limit/);
  assert.match(result.message, /limited and shared across XBAR at launch/);
});

test('an upload that exactly fills the cap is allowed', async () => {
  const used = (starter.storageLimitGb - 5) * GB;
  const result = await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 5 * GB, starter);
  assert.deepEqual(result, { ok: true, usedBytes: used });
});

test('a single byte over the cap is rejected', async () => {
  const used = starter.storageLimitGb * GB;
  const result = await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 1, starter);
  assert.equal(result.ok, false);
});

test('missing usage is not proof of an empty workspace', async () => {
  const result = await checkStorageCapacity(fakeSupabaseWithBytes(null), 'ws-1', 10 * GB, starter);
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});

test('the same usage that blocks Starter is allowed on a higher tier', async () => {
  const used = 40 * GB; // over Starter (25), under Professional (100)
  assert.equal((await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 5 * GB, starter)).ok, false);
  assert.equal((await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 5 * GB, professional)).ok, true);
});

test('negative incoming bytes are refused rather than clamped to zero', async () => {
  const used = 10 * GB;
  const result = await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', -999, starter);
  assert.equal(result.ok, false);
});

for (const used of [undefined, '', 'garbage', -1, 0.5, NaN, Infinity, true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
  test(`invalid storage usage ${String(used)} fails closed`, async () => {
    const result = await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 1, starter);
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
  });
}
test('an integer string returned for bigint usage preserves the exact cap', async () => {
  const used = starter.storageLimitGb * GB - 1;
  assert.equal((await checkStorageCapacity(fakeSupabaseWithBytes(String(used)), 'ws-1', 1, starter)).ok, true);
  assert.equal((await checkStorageCapacity(fakeSupabaseWithBytes(String(used)), 'ws-1', 2, starter)).ok, false);
});
test('an interrupted RPC returns retryable usage unavailable rather than throwing', async () => {
  const result = await checkStorageCapacity(
    {
      rpc: async () => {
        throw new Error('offline');
      },
    },
    'ws-1',
    1,
    starter,
  );
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});
