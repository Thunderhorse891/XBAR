import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { registerHooks } from 'node:module';

// Exercise the real store, identity checks, quota check and Storage helpers.
// Only the provider and device vault are controlled; this is not hosted proof.
registerHooks({
  resolve(specifier, context, next) {
    if (/\/supabaseClient(?:\.[tj]s)?$/.test(specifier))
      return { url: new URL('./fixtures/cloudSubscriptionClient.mjs', import.meta.url).href, shortCircuit: true };
    if (/\/localFileVault(?:\.[tj]s)?$/.test(specifier)) {
      const original = next(specifier, context).url;
      return {
        url: `data:text/javascript;base64,${Buffer.from(`export * from ${JSON.stringify(`${original}?upload-original`)}; export const storeLocalFile=async()=>{if(globalThis.__uploadOutcome.failLocal)throw new Error('Synthetic device quota');return 'synthetic-local-file'};`).toString('base64')}`,
        shortCircuit: true,
      };
    }
    return next(specifier, context);
  },
});
const { setCloudSubscriptionClient } = await import('./fixtures/cloudSubscriptionClient.mjs');
const { supabaseConfig } = await import('../../src/lib/platformConfig.ts');
const { createEmptyWorkspaceState, createHorseRecord } = await import('../../src/store/xbarStoreHelpers.ts');
const { useXbarStore } = await import('../../src/store/useXbarStore.ts');
const { useCloudStore } = await import('../../src/store/useCloudStore.ts');
const { rememberRecordsOwner } = await import('../../src/lib/recordsOwner.ts');
const { confirmUploadedRecordReferences } = await import('../../src/lib/cloudWorkspace.ts');
await new Promise((resolve) => setImmediate(resolve));
const workspace = '11111111-1111-4111-8111-111111111111';
const storage = new Map();
globalThis.window = { localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem() {}, removeItem() {} } });
let f;
beforeEach(() => {
  f = globalThis.__uploadOutcome = { calls: [], failStorage: false, failCapacity: false, failLocal: false };
  storage.clear();
  Object.assign(supabaseConfig, { url: 'https://synthetic.invalid', anonKey: 'fixture', relationalSyncEnabled: true });
  setCloudSubscriptionClient({
    auth: {
      getSession: async () => {
        if (f.failAuthAfterMetadata && f.calls.some((call) => call.type === 'metadata-read'))
          throw new Error('Synthetic auth read failed');
        return { data: { session: { user: { id: f.sessionUser ?? 'synthetic-user' } } }, error: null };
      },
    },
    from(table) {
      assert.ok(['workspaces', 'documents', 'horses'].includes(table));
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in(_column, ids) {
          this.ids = ids;
          return this;
        },
        abortSignal() {
          return this;
        },
        async maybeSingle() {
          return { data: { id: f.serverWorkspace ?? workspace }, error: null };
        },
        then(resolve, reject) {
          f.calls.push({ type: 'metadata-read', table, ids: this.ids });
          if (f.hangMetadata) return new Promise(() => {});
          const rows = f.pendingMetadata
            ? []
            : table === 'documents'
              ? useXbarStore
                  .getState()
                  .documents.filter((d) => this.ids.includes(d.id))
                  .map((d) => ({ document_id: d.id, payload: d }))
              : useXbarStore
                  .getState()
                  .horses.filter((h) => this.ids.includes(h.id))
                  .map((h) => ({ horse_id: h.id, payload: h }));
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name, params) {
      f.calls.push({ type: 'capacity', name, params });
      return { data: 0, error: f.failCapacity ? { message: 'Synthetic private capacity error' } : null };
    },
    storage: {
      from: (bucket) => ({
        async upload(path, file) {
          f.calls.push({ type: 'storage', bucket, path, name: file.name });
          return {
            data: f.failStorage || f.missingStorageAck ? null : { path },
            error: f.failStorage
              ? { statusCode: '403', message: 'Synthetic private Storage error', error: 'Unauthorized' }
              : null,
          };
        },
      }),
    },
  });
  useCloudStore.setState({
    status: 'signed-in',
    session: { user: { id: 'synthetic-user' } },
    workspaceId: workspace,
    workspaceReady: true,
    autosaveReady: true,
    autosaveUnlocked: true,
    workspaceRole: 'Admin',
    stagedStorageBytes: 0,
  });
  rememberRecordsOwner(workspace);
  const empty = createEmptyWorkspaceState();
  const horse = createHorseRecord(
    {
      name: 'Synthetic upload horse',
      barnName: '',
      sex: 'Mare',
      segment: 'Sale Prospect',
      status: 'Pasture',
      owner: 'Synthetic owner',
      ownerEntity: 'Synthetic entity',
      barn: 'Synthetic barn',
      pasture: '',
    },
    empty.workspaceProfile,
  );
  horse.id = 'horse-synthetic';
  useXbarStore.setState({ ...empty, currentRole: 'Admin', horses: [horse] });
});
const intake = () =>
  useXbarStore.getState().createDocumentIntake({
    files: [new File(['Synthetic test record. No verified facts.'], 'synthetic-record.txt', { type: 'text/plain' })],
    horseId: 'horse-synthetic',
    source: 'Manual Upload',
    uploadedBy: 'Synthetic QA',
  });
const photo = () =>
  useXbarStore.getState().uploadHorseMedia({
    horseId: 'horse-synthetic',
    files: [new File(['Synthetic image bytes, not a visual fixture'], 'synthetic.png', { type: 'image/png' })],
    kind: 'Conformation',
    makePrimary: true,
  });

test('acknowledged same-ranch binding reaches both real Storage helpers and records their paths', async () => {
  const documentResult = await intake();
  const photoResult = await photo();
  assert.equal(documentResult.ok, true);
  assert.equal(photoResult.ok, true);
  assert.equal(documentResult.cloudSaved, true);
  assert.equal(photoResult.cloudSaved, true);
  const writes = f.calls.filter((x) => x.type === 'storage');
  assert.deepEqual(
    writes.map((x) => x.bucket),
    ['horse-documents', 'horse-media'],
  );
  for (const write of writes) assert.ok(write.path.startsWith(`${workspace}/`));
  assert.equal(useXbarStore.getState().documents[0].storagePath, writes[0].path);
  assert.equal(useXbarStore.getState().horses[0].gallery[0].storagePath, writes[1].path);
  assert.equal(useXbarStore.getState().horses[0].gallery[0].status, 'Pending');
});
test('Storage refusal retains document bytes but explicitly warns that the original is device-only', async () => {
  f.failStorage = true;
  const result = await intake();
  assert.equal(result.ok, true, 'keep intentional device recovery');
  assert.equal(result.warning, true, 'a local fallback must not present a normal success');
  assert.match(result.message, /1 file saved on this device only/i);
  assert.doesNotMatch(result.message, /Synthetic private/);
  assert.equal(useXbarStore.getState().documents[0].localFileKey, 'synthetic-local-file');
  assert.equal(useXbarStore.getState().documents[0].storagePath, undefined);
});
test('unreadable capacity declines the Storage write and reports device-only retention', async () => {
  f.failCapacity = true;
  const result = await intake();
  assert.equal(result.ok, true);
  assert.equal(result.warning, true);
  assert.match(result.message, /device only/i);
  assert.equal(f.calls.filter((x) => x.type === 'storage').length, 0);
});
test('a file stored nowhere is a warning, with no fabricated cloud path', async () => {
  f.failStorage = f.failLocal = true;
  const result = await intake();
  assert.equal(result.warning, true);
  assert.match(result.message, /metadata only/i);
  assert.equal(useXbarStore.getState().documents[0].storagePath, undefined);
  assert.equal(useXbarStore.getState().documents[0].localFileKey, undefined);
});
test('photo Storage refusal returns failure and never adds an unusable photo', async () => {
  f.failStorage = true;
  const result = await photo();
  assert.equal(result.ok, false);
  assert.match(result.message, /no image was stored/i);
  assert.equal(useXbarStore.getState().horses[0].gallery.length, 0);
});

test('intentional device-only intake remains a normal completion and identifies where originals are kept', async () => {
  Object.assign(supabaseConfig, { url: '', anonKey: '' });
  setCloudSubscriptionClient(null);
  useCloudStore.setState({ status: 'signed-out', session: null, workspaceId: '' });
  rememberRecordsOwner('local');
  const result = await intake();
  assert.equal(result.ok, true);
  assert.equal(result.warning, false, 'intentional local work is not a failed cloud upload');
  assert.match(result.message, /1 file saved on this device only/i);
  assert.equal(useXbarStore.getState().documents[0].localFileKey, 'synthetic-local-file');
  assert.deepEqual(f.calls, []);
});

test('Storage without an acknowledgement cannot fabricate a usable original', async () => {
  f.missingStorageAck = true;
  const result = await intake();
  assert.equal(result.cloudSaved, false);
  assert.equal(result.warning, true);
  assert.equal(useXbarStore.getState().documents[0].storagePath, undefined);
  assert.equal((await photo()).ok, false);
  assert.deepEqual(useXbarStore.getState().horses[0].gallery, []);
});

test('metadata failure keeps the same upload references pending; read retry never uploads a second copy', async () => {
  f.pendingMetadata = true;
  const result = await intake();
  assert.equal(result.ok, true, 'retain the staged record for ordinary autosave retry');
  assert.equal(result.cloudSaved, false);
  assert.equal(result.warning, true);
  assert.match(result.message, /cloud records are not confirmed/i);
  const document = useXbarStore.getState().documents[0];
  const stored = f.calls.filter((call) => call.type === 'storage');
  assert.equal(stored.length, 1);
  f.pendingMetadata = false;
  assert.equal(
    await confirmUploadedRecordReferences({
      identity: { userId: 'synthetic-user', workspaceId: workspace },
      kind: 'documents',
      records: [{ id: document.id, storagePath: document.storagePath }],
    }),
    true,
  );
  assert.equal(useXbarStore.getState().documents.length, 1);
  assert.equal(f.calls.filter((call) => call.type === 'storage').length, 1);
  assert.equal(useXbarStore.getState().documents[0].storagePath, stored[0].path);
});

test('metadata confirmation refuses another account or workspace before reading any record', async () => {
  const params = {
    identity: { userId: 'synthetic-user', workspaceId: workspace },
    kind: 'photos',
    records: [{ id: 'horse-synthetic', storagePath: `${workspace}/horses/synthetic.png` }],
  };
  f.sessionUser = 'other-user';
  assert.equal(await confirmUploadedRecordReferences(params), false);
  f.sessionUser = 'synthetic-user';
  f.serverWorkspace = '22222222-2222-4222-8222-222222222222';
  assert.equal(await confirmUploadedRecordReferences(params), false);
  assert.deepEqual(f.calls, []);
});

test('an uploaded photo without its relational reference is pending, never cloud-saved', async () => {
  f.pendingMetadata = true;
  const result = await photo();
  assert.equal(result.ok, true);
  assert.equal(result.cloudSaved, false);
  assert.equal(result.warning, true);
  assert.match(result.message, /horse record cloud save is not confirmed/i);
  assert.equal(f.calls.filter((call) => call.type === 'storage').length, 1);
  assert.equal(useXbarStore.getState().horses[0].gallery.length, 1);
});

test('confirmation auth failure cannot relabel an already retained upload as a failed intake', async () => {
  f.failAuthAfterMetadata = true;
  const result = await intake();
  assert.equal(result.ok, true);
  assert.equal(result.cloudSaved, false);
  assert.equal(result.warning, true);
  assert.equal(useXbarStore.getState().documents.length, 1);
  assert.equal(f.calls.filter((call) => call.type === 'storage').length, 1);
});

test('a stalled metadata read has a bounded pending result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  f.hangMetadata = true;
  const pending = confirmUploadedRecordReferences({
    identity: { userId: 'synthetic-user', workspaceId: workspace },
    kind: 'photos',
    records: [{ id: 'horse-synthetic', storagePath: `${workspace}/horses/synthetic.png` }],
  });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(5000);
  assert.equal(await pending, false);
});

