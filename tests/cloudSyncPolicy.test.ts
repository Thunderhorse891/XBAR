import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { decideCloudReconciliation, hasMeaningfulWorkspace } from '../src/lib/cloudSyncPolicy.js';
import { shouldProtectMeaningfulWorkspaceWrite } from '../src/lib/workspaceStorage.js';

const empty = { workspace: { horses: [], documents: [], workspaceProfile: {} } };
const local = { workspace: { horses: [{ id: 'horse-local' }], workspaceProfile: { ranchName: 'Local Ranch' } } };
const remote = { workspace: { horses: [{ id: 'horse-remote' }], workspaceProfile: { ranchName: 'Cloud Ranch' } } };

test('recognizes meaningful ranch data', () => {
  assert.equal(hasMeaningfulWorkspace(empty), false);
  assert.equal(hasMeaningfulWorkspace(local), true);
});
test('imports cloud only when the local workspace is empty', () => {
  assert.equal(decideCloudReconciliation({ local: empty, remote }), 'import-remote');
});
test('pushes local only when cloud is empty or missing', () => {
  assert.equal(decideCloudReconciliation({ local, remote: empty }), 'push-local');
  assert.equal(
    decideCloudReconciliation({ local, remoteError: 'No relational workspace exists for this account yet.' }),
    'push-local',
  );
});
test('locks autosave when local and cloud both contain different work', () => {
  assert.equal(decideCloudReconciliation({ local, remote }), 'conflict-lock');
});
test('connects matching workspaces without destructive import', () => {
  assert.equal(decideCloudReconciliation({ local, remote: structuredClone(local) }), 'connected');
});

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

/*
 * Getting OUT of `conflict-lock`.
 *
 * Reconciliation is the only other thing that unlocks autosave, and it runs
 * once per hydration: the effect is keyed on the workspace and the session,
 * neither of which changes when someone presses a button in Settings. So
 * resolving the conflict by hand left `autosaveUnlocked` false forever — the
 * toast said the sync completed, and every later edit was skipped until a
 * reload.
 *
 * Asserted at the source: these live in a React route and a Zustand store that
 * import through `@/` aliases the node test build does not resolve, so this
 * suite cannot execute them. Named plainly because it is a real limit.
 */

test('resolving a conflict by hand unlocks autosave on both paths', async () => {
  const settings = await readFile('src/routes/Settings.tsx', 'utf8');

  const push = settings.slice(settings.indexOf('const handlePushCloud'), settings.indexOf('const handlePullCloud'));
  const pull = settings.slice(settings.indexOf('const handlePullCloud'), settings.indexOf('const handleSignOutCloud'));
  assert.ok(push.length > 0 && pull.length > 0, 'both handlers must be findable');

  for (const [name, handler] of [
    ['Push cloud', push],
    ['Pull cloud', pull],
  ] as const) {
    assert.match(
      handler,
      /if \(result\.ok\) \{\s*unlockAutosaveAfterManualSync\(\);/,
      `${name} is one of the two choices the conflict-lock message offers, so it must clear the lock`,
    );
  }
});

test('the unlock cannot promote a workspace that is still hydrating', async () => {
  const store = await readFile('src/store/useCloudStore.ts', 'utf8');

  /*
   * The permissive half of the pair, on purpose. `autosaveReady` means
   * hydration stopped; `autosaveUnlocked` means it settled on a copy. This
   * transition may set the second and must never set the first — a call site
   * that can promote `ready` can start autosave against a half-hydrated
   * workspace, which is the failure `vaultOwner` exists to prevent.
   */
  assert.match(
    store,
    /unlockAutosaveAfterManualSync: \(\) =>\s*set\(\(state\) => \(state\.autosaveReady \? \{ autosaveUnlocked: true \} : state\)\),/,
    'it must be a no-op while reconciliation is still running, and must not touch autosaveReady',
  );
  assert.doesNotMatch(
    store.slice(store.indexOf('unlockAutosaveAfterManualSync: ()')).slice(0, 200),
    /autosaveReady: true/,
    "setting ready here would let autosave run against records that are not this workspace's yet",
  );
});

test('reconciliation still finishes a conflict LOCKED', async () => {
  // The over-correction. Autosave stays off until a person chooses a copy;
  // making reconciliation unlock this itself would push one ranch's records
  // over the other's without anyone deciding.
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');

  assert.match(
    bootstrap,
    /finish\(\s*false,\s*'error',\s*decision === 'conflict-lock'/,
    'a conflict must still finish locked',
  );
  assert.match(
    bootstrap,
    /if \(cloudStatus !== 'signed-in' \|\| !autosaveReady \|\| !autosaveUnlocked\) return;/,
    'and autosave must still require both flags, or the unlock guards nothing',
  );
});
