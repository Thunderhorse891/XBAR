import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createEmptyWorkspaceState } from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { useCloudStore } from '../../src/store/useCloudStore.ts';
import { hasRoleCapability } from '../../src/lib/permissions.ts';
import { supabaseConfig } from '../../src/lib/platformConfig.ts';
import { identityPublication } from '../../src/lib/authBootstrap.ts';
await new Promise((resolve) => setImmediate(resolve));
supabaseConfig.url = '';
supabaseConfig.anonKey = '';
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const capabilities = [
  'createHorse',
  'editHorse',
  'uploadDocuments',
  'reviewDocuments',
  'uploadMedia',
  'manageMedical',
  'manageBreeding',
  'manageSales',
  'manageOwnership',
  'manageAssets',
  'manageSharedAccess',
  'manageSettings',
  'manageBilling',
  'syncCloud',
];
test('pending access has no mutation capabilities and identity changes enter that state', () => {
  for (const capability of capabilities)
    assert.equal(hasRoleCapability('Pending access', capability), false, capability);
  assert.equal(identityPublication('old-user', 'new-user').workspaceRole, 'Pending access');
  assert.equal(identityPublication('old-user', 'new-user').recoveryContext, undefined);
});
test('pending actual store cannot bootstrap itself into Admin or create records', () => {
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Pending access' });
  const before = useXbarStore.getState().exportWorkspaceBackup();
  assert.equal(useXbarStore.getState().initializeWorkspace({ ranchName: 'Ranch', businessName: 'Business' }).ok, false);
  assert.equal(useXbarStore.getState().addHorse({ name: 'Forbidden horse' }).ok, false);
  assert.equal(useXbarStore.getState().updateWorkspaceProfile({ businessName: 'Forbidden business' }).ok, false);
  assert.equal(useXbarStore.getState().currentRole, 'Pending access');
  assert.deepEqual(useXbarStore.getState().exportWorkspaceBackup().workspace, before.workspace);
});
test('verified Admin retains first workspace creation while pending presentation never implies Admin', async () => {
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin' });
  assert.equal(
    useXbarStore.getState().initializeWorkspace({ ranchName: 'Verified ranch', businessName: 'Verified business' }).ok,
    true,
  );
  const source = await readFile('src/store/useXbarStore.ts', 'utf8');
  assert.match(source, /return match \?\? pendingRoleWorkspace/);
  assert.doesNotMatch(source, /return match \?\? state\.roleWorkspaces\[0\]/);
});
test('manual snapshot recovery replaces the autosave context only for the current account', () => {
  Object.assign(supabaseConfig, {
    url: 'https://synthetic.example.test',
    anonKey: 'fixture',
    relationalSyncEnabled: false,
  });
  const old = { userId: 'user-a', workspaceId: 'former-ranch', workspaceRole: 'Admin' };
  const chosen = { userId: 'user-a', workspaceId: 'current-ranch', workspaceRole: 'Owner' };
  useCloudStore.setState({
    session: { user: { id: 'user-a' } },
    autosaveReady: true,
    autosaveUnlocked: false,
    recoveryContext: old,
  });
  useCloudStore.getState().unlockAutosaveAfterManualSync();
  assert.equal(useCloudStore.getState().autosaveUnlocked, false);
  useCloudStore.getState().unlockAutosaveAfterManualSync({ ...chosen, userId: 'other-user' });
  assert.equal(useCloudStore.getState().autosaveUnlocked, false);
  useCloudStore.getState().unlockAutosaveAfterManualSync(chosen);
  assert.equal(useCloudStore.getState().autosaveUnlocked, true);
  assert.deepEqual(useCloudStore.getState().recoveryContext, chosen);
  useCloudStore.getState().setRecoveryContext({ ...chosen, userId: 'other-user' });
  assert.equal(useCloudStore.getState().recoveryContext, undefined);
});

test('a trusted limited role cannot use first setup to promote itself into Admin', () => {
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Owner' });
  assert.equal(useXbarStore.getState().initializeWorkspace({ ranchName: 'Ranch', businessName: 'Business' }).ok, false);
  assert.equal(useXbarStore.getState().currentRole, 'Owner');
  assert.equal(useXbarStore.getState().workspaceMembers.length, 0);
});

test('verified recovery access enables the correct UI role without changing the vault namespace or unlocking records', () => {
  const context = { userId: 'user-a', workspaceId: 'verified-ranch', workspaceRole: 'Admin' };
  useCloudStore.setState({
    session: { user: { id: 'user-a' } },
    workspaceId: '',
    workspaceRole: 'Pending access',
    autosaveReady: true,
    autosaveUnlocked: false,
  });
  useCloudStore.getState().setRecoveryContext(context);
  assert.equal(useCloudStore.getState().workspaceId, '');
  assert.equal(useCloudStore.getState().workspaceRole, 'Admin');
  assert.equal(useCloudStore.getState().autosaveUnlocked, false);
});
test('meaningful records without verified local ownership cannot be relabeled by first setup', () => {
  useXbarStore.setState({
    ...createEmptyWorkspaceState(),
    currentRole: 'Admin',
    horses: [{ id: 'old-horse', name: 'Prior ranch' }],
  });
  const before = useXbarStore.getState().exportWorkspaceBackup().workspace;
  assert.equal(
    useXbarStore.getState().initializeWorkspace({ ranchName: 'New ranch', businessName: 'New business' }).ok,
    false,
  );
  assert.deepEqual(useXbarStore.getState().exportWorkspaceBackup().workspace, before);
});

test('clearing recovery context while signed out remains pending and does not throw', () => {
  useCloudStore.setState({ session: null, workspaceRole: 'Pending access' });
  assert.doesNotThrow(() => useCloudStore.getState().setRecoveryContext(undefined));
  assert.equal(useCloudStore.getState().workspaceRole, 'Pending access');
});

test('manual recovery cannot unlock while actual hydration is still running', () => {
  const context = { userId: 'user-a', workspaceId: 'ranch-a', workspaceRole: 'Admin' };
  useCloudStore.setState({
    session: { user: { id: 'user-a' } },
    autosaveReady: false,
    autosaveUnlocked: false,
    recoveryContext: undefined,
  });
  useCloudStore.getState().unlockAutosaveAfterManualSync(context);
  assert.equal(useCloudStore.getState().autosaveReady, false);
  assert.equal(useCloudStore.getState().autosaveUnlocked, false);
  assert.equal(useCloudStore.getState().recoveryContext, undefined);
});