test('Documents renders a persistent alert and warning toast for device-only originals', async () => {
  const { renderRoute, nodes } = await import('../helpers/recordWorkflowHarness.mjs');
  const route = await renderRoute('Documents', {
    createDocumentIntake: async () => ({ ok: true, warning: true, message: '1 file saved on this device only.' }),
  });
  nodes(route.tree, (n) => n.type === 'input' && n.props.type === 'file')[0].props.onChange({
    target: { files: [new File(['synthetic'], 'synthetic.txt')] },
  });
  route.render();
  await nodes(route.tree, (n) => n.type === 'button' && n.props.children === 'Add docs')[0].props.onClick();
  route.render();
  const alert = nodes(route.tree, (n) => n.props.role === 'alert');
  assert.match(JSON.stringify(alert), /Upload needs attention/);
  assert.match(JSON.stringify(alert), /saved on this device only/);
  assert.ok(route.calls.some(([kind, toast]) => kind === 'toast' && toast.tone === 'warning'));
  assert.equal(
    route.calls.some(([kind, toast]) => kind === 'toast' && toast.tone === 'success'),
    false,
  );
});

test('a rejected photo picker ticket explains the refusal without calling the uploader', async () => {
  const { renderRoute, nodes } = await import('../helpers/recordWorkflowHarness.mjs');
  let uploads = 0;
  const route = await renderRoute(
    'AnimalProfile',
    {
      uploadHorseMedia: async () => {
        uploads++;
      },
    },
    '',
    {
      photoSelection: { ticket: { generation: 1 }, consume: () => null },
    },
  );
  const dialog = nodes(route.tree, (n) => n.type === 'HorsePhotoSourceDialog')[0];
  assert.ok(dialog);
  dialog.props.onFilesSelected([new File(['synthetic'], 'synthetic.png', { type: 'image/png' })]);
  assert.equal(uploads, 0);
  assert.ok(
    route.calls.some(
      ([kind, toast]) => kind === 'toast' && toast.tone === 'warning' && /Reopen Add Photo/.test(toast.message),
    ),
  );
});
