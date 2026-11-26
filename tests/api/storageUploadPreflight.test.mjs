import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    if (/\/(cloudWorkspace|platformConfig)(?:\.ts|\.js)?$/.test(specifier)) {
      const original = next(specifier, context).url;
      const overrides = specifier.includes('cloudWorkspace')
        ? `export const loadWorkspaceStorageBytes = (...args) => globalThis.__quotaRead(...args);
           export const uploadMediaAssetToCloud = (...args) => globalThis.__quotaUpload(...args);
           export const uploadDocumentAssetToCloud = (...args) => globalThis.__quotaUpload(...args);`
        : 'export const isSupabaseConfigured = () => globalThis.__quotaCloud;';
      const source = `export * from ${JSON.stringify(`${original}?quota-original`)}; ${overrides}`;
      return { url: `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
const { createEmptyWorkspaceState, createHorseRecord } = await import('../../src/store/xbarStoreHelpers.ts');
const { useXbarStore } = await import('../../src/store/useXbarStore.ts');
const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
const { installFakeIndexedDb } = await import('../helpers/fakeIndexedDb.ts');
const { readLocalFile, listLocalFiles } = await import('../../src/lib/localFileVault.ts');
await new Promise((done) => setImmediate(done));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
const GB = 1024 ** 3;
let uploaded = [];
let usageReads = [];
const file = () => new File(['xx'], 'tiny.jpg', { type: 'image/jpeg' });
const photo = () => useXbarStore.getState().uploadHorseMedia({ horseId: 'horse-a', files: [file()] });
const receipt = () =>
  useXbarStore.getState().addExpenseReceipt({
    title: 'Receipt',
    category: 'Feed',
    vendor: 'Test',
    amount: 1,
    receiptDate: '2026-11-12',
    uploadedBy: 'Test',
    notes: '',
    file: file(),
  });
beforeEach((context) => {
  context.mock.method(console, 'error', () => {});
  globalThis.__quotaCloud = true;
  uploaded = [];
  usageReads = [];
  globalThis.__quotaRead = async (identity) => {
    usageReads.push(identity);
    return 0;
  };
  globalThis.__quotaUpload = async (params) => {
    uploaded.push(params);
    return { storagePath: `workspace-a/unique-${uploaded.length}` };
  };
  useCloudStore.setState({
    session: { user: { id: 'user-a' } },
    workspaceId: 'workspace-a',
    workspaceRole: 'Admin',
    stagedStorageBytes: 0,
  });
  const empty = createEmptyWorkspaceState();
  const horse = createHorseRecord(
    {
      name: 'Horse',
      barnName: '',
      sex: 'Mare',
      segment: 'Sale Prospect',
      status: 'Pasture',
      owner: 'Test',
      ownerEntity: 'Test',
      barn: '',
      pasture: '',
    },
    empty.workspaceProfile,
  );
  horse.id = 'horse-a';
  useXbarStore.setState({ ...empty, horses: [horse], currentRole: 'Admin' });
});
for (const [label, run] of [
  ['photo', photo],
  ['receipt', receipt],
]) {
  test(`${label}: exact authoritative usage rejects a two-byte file with one byte left despite empty cache`, async () => {
    globalThis.__quotaRead = async () => GB - 1;
    const result = await run();
    assert.equal(result.ok, false);
    assert.match(result.message, /Storage limit/);
    assert.equal(uploaded.length, 0);
  });
  test(`${label}: exact fit succeeds and accounts for every byte without rounding`, async () => {
    globalThis.__quotaRead = async () => GB - 2;
    assert.equal((await run()).ok, true);
    assert.equal(uploaded.length, 1);
    assert.equal(useXbarStore.getState().subscription.usage.storageUsedGb * GB, 2);
  });
  test(`${label}: workspace change during authoritative preflight refuses upload`, async () => {
    globalThis.__quotaRead = async () => {
      useCloudStore.setState({ workspaceId: 'workspace-b' });
      return 0;
    };
    assert.equal((await run()).ok, false);
    assert.equal(uploaded.length, 0);
  });
}
test('photo: unavailable authoritative usage never falls back to the cached zero', async () => {
  globalThis.__quotaRead = async () => {
    throw Error('offline');
  };
  const result = await photo();
  assert.equal(result.ok, false);
  assert.match(result.message, /could not be verified/);
  assert.equal(uploaded.length, 0);
});
test('receipt: unavailable usage retains the original in its device vault without cloud quota charge', async () => {
  const restore = installFakeIndexedDb();
  try {
    globalThis.__quotaRead = async () => {
      throw Error('offline');
    };
    const result = await receipt();
    assert.equal(result.ok, true);
    assert.equal(uploaded.length, 0);
    const saved = useXbarStore.getState().expenseReceipts[0];
    assert.equal(await (await readLocalFile(saved.localFileKey)).blob.text(), 'xx');
    assert.equal(useXbarStore.getState().subscription.usage.storageUsedGb, 0);
  } finally {
    restore();
  }
});
test('authoritative object totals are not charged a second time through staged bytes', async () => {
  globalThis.__quotaRead = async () => GB - 2;
  useCloudStore.setState({ stagedStorageBytes: 1000 });
  assert.equal((await photo()).ok, true);
});
test('cloud preflight is bound to the original account and workspace', async () => {
  assert.equal((await photo()).ok, true);
  assert.deepEqual(usageReads, [{ userId: 'user-a', workspaceId: 'workspace-a' }]);
});

test('document intake reads the pending original once and allows an exact fit despite staged bookkeeping', async () => {
  globalThis.__quotaRead = async () => GB - 2;
  useCloudStore.setState({ stagedStorageBytes: 1000 });
  const result = await useXbarStore.getState().createDocumentIntake({
    files: [new File(['xx'], 'manual.txt', { type: 'text/plain' })],
    source: 'Manual Upload',
    uploadedBy: 'Test',
    createHorseFromBatch: false,
  });
  assert.equal(result.ok, true);
  assert.equal(uploaded.length, 1);
  assert.equal(useXbarStore.getState().documents.length, 1);
});
test('successive two-byte receipt uploads preserve four bytes in the cache', async () => {
  assert.equal((await receipt()).ok, true);
  assert.equal((await receipt()).ok, true);
  assert.equal(useXbarStore.getState().subscription.usage.storageUsedGb * GB, 4);
});

for (const [label, run] of [
  ['receipt', receipt],
  [
    'document',
    () =>
      useXbarStore.getState().createDocumentIntake({
        files: [new File(['xx'], 'manual.txt', { type: 'text/plain' })],
        source: 'Manual Upload',
        uploadedBy: 'Test',
        createHorseFromBatch: false,
      }),
  ],
])
  test(`${label}: pending reserved upload retains local original and reveals recovery instead of claiming cloud success`, async () => {
    const { ReservedUploadError } = await import('../../src/lib/reservedUploadClient.ts');
    const restore = installFakeIndexedDb();
    try {
      globalThis.__quotaUpload = async () => {
        throw new ReservedUploadError('Completion remains pending.', {
          requestId: '33333333-3333-4333-8333-333333333333',
          target: { userId: 'user-a', workspaceId: 'workspace-a' },
          bucket: 'horse-documents',
          kind: label,
          fileName: 'manual.txt',
          contentType: 'text/plain',
          sizeBytes: 2,
          state: 'pending',
          originalRetention: 'reselect',
          completionStarted: true,
        });
      };
      const result = await run();
      assert.equal(result.ok, true);
      assert.match(result.message, /Settings, Unfinished uploads/);
      const saved =
        label === 'receipt' ? useXbarStore.getState().expenseReceipts[0] : useXbarStore.getState().documents[0];
      assert.equal(saved.storagePath, undefined);
      assert.equal(await (await readLocalFile(saved.localFileKey)).blob.text(), 'xx');
      assert.equal(useXbarStore.getState().subscription.usage.storageUsedGb, 0);
    } finally {
      restore();
    }
  });
test('media: uncertain completion reveals its reservation rather than asserting no image was stored', async () => {
  const { ReservedUploadError } = await import('../../src/lib/reservedUploadClient.ts');
  globalThis.__quotaUpload = async () => {
    throw new ReservedUploadError('Completion remains pending.', {
      requestId: '33333333-3333-4333-8333-333333333333',
      target: { userId: 'user-a', workspaceId: 'workspace-a' },
      bucket: 'horse-media',
      kind: 'media',
      fileName: 'photo.jpg',
      contentType: 'image/jpeg',
      sizeBytes: 2,
      state: 'pending',
      originalRetention: 'reselect',
      completionStarted: true,
    });
  };
  const result = await photo();
  assert.equal(result.ok, false);
  assert.match(result.message, /Recovery ID: 33333333/);
  assert.match(result.message, /Settings, Unfinished uploads/);
  assert.doesNotMatch(result.message, /no image was stored/);
  assert.equal(useXbarStore.getState().horses[0].gallery.length, 0);
});

test('document fallback after a workspace switch retains bytes for the original owner without installing a replacement record', async () => {
  const restore = installFakeIndexedDb();
  try {
    globalThis.__quotaUpload = async () => {
      useCloudStore.setState({ session: { user: { id: 'user-b' } }, workspaceId: 'workspace-b' });
      throw Error('Upload response lost after account switch');
    };
    const result = await useXbarStore.getState().createDocumentIntake({
      files: [new File(['original bytes'], 'manual.txt', { type: 'text/plain' })],
      source: 'Manual Upload',
      uploadedBy: 'Test',
      createHorseFromBatch: false,
    });
    assert.equal(result.ok, false);
    assert.equal(useXbarStore.getState().documents.length, 0);
    const retained = await listLocalFiles();
    assert.equal(retained.length, 1);
    assert.equal(retained[0].workspaceId, 'workspace-a');
    assert.equal(await (await readLocalFile(retained[0].key)).blob.text(), 'original bytes');
    assert.equal(useXbarStore.getState().subscription.usage.storageUsedGb, 0);
  } finally {
    restore();
  }
});

for (const [code, status, details] of [
  ['upload_file_too_large', 413, { maxFileBytes: 1 }],
  ['upload_shared_capacity_reached', 507, {}],
  ['upload_shared_capacity_unavailable', 503, {}],
])
  for (const kind of ['document', 'receipt'])
    test(`${kind}: verified ${code} refusal retains the same-owner local original without reserved-capacity or recovery claims`, async () => {
      const { startReservedUpload } = await import('../../src/lib/reservedUploadClient.ts');
      const restore = installFakeIndexedDb();
      const workspaceId = '11111111-1111-4111-8111-111111111111';
      const userId = '22222222-2222-4222-8222-222222222222';
      const requestId = '33333333-3333-4333-8333-333333333333';
      const journal = new Map();
      const requests = [];
      useCloudStore.setState({ workspaceId, session: { user: { id: userId } } });
      try {
        globalThis.__quotaUpload = async ({ file, expectedIdentity }) =>
          startReservedUpload(
            {
              file,
              target: expectedIdentity,
              kind,
              bucket: 'horse-documents',
            },
            {
              projectUrl: 'https://original.supabase.co',
              apiUrl: 'https://app.example/api/storage/uploads',
              createRequestId: () => requestId,
              identity: async () => ({ ...expectedIdentity, accessToken: 'synthetic-token' }),
              journal: {
                async get(id) {
                  return journal.get(id) ?? null;
                },
                async put(record) {
                  journal.set(record.requestId, { ...record });
                },
              },
              fetch: async (_url, options) => {
                requests.push(JSON.parse(options.body));
                return Response.json(
                  {
                    ok: false,
                    code,
                    requestId,
                    needsRecovery: false,
                    uploadOutcome: 'not_started',
                    message: 'Cloud upload admission was refused. No cloud upload was started.',
                    ...details,
                  },
                  { status },
                );
              },
            },
          );
        const result =
          kind === 'receipt'
            ? await receipt()
            : await useXbarStore.getState().createDocumentIntake({
                files: [new File(['xx'], 'manual.txt', { type: 'text/plain' })],
                source: 'Manual Upload',
                uploadedBy: 'Test',
                createHorseFromBatch: false,
              });
        assert.equal(result.ok, true, 'local record intake succeeds, not a cloud upload');
        assert.match(result.message, /No cloud upload was started/);
        assert.doesNotMatch(result.message, /Unfinished uploads|pending storage|stays reserved|Recovery ID/);
        const saved =
          kind === 'receipt' ? useXbarStore.getState().expenseReceipts[0] : useXbarStore.getState().documents[0];
        assert.equal(saved.storagePath, undefined);
        const original = await readLocalFile(saved.localFileKey);
        assert.equal(await original.blob.text(), 'xx');
        assert.equal(original.workspaceId, workspaceId);
        assert.equal(useXbarStore.getState().subscription.usage.storageUsedGb, 0);
        assert.equal(journal.get(requestId).state, 'not_started');
        assert.deepEqual(
          requests.map((request) => request.action),
          ['create'],
        );
      } finally {
        restore();
      }
    });
test('media: verified no-start refusal reports the limit, not a phantom reserved upload', async () => {
  const { ReservedUploadError } = await import('../../src/lib/reservedUploadClient.ts');
  globalThis.__quotaUpload = async () => {
    throw new ReservedUploadError(
      'This file exceeds the current cloud upload limit of 50 MB (50,000,000 bytes). No cloud upload was started.',
      {
        requestId: '33333333-3333-4333-8333-333333333333',
        target: { userId: 'user-a', workspaceId: 'workspace-a' },
        bucket: 'horse-media',
        kind: 'media',
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        sizeBytes: 50_000_001,
        state: 'not_started',
        originalRetention: 'reselect',
      },
      'upload_file_too_large',
    );
  };
  const result = await photo();
  assert.equal(result.ok, false);
  assert.match(result.message, /50 MB/);
  assert.match(result.message, /No cloud upload was started/);
  assert.doesNotMatch(result.message, /Unfinished uploads|pending|reserved|Recovery ID/);
  assert.equal(useXbarStore.getState().horses[0].gallery.length, 0);
});
