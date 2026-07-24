import assert from 'node:assert/strict';
import test from 'node:test';

import { checkStorageCapacity } from '../../api/_lib/entitlements.js';
import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';

/*
 * Server-side storage-limit enforcement. Every tier sells a storage cap; this
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
  assert.match(result.message, new RegExp(`${starter.storageLimitGb} GB storage limit`));
  assert.match(result.message, /Upgrade to continue/);
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

test('an empty workspace (null usage) is treated as zero', async () => {
  const result = await checkStorageCapacity(fakeSupabaseWithBytes(null), 'ws-1', 10 * GB, starter);
  assert.deepEqual(result, { ok: true, usedBytes: 0 });
});

test('the same usage that blocks Starter is allowed on a higher tier', async () => {
  const used = 40 * GB; // over Starter (25), under Professional (100)
  assert.equal((await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 5 * GB, starter)).ok, false);
  assert.equal((await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', 5 * GB, professional)).ok, true);
});

test('negative or non-numeric incoming bytes are clamped to zero', async () => {
  const used = 10 * GB;
  const result = await checkStorageCapacity(fakeSupabaseWithBytes(used), 'ws-1', -999, starter);
  assert.equal(result.ok, true);
});
