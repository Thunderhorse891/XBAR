import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if (/\/cloudWorkspace(?:\.ts|\.js)?$/.test(specifier)) {
      const original = next(specifier, context).url;
      const source = `export * from ${JSON.stringify(`${original}?receipt-original`)};
        export const uploadDocumentAssetToCloud = (...args) => globalThis.__receiptUpload(...args);`;
      return { url: `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const { createEmptyWorkspaceState } = await import('../../src/store/xbarStoreHelpers.ts');
const { useXbarStore } = await import('../../src/store/useXbarStore.ts');
const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
const { installFakeIndexedDb } = await import('../helpers/fakeIndexedDb.ts');
const { listLocalFiles, readLocalFile } = await import('../../src/lib/localFileVault.ts');
await new Promise((done) => setImmediate(done));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });

const input = () => ({
  title: 'Synthetic feed receipt',
  category: 'Feed',
  vendor: 'Synthetic supplier',
  amount: 25,
  receiptDate: '2026-11-07',
  uploadedBy: 'Synthetic',
  notes: '',
  file: new File(['receipt bytes'], 'receipt.txt', { type: 'text/plain' }),
});
const identity = (userId = 'user-a', workspaceId = 'workspace-a') => {
  useCloudStore.setState({
    session: userId ? { user: { id: userId } } : null,
    workspaceId,
    workspaceRole: 'Admin',
    workspaceReady: true,
    autosaveReady: true,
    autosaveUnlocked: true,
  });
};
beforeEach(() => {
  identity();
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin' });
  globalThis.__receiptUpload = async () => ({ storagePath: 'workspace-a/original.txt' });
});

for (const [name, change] of [
  ['workspace switch', () => identity('user-a', 'workspace-b')],
  ['account switch', () => identity('user-b', 'workspace-a')],
  ['sign out', () => identity('', null)],
  ['role loss', () => useXbarStore.setState({ currentRole: 'Medical Lead' })],
  ['server role loss', () => useCloudStore.setState({ workspaceRole: 'Viewer' })],
])
  test(`receipt ${name} during cloud upload cannot modify replacement records`, async () => {
    globalThis.__receiptUpload = async () => {
      change();
      return { storagePath: 'workspace-a/original.txt' };
    };
    const before = useXbarStore.getState().subscription.usage.storageUsedGb;
    const result = await useXbarStore.getState().addExpenseReceipt(input());
    assert.equal(result.ok, false);
    assert.equal(useXbarStore.getState().expenseReceipts.length, 0);
    assert.equal(useXbarStore.getState().subscription.usage.storageUsedGb, before);
  });

test('a removed horse cannot receive a receipt from an already running upload', async () => {
  useXbarStore.setState({ horses: [{ id: 'horse-a' }] });
  globalThis.__receiptUpload = async () => {
    useXbarStore.setState({ horses: [] });
    return { storagePath: 'workspace-a/original.txt' };
  };
  assert.equal((await useXbarStore.getState().addExpenseReceipt({ ...input(), horseId: 'horse-a' })).ok, false);
  assert.equal(useXbarStore.getState().expenseReceipts.length, 0);
});

test('records belonging to another workspace refuse a receipt before upload', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let calls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: { getItem: () => 'workspace-b' } },
  });
  globalThis.__receiptUpload = async () => {
    calls++;
    return { storagePath: 'workspace-a/original.txt' };
  };
  try {
    assert.equal((await useXbarStore.getState().addExpenseReceipt(input())).ok, false);
    assert.equal(calls, 0);
    assert.equal(useXbarStore.getState().expenseReceipts.length, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  }
});

test('receipt passes its original identity into the cloud storage authorization fence', async () => {
  let uploaded;
  globalThis.__receiptUpload = async (params) => {
    uploaded = params;
    return { storagePath: 'workspace-a/original.txt' };
  };
  assert.equal((await useXbarStore.getState().addExpenseReceipt(input())).ok, true);
  assert.deepEqual(uploaded.expectedIdentity, { userId: 'user-a', workspaceId: 'workspace-a' });
  assert.equal(useXbarStore.getState().expenseReceipts.length, 1);
  assert.equal(useXbarStore.getState().expenseReceipts[0].storagePath, 'workspace-a/original.txt');
});

test('a refused cloud upload after switching workspace never files the receipt in the new local vault', async () => {
  const restore = installFakeIndexedDb();
  try {
    globalThis.__receiptUpload = async () => {
      identity('user-a', 'workspace-b');
      return null;
    };
    assert.equal((await useXbarStore.getState().addExpenseReceipt(input())).ok, false);
    assert.equal((await listLocalFiles()).length, 0);
    assert.equal(useXbarStore.getState().expenseReceipts.length, 0);
  } finally {
    restore();
  }
});

test('workspace change during device persistence retains original-owner bytes without committing into the new workspace', async () => {
  const restore = installFakeIndexedDb({
    failWrites: () => {
      identity('user-a', 'workspace-b');
      return false;
    },
  });
  try {
    globalThis.__receiptUpload = async () => null;
    assert.equal((await useXbarStore.getState().addExpenseReceipt(input())).ok, false);
    const files = await listLocalFiles();
    assert.equal(files.length, 1);
    assert.equal(files[0].workspaceId, 'workspace-a');
    assert.equal(await (await readLocalFile(files[0].key)).blob.text(), 'receipt bytes');
    assert.equal(useXbarStore.getState().expenseReceipts.length, 0);
  } finally {
    restore();
  }
});

test('unchanged local identity keeps the original receipt readable and records exactly once', async () => {
  const restore = installFakeIndexedDb();
  try {
    identity('', null);
    globalThis.__receiptUpload = async () => null;
    assert.equal((await useXbarStore.getState().addExpenseReceipt(input())).ok, true);
    const [receipt] = useXbarStore.getState().expenseReceipts;
    assert.equal(useXbarStore.getState().expenseReceipts.length, 1);
    const file = await readLocalFile(receipt.localFileKey);
    assert.equal(file.workspaceId, 'local');
    assert.equal(await file.blob.text(), 'receipt bytes');
  } finally {
    restore();
  }
});
