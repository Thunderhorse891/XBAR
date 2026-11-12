import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { reservedUploadJournal, listReservedUploadRecovery } from '../../src/lib/reservedUploadJournal.ts';
import { installFakeIndexedDb } from '../helpers/fakeIndexedDb.ts';
const target = { userId: 'user-a', workspaceId: 'workspace-a' };
const record = (requestId) => ({
  requestId,
  target,
  bucket: 'horse-documents',
  kind: 'document',
  fileName: 'scan.txt',
  contentType: 'text/plain',
  sizeBytes: 2,
  state: 'prepared',
  originalRetention: 'reselect',
});
let saved;
let oldWindow;
beforeEach(() => {
  oldWindow = globalThis.window;
  saved = new Map();
  globalThis.window = {
    localStorage: {
      get length() {
        return saved.size;
      },
      key: (index) => [...saved.keys()][index] ?? null,
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  };
});
afterEach(() => {
  globalThis.window = oldWindow;
});

test('metadata persists without serializing original bytes or signed URLs', async () => {
  const original = new Blob(['xx']);
  await reservedUploadJournal.put({ ...record('metadata'), original });
  const raw = saved.get('xbar-upload-recovery:metadata');
  assert(!raw.includes('"original"'));
  assert(!raw.includes('http'));
  assert.equal((await reservedUploadJournal.get('metadata')).original, original);
});
test('lists recovery only for the pinned account and workspace, retaining completed records', async () => {
  await reservedUploadJournal.put(record('one'));
  await reservedUploadJournal.put({ ...record('two'), target: { ...target, userId: 'other' } });
  await reservedUploadJournal.put({ ...record('three'), target: { ...target, workspaceId: 'other' } });
  await reservedUploadJournal.put({ ...record('four'), state: 'completed' });
  assert.deepEqual(
    listReservedUploadRecovery(target).map((r) => r.requestId),
    ['one', 'four'],
  );
});
test('a silent localStorage write failure refuses durability', async () => {
  globalThis.window.localStorage.setItem = () => {};
  await assert.rejects(() => reservedUploadJournal.put(record('silent')), /persist/);
});
test('optional original retention survives a fresh metadata-only read', async () => {
  const restore = installFakeIndexedDb();
  try {
    const r = { ...record('retained'), originalRetention: 'device' };
    assert.equal(await reservedUploadJournal.retainOriginal(r, new Blob(['xx'])), true);
    await reservedUploadJournal.put(r);
    assert.equal(await (await reservedUploadJournal.get('retained')).original.text(), 'xx');
  } finally {
    restore();
  }
});
test('original quota failure is explicit and leaves metadata independently readable', async () => {
  const restore = installFakeIndexedDb({ abortOnCommit: true });
  try {
    const r = record('quota');
    await reservedUploadJournal.put(r);
    await assert.rejects(() => reservedUploadJournal.retainOriginal(r, new Blob(['xx'])));
    assert.equal((await reservedUploadJournal.get('quota')).state, 'prepared');
  } finally {
    restore();
  }
});
test('metadata-only recovery remains available when original retention cannot be read', async () => {
  const r = { ...record('unreadable'), originalRetention: 'device' };
  await reservedUploadJournal.put(r);
  assert.equal((await reservedUploadJournal.get('unreadable')).original, undefined);
});
