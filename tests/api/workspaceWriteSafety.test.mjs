import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/\/supabaseClient(?:\.[tj]s)?$/.test(specifier))
      return { url: new URL('./fixtures/cloudSubscriptionClient.mjs', import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});
const { setCloudSubscriptionClient } = await import('./fixtures/cloudSubscriptionClient.mjs');
const { supabaseConfig } = await import('../../src/lib/platformConfig.ts');
const { createEmptyWorkspaceState, createHorseRecord } = await import('../../src/store/xbarStoreHelpers.ts');
const { useXbarStore } = await import('../../src/store/useXbarStore.ts');
const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
const { rememberRecordsOwner } = await import('../../src/lib/recordsOwner.ts');
await new Promise((resolve) => setImmediate(resolve));
const storage = new Map();
globalThis.window = { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
let requests;
const input = {
  name: 'Synthetic guard horse',
  barnName: 'QA',
  sex: 'Mare',
  segment: 'Sale Prospect',
  status: 'Pasture',
  owner: 'QA',
  ownerEntity: 'QA',
  barn: 'QA',
  pasture: '',
};
beforeEach(() => {
  requests = [];
  storage.clear();
  Object.assign(supabaseConfig, { url: 'https://synthetic.invalid', anonKey: 'fixture', relationalSyncEnabled: true });
  setCloudSubscriptionClient(
    new Proxy(
      {},
      {
        get(_t, key) {
          requests.push(key);
          throw new Error('Unexpected cloud request');
        },
      },
    ),
  );
  useCloudStore.setState({
    status: 'signed-in',
    session: { user: { id: 'qa-user' } },
    workspaceId: 'qa-ranch',
    workspaceReady: true,
    autosaveReady: true,
    autosaveUnlocked: true,
    workspaceRole: 'Admin',
  });
  rememberRecordsOwner('qa-ranch');
  const empty = createEmptyWorkspaceState();
  useXbarStore.setState({
    ...empty,
    currentRole: 'Admin',
    horses: [{ ...createHorseRecord(input, empty.workspaceProfile), id: 'existing' }],
  });
});
for (const mode of [
  'locked',
  'reconciling',
  'missing-workspace',
  'unknown-owner',
  'other-owner',
  'auth-loading',
  'missing-session',
  'pending-permission',
]) {
  test(`${mode}: horse, document and photo refuse before records or file writes`, async () => {
    if (mode === 'locked') useCloudStore.setState({ autosaveUnlocked: false });
    if (mode === 'reconciling') useCloudStore.setState({ autosaveReady: false });
    if (mode === 'missing-workspace') useCloudStore.setState({ workspaceId: '' });
    if (mode === 'unknown-owner') rememberRecordsOwner('');
    if (mode === 'other-owner') rememberRecordsOwner('another-ranch');
    if (mode === 'auth-loading') useCloudStore.setState({ status: 'loading' });
    if (mode === 'missing-session') useCloudStore.setState({ session: null });
    if (mode === 'pending-permission') useCloudStore.setState({ workspaceRole: 'Pending access' });
    const before = useXbarStore.getState().exportWorkspaceBackup().workspace;
    const horse = useXbarStore.getState().addHorse(input);
    const document = await useXbarStore.getState().createDocumentIntake({
      files: [new File(['synthetic'], 'qa.pdf', { type: 'application/pdf' })],
      source: 'Bulk Intake',
      uploadedBy: 'QA',
    });
    const photo = await useXbarStore
      .getState()
      .uploadHorseMedia({ horseId: 'existing', files: [new File(['synthetic'], 'qa.png', { type: 'image/png' })] });
    for (const result of [horse, document, photo]) {
      assert.equal(result.ok, false);
      assert.match(result.message, /Settings|wait|setup/i);
    }
    assert.deepEqual(useXbarStore.getState().exportWorkspaceBackup().workspace, before);
    assert.deepEqual(requests, [], 'no capacity, auth, Storage or database request');
  });
}
test('verified same-ranch offline edits and intentional signed-out device-only horse entry remain available', () => {
  useCloudStore.setState({ syncState: 'error', syncMessage: 'Offline' });
  assert.equal(useXbarStore.getState().addHorse(input).ok, true);
  useCloudStore.setState({
    session: null,
    status: 'signed-out',
    autosaveReady: false,
    autosaveUnlocked: false,
    workspaceId: '',
  });
  rememberRecordsOwner('local');
  assert.equal(useXbarStore.getState().addHorse(input).ok, true);
});
