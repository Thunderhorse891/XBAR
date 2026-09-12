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

test('the first relational workspace id becomes active before billing depends on it', async () => {
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  const store = await readFile('src/store/useCloudStore.ts', 'utf8');
  const setup = await readFile('src/routes/SetupWorkspace.tsx', 'utf8');
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');

  /*
   * `workspaces` is created by the first relational save, not by Supabase auth.
   * The returned id must be published immediately; otherwise the billing screen
   * can open with a database row present while the browser still believes the
   * workspace has no managed-billing identity.
   */
  assert.match(cloud, /type CloudSaveResult = \{[\s\S]*workspaceId\?: string;/);
  assert.match(cloud, /message: 'Relational workspace updated\.',\s*workspaceId,/);
  assert.match(store, /setWorkspaceAccessProfile: \(workspaceId: string, workspaceRole\?: UserRole\) => void;/);
  assert.match(
    store,
    /setWorkspaceAccessProfile: \(workspaceId, workspaceRole = 'Admin'\) => set\(\{ workspaceId, workspaceRole \}\)/,
  );
  assert.match(setup, /if \(saved\.workspaceId\) setWorkspaceAccessProfile\(saved\.workspaceId, 'Admin'\);/);
  assert.match(
    bootstrap,
    /saved\.ok && saved\.workspaceId && saved\.workspaceId !== workspaceId\) \{\s*setWorkspaceAccessProfile\(saved\.workspaceId, 'Admin'\);/,
  );
  assert.match(
    bootstrap,
    /result\.workspaceId && result\.workspaceId !== workspaceId\) \{\s*setWorkspaceAccessProfile\(result\.workspaceId, 'Admin'\);/,
  );
});

test('document intake checks authoritative cloud capacity before uploading', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');

  assert.match(cloud, /client\.rpc\('xbar_workspace_storage_bytes'/);
  const intake = store.slice(store.indexOf('createDocumentIntake:'), store.indexOf('reviewDocument:'));
  assert.match(intake, /await loadWorkspaceStorageBytes\(\)/);
  assert.ok(
    intake.indexOf('await loadWorkspaceStorageBytes()') < intake.indexOf('uploadDocumentAssetToCloud({'),
    'capacity must be verified before object bytes leave the browser',
  );
  /*
   * Codex's version refused the whole intake when the total could not be read.
   * That closed the wedge and opened a worse hole: a rancher with no signal
   * could not add a document AT ALL, on a build where every other failure path
   * in this file falls back to the device.
   *
   * Unverified capacity now declines the UPLOAD and keeps the intake. The wedge
   * stays closed by the same commit's other half: no `storagePath` means no
   * `fileSizeBytes`, so the row pushes `size_bytes: 0` and cannot be the
   * over-cap row that fails the batched upsert.
   */
  assert.match(intake, /cloudUploadsAllowed = false/);
  assert.ok(
    !/No files were uploaded/.test(intake),
    'an unreadable total must not refuse the intake — the file still belongs on the device',
  );
  assert.match(intake, /if \(cloudUploadsAllowed\) \{/, 'the flag must actually gate the upload');
  assert.match(intake, /Cloud storage could not be reached, so these are on this device only/);
});

test('a known over-cap batch is still refused outright', async () => {
  // The distinction that matters: "we know you are over" is actionable and is
  // refused; "we could not find out" is not the customer's fault and keeps
  // their file.
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const intake = store.slice(store.indexOf('createDocumentIntake:'), store.indexOf('reviewDocument:'));
  /*
   * Tied to the branch, not just present in the file: the same
   * "Storage limit reached" string also lives in the local-only branch below,
   * so asserting it anywhere let a mutant that dropped this refusal survive.
   */
  assert.match(
    intake,
    /knownBytes \+ incomingBytes > planUsage\.storageLimitGb[\s\S]{0,240}?return \{[\s\S]{0,160}?ok: false,[\s\S]{0,160}?Storage limit reached for the current plan\./,
    'a batch known to be over cap must be refused by that branch, not merely mentioned somewhere',
  );
});

test('document quota charges cloud bytes with a project and device bytes without one', async () => {
  /*
   * With a project the quota is cloud-stored bytes, so a device-only record is
   * charged nothing — it occupies nothing in the bucket.
   *
   * With NO project `storagePath` is never set, so that same rule charged every
   * batch zero: each later batch was measured against an untouched total and
   * the plan's cap could be walked past indefinitely. In a local-only build the
   * files on the device are the usage.
   */
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const intake = store.slice(store.indexOf('createDocumentIntake:'), store.indexOf('reviewDocument:'));

  assert.match(intake, /fileSizeBytes: uploadedAsset \? file\.size : undefined/);
  assert.match(
    intake,
    /const chargedStorageGb =\s*\(isSupabaseConfigured\(\)\s*\?\s*documents[\s\S]{0,200}?filter\(\(document\) => Boolean\(document\.storagePath\)\)/,
    'a cloud build must charge only records that reached the bucket',
  );
  assert.match(
    intake,
    /:\s*fileList\.reduce\(\(total, file\) => total \+ file\.size, 0\)\)\s*\/\s*\(1024 \* 1024 \* 1024\)/,
    'a local-only build must charge the batch it just stored on the device',
  );
  assert.match(
    intake,
    /storageUsedGb: normalizeUsage\(current\.subscription\.usage\.storageUsedGb \+ chargedStorageGb\)/,
    'the accumulated usage must be the charged amount',
  );
});

test('automatic relational save failures are visible and deduplicated', async () => {
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');

  assert.match(bootstrap, /id: 'cloud-autosave-failed'/);
  assert.match(bootstrap, /title: 'Cloud save paused'/);
  assert.match(bootstrap, /Changes remain local and will retry\./);
});

test('an autosave never revokes an invitation it simply has not seen', async () => {
  /*
   * `replaceWorkspaceRows` deletes server rows missing from the snapshot. For a
   * workspace's own records that is correct — the snapshot IS the workspace.
   * For ACCESS rows it is not, and the same argument already written over
   * `syncWorkspaceMembershipRows` applies: a save is not a removal.
   *
   * An invitation created by another owner after this tab loaded is simply
   * absent here, and deleting it revokes a live invitation nobody revoked.
   * Nothing legitimate is lost: revocation and acceptance are UPDATES to
   * `status`, never deletes, so no path removes an invitation row at all.
   * 20260911005818 granting owners DELETE is what made this effective rather
   * than refused.
   */
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  const invitationPush = cloud.slice(cloud.indexOf("table: 'workspace_invitations'"), cloud.indexOf("table: 'horses'"));
  assert.ok(invitationPush.length > 0, 'the invitation push must be findable');
  assert.match(invitationPush, /removeMissing: false/, 'an unseen invitation must not be deleted by a save');

  // And the flag has to actually skip the delete, not merely be accepted.
  assert.match(cloud, /removeMissing = true \} = params/);
  assert.match(
    cloud,
    /removeMissing\s*\?\s*await client\.from\(table\)\.select\(idColumn\)[\s\S]{0,120}?:\s*\{ data: \[\], error: null \}/,
    'removeMissing:false must stop the stale-row lookup that feeds the delete',
  );

  // Revocation stays an explicit status update, which is why inferring deletion
  // buys nothing.
  assert.match(cloud, /\.from\('workspace_invitations'\)\s*\.update\(\{\s*status: nextStatus/);
});

test('a second batch is measured against bytes already uploaded, not just persisted rows', async () => {
  /*
   * `xbar_workspace_storage_bytes` sums `documents` AND `sale_packets` ROWS. A
   * row lands about 1.6 seconds after its object does — CloudBootstrap's
   * autosave debounce — so a batch started inside that window was measured
   * against a total that predated the previous one, and both could pass just
   * under the cap. The later upsert is then rejected by the storage trigger,
   * which is the wedge this gate exists to prevent.
   *
   * Staged bytes are ADDED to the server total, never compared with it. A local
   * document total carries no sale packets, so taking the greater of the two
   * compared quantities of different scope: in a workspace holding more packet
   * bytes than staged document bytes, the server total won and the staged files
   * dropped out of the sum entirely.
   */
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const intake = store.slice(store.indexOf('createDocumentIntake:'), store.indexOf('reviewDocument:'));

  assert.match(
    intake,
    /const knownBytes = storedBytes \+ useCloudStore\.getState\(\)\.stagedStorageBytes/,
    'staged bytes must be added to the authoritative total, not compared with it',
  );
  assert.ok(
    !/Math\.max\(storedBytes/.test(intake),
    'the server total and a documents-only local total are not comparable quantities',
  );
  assert.match(
    intake,
    /if \(knownBytes \+ incomingBytes > planUsage\.storageLimitGb/,
    'the comparison must use the combined total',
  );
  /*
   * Counted in exact bytes as each upload succeeds, not from `storageUsedGb`.
   * That field passes through `normalizeUsage` — `Math.round(value * 1000) /
   * 1000`, three decimals of a gigabyte — so an upload under about half a MiB
   * rounds to a zero increment and a run of small batches keeps measuring
   * itself against the pre-upload total.
   */
  assert.match(
    intake,
    /uploadedAsset = await uploadDocumentAssetToCloud\(\{[\s\S]{0,420}?noteStagedStorageBytes\(file\.size\)/,
    'bytes must be staged as the upload succeeds, before the next batch can be gated',
  );
  assert.ok(
    !/planUsage\.storageUsedGb\) \* 1024/.test(intake),
    'the rounded gigabyte value must not be the capacity input',
  );
});

test('staged bytes are released by the save that persists them, and only that much', async () => {
  /*
   * Once the server holds the rows, those bytes are inside its total and
   * counting them twice would refuse batches that fit. Releasing the amount
   * captured with the snapshot — rather than zeroing — is what keeps an upload
   * that lands mid-save, and so is absent from that snapshot, still counted.
   */
  const bootstrap = await readFile('src/components/CloudBootstrap.tsx', 'utf8');
  const cloudStore = await readFile('src/store/useCloudStore.ts', 'utf8');

  assert.match(
    bootstrap,
    /const stagedAtSnapshot = useCloudStore\.getState\(\)\.stagedStorageBytes;[\s\S]{0,200}?const signature = serializeWorkspaceBackup\(backup\)/,
    'the staged amount must be captured with the snapshot, before the request',
  );
  assert.match(
    bootstrap,
    /if \(result\.ok\) \{[\s\S]{0,900}?if \(result\.relationalRowsPersisted\) settleStagedStorageBytes\(stagedAtSnapshot\)/,
    'staged bytes may only be released once the document rows actually reached the database',
  );
  assert.match(
    cloudStore,
    /settleStagedStorageBytes: \(bytes\) =>[\s\S]{0,260}?stagedStorageBytes: Math\.max\(0, state\.stagedStorageBytes - /,
    'the release must subtract the captured amount, never zero the counter',
  );
});

test('a snapshot-only fallback does not claim the relational rows landed', async () => {
  /*
   * With `VITE_SUPABASE_SNAPSHOT_FALLBACK` on, a rejected relational save still
   * returns `ok` once the legacy snapshot is written — the rancher's work is
   * safe, which is what `ok` means. But `xbar_workspace_storage_bytes` reads
   * the `documents` table, and that path added nothing to it. A caller cannot
   * tell those apart from `ok`, so the distinction has to be reported.
   *
   * If it were not, the capacity gate would release its reservation for bytes
   * the server never took over: the objects would be counted by nobody and
   * every later batch would pass against a total that never grows.
   */
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  const save = cloud.slice(
    cloud.indexOf('export async function saveWorkspaceBackupToCloud'),
    cloud.indexOf('export async function loadWorkspaceBackupFromCloud'),
  );
  assert.ok(save.length > 0, 'the save function must be findable');

  const fallbackReturn = save.slice(
    save.indexOf('Relational workspace unavailable') - 400,
    save.indexOf('Relational workspace unavailable') + 200,
  );
  assert.ok(
    !/relationalRowsPersisted/.test(fallbackReturn),
    'the snapshot-only fallback must not report relational persistence',
  );

  // And the success paths must report it, or the reservation is never released.
  assert.equal(
    (save.match(/relationalRowsPersisted: true/g) ?? []).length,
    2,
    'both relational-success returns must report that the rows landed',
  );
});
