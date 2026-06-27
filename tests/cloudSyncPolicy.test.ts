import assert from 'node:assert/strict';
import test from 'node:test';
import { decideCloudReconciliation, hasMeaningfulWorkspace } from '../src/lib/cloudSyncPolicy.js';
import { shouldProtectMeaningfulWorkspaceWrite } from '../src/lib/workspaceStorage.js';

const empty = { workspace: { horses: [], documents: [], workspaceProfile: {} } };
const local = { workspace: { horses: [{ id: 'horse-local' }], workspaceProfile: { ranchName: 'Local Ranch' } } };
const remote = { workspace: { horses: [{ id: 'horse-remote' }], workspaceProfile: { ranchName: 'Cloud Ranch' } } };

test('recognizes meaningful ranch data', () => { assert.equal(hasMeaningfulWorkspace(empty), false); assert.equal(hasMeaningfulWorkspace(local), true); });
test('imports cloud only when the local workspace is empty', () => { assert.equal(decideCloudReconciliation({ local: empty, remote }), 'import-remote'); });
test('pushes local only when cloud is empty or missing', () => { assert.equal(decideCloudReconciliation({ local, remote: empty }), 'push-local'); assert.equal(decideCloudReconciliation({ local, remoteError: 'No relational workspace exists for this account yet.' }), 'push-local'); });
test('locks autosave when local and cloud both contain different work', () => { assert.equal(decideCloudReconciliation({ local, remote }), 'conflict-lock'); });
test('connects matching workspaces without destructive import', () => { assert.equal(decideCloudReconciliation({ local, remote: structuredClone(local) }), 'connected'); });

function persisted(state: unknown) {
  return JSON.stringify({ state, version: 8 });
}

test('protects meaningful browser workspace storage from empty seed overwrites', () => {
  const existing = persisted({
    horses: [{ id: 'horse-real' }],
    documents: [],
    workspaceMembers: [{ id: 'member-admin' }],
    workspaceProfile: { ranchName: 'Blue River Ranch', setupCompleteAt: '2026-06-27 09:00' },
  });
  const emptySeed = persisted({
    horses: [],
    documents: [],
    intakeBatches: [],
    salePacketBuilds: [],
    buyerRoomEvents: [],
    workspaceMembers: [],
    workspaceInvitations: [],
    workspaceProfile: { ranchName: 'Primary Ranch', setupCompleteAt: '' },
  });
  const nextMeaningful = persisted({
    horses: [{ id: 'horse-real' }],
    documents: [{ id: 'doc-1' }],
    workspaceMembers: [{ id: 'member-admin' }],
    workspaceProfile: { ranchName: 'Blue River Ranch', setupCompleteAt: '2026-06-27 09:00' },
  });

  assert.equal(shouldProtectMeaningfulWorkspaceWrite(existing, emptySeed), true);
  assert.equal(shouldProtectMeaningfulWorkspaceWrite(existing, nextMeaningful), false);
  assert.equal(shouldProtectMeaningfulWorkspaceWrite(null, emptySeed), false);
});
