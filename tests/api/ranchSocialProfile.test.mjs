import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createEmptyWorkspaceState,
  restoreWorkspaceProfile,
  restorePersistedState,
} from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { useCloudStore } from '../../src/store/useCloudStore.ts';
import { rememberRecordsOwner } from '../../src/lib/recordsOwner.ts';
await new Promise((resolve) => setImmediate(resolve));
let persisted;
const storage = new Map();
globalThis.window = {
  localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
};
useXbarStore.persist.setOptions({
  storage: {
    getItem: () => persisted,
    setItem: (_key, value) => {
      persisted = JSON.parse(JSON.stringify(value));
    },
    removeItem: () => {
      persisted = null;
    },
  },
});
beforeEach(() => {
  rememberRecordsOwner('local');
  useCloudStore.setState({
    session: null,
    workspaceId: '',
    status: 'unavailable',
    autosaveReady: true,
    autosaveUnlocked: true,
  });
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin' });
});
test('admin update persists and survives backup restore; unrelated patch preserves links; blank removes', () => {
  const link = 'https://www.instagram.com/ranch';
  assert.equal(useXbarStore.getState().updateWorkspaceProfile({ socialLinks: { instagram: link } }).ok, true);
  assert.equal(persisted.state.workspaceProfile.socialLinks.instagram, link);
  assert.equal(restorePersistedState(persisted.state).workspaceProfile.socialLinks.instagram, link);
  useXbarStore.getState().updateWorkspaceProfile({ ranchName: 'Changed Ranch' });
  assert.equal(useXbarStore.getState().workspaceProfile.socialLinks.instagram, link);
  useXbarStore.getState().updateWorkspaceProfile({ socialLinks: { instagram: '' } });
  assert.deepEqual(useXbarStore.getState().workspaceProfile.socialLinks, {});
});
test('invalid updates refuse all changes; malformed imported links never become clickable', () => {
  const before = useXbarStore.getState().workspaceProfile;
  assert.equal(
    useXbarStore
      .getState()
      .updateWorkspaceProfile({ ranchName: 'Do not apply', socialLinks: { x: 'javascript:alert(1)' } }).ok,
    false,
  );
  assert.deepEqual(useXbarStore.getState().workspaceProfile, before);
  assert.deepEqual(restoreWorkspaceProfile({ socialLinks: { facebook: 'https://evil.test/' } }).socialLinks, {});
});
for (const role of ['Ranch Manager', 'Owner', 'Medical Lead', 'Sales Lead', 'Unknown'])
  test(`${role} cannot update ranch links`, () => {
    useXbarStore.setState({ currentRole: role });
    const before = useXbarStore.getState().workspaceProfile;
    assert.equal(
      useXbarStore.getState().updateWorkspaceProfile({ socialLinks: { x: 'https://x.com/ranch' } }).ok,
      false,
    );
    assert.deepEqual(useXbarStore.getState().workspaceProfile, before);
  });
