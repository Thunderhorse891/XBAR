import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmationSatisfied, planAccountDeletion } from '../../api/_lib/account-deletion.js';

test('confirmation requires the exact account email (trimmed, case-insensitive)', () => {
  assert.equal(confirmationSatisfied('rancher@example.com', 'rancher@example.com'), true);
  assert.equal(confirmationSatisfied('  Rancher@Example.com  ', 'rancher@example.com'), true);
  assert.equal(confirmationSatisfied('someone@else.com', 'rancher@example.com'), false);
});

test('empty or missing confirmation never matches', () => {
  assert.equal(confirmationSatisfied('', 'rancher@example.com'), false);
  assert.equal(confirmationSatisfied('   ', 'rancher@example.com'), false);
  assert.equal(confirmationSatisfied(undefined, 'rancher@example.com'), false);
  assert.equal(confirmationSatisfied('rancher@example.com', ''), false); // no account email known
  assert.equal(confirmationSatisfied(null, null), false);
});

test('deletion plan purges owned workspaces and drops only non-owned memberships', () => {
  const plan = planAccountDeletion('user-1', ['ws-owned-a', 'ws-owned-b'], ['ws-owned-a', 'ws-shared-c']);
  assert.deepEqual(plan.workspacesToPurge.sort(), ['ws-owned-a', 'ws-owned-b']);
  // ws-owned-a is filtered out of memberships (already purged); only the shared one remains.
  assert.deepEqual(plan.membershipsToDrop, ['ws-shared-c']);
  assert.equal(plan.userId, 'user-1');
});

test('a member-only user purges nothing and drops all their memberships', () => {
  const plan = planAccountDeletion('user-2', [], ['ws-x', 'ws-y']);
  assert.deepEqual(plan.workspacesToPurge, []);
  assert.deepEqual(plan.membershipsToDrop, ['ws-x', 'ws-y']);
});

test('plan tolerates empty/undefined inputs', () => {
  const plan = planAccountDeletion('user-3', undefined, undefined);
  assert.deepEqual(plan.workspacesToPurge, []);
  assert.deepEqual(plan.membershipsToDrop, []);
});
