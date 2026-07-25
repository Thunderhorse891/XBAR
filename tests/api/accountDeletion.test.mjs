import assert from 'node:assert/strict';
import test from 'node:test';

import { confirmationSatisfied, pickSuccessorOwner, planAccountDeletion } from '../../api/_lib/account-deletion.js';

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

test('a privately-owned workspace (no other active members) is purged', () => {
  const plan = planAccountDeletion('user-1', [{ id: 'ws-solo', otherActiveMembers: [] }]);
  assert.deepEqual(plan.workspacesToPurge, ['ws-solo']);
  assert.deepEqual(plan.workspacesToTransfer, []);
});

test('a shared workspace is transferred, never purged, protecting its members', () => {
  const plan = planAccountDeletion('user-1', [
    {
      id: 'ws-shared',
      otherActiveMembers: [
        { userId: 'u-sales', role: 'Sales Lead' },
        { userId: 'u-admin', role: 'Admin' },
      ],
    },
  ]);
  assert.deepEqual(plan.workspacesToPurge, []);
  assert.equal(plan.workspacesToTransfer.length, 1);
  // Ownership goes to the most capable member (Admin over Sales Lead).
  assert.deepEqual(plan.workspacesToTransfer[0], { workspaceId: 'ws-shared', newOwnerUserId: 'u-admin' });
});

test('mixed ownership splits correctly', () => {
  const plan = planAccountDeletion('user-1', [
    { id: 'ws-solo', otherActiveMembers: [] },
    { id: 'ws-team', otherActiveMembers: [{ userId: 'u2', role: 'Ranch Manager' }] },
  ]);
  assert.deepEqual(plan.workspacesToPurge, ['ws-solo']);
  assert.deepEqual(plan.workspacesToTransfer, [{ workspaceId: 'ws-team', newOwnerUserId: 'u2' }]);
});

test('successor selection prefers higher-capability roles and tolerates unknown roles', () => {
  assert.equal(
    pickSuccessorOwner([
      { userId: 'a', role: 'Owner' },
      { userId: 'b', role: 'Ranch Manager' },
      { userId: 'c', role: 'Medical Lead' },
    ]),
    'b', // Ranch Manager outranks Medical Lead and Owner
  );
  assert.equal(pickSuccessorOwner([{ userId: 'x', role: 'Mystery' }]), 'x'); // unknown role still eligible
  assert.equal(pickSuccessorOwner([]), null);
  assert.equal(pickSuccessorOwner(undefined), null);
});

test('plan tolerates empty/undefined input and skips rows without ids', () => {
  assert.deepEqual(planAccountDeletion('u', undefined), {
    userId: 'u',
    workspacesToPurge: [],
    workspacesToTransfer: [],
  });
  const plan = planAccountDeletion('u', [{ otherActiveMembers: [] }, { id: 'ws-ok', otherActiveMembers: [] }]);
  assert.deepEqual(plan.workspacesToPurge, ['ws-ok']);
});
