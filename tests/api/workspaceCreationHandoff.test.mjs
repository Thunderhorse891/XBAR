import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);

async function setupFixture({ configured = true } = {}) {
  const f = {
    owner: 'account:signup-user',
    workspace: {
      workspaceProfile: {
        businessName: 'Synthetic QA',
        ranchName: 'Synthetic ranch',
        ranchManagerName: '',
        operationsEmail: '',
        defaultOwnerName: '',
        defaultOwnerEntity: '',
        defaultBarn: '',
        defaultPasture: '',
      },
      documents: [],
      expenseReceipts: [],
      salePacketBuilds: [],
    },
    cloud: {
      status: 'signed-in',
      session: { user: { id: 'signup-user' } },
      workspaceId: '',
      workspaceReady: true,
      autosaveReady: true,
      autosaveUnlocked: true,
    },
    published: [],
    navigated: [],
    configured,
  };
  f.cloud.setWorkspaceAccessProfile = (id) => {
    f.published.push({ id, owner: f.owner });
    f.cloud.workspaceId = id;
  };
  f.cloud.setLastSyncAt = () => {};
  f.cloud.setAutosaveReady = (ready, unlocked) => {
    f.cloud.autosaveReady = ready;
    f.cloud.autosaveUnlocked = unlocked;
  };
  f.cloud.setSyncState = () => {};
  f.store = {
    workspaceProfile: f.workspace.workspaceProfile,
    exportWorkspaceBackup: () => structuredClone({ workspace: f.workspace }),
    initializeWorkspace: () => ({
      ok: !f.initializationDenied,
      message: f.initializationDenied ? 'Setup denied' : 'Created',
    }),
  };
  globalThis.__setupFixture = f;
  globalThis.window = {
    localStorage: {
      getItem: () => f.owner,
      setItem: (_key, value) => {
        f.owner = value;
      },
    },
  };
  const result = await build({
    entryPoints: ['src/routes/SetupWorkspace.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    jsx: 'automatic',
    plugins: [
      {
        name: 'setup-fixture',
        setup(b) {
          b.onResolve({ filter: /^(react(?:-router-dom|\/jsx-runtime)?$|@\/|.*\.css$)/ }, ({ path }) => {
            if (path === '@/lib/recordsOwner' || path === '@/lib/cloudSyncPolicy' || path === '@/lib/localFileVault')
              return;
            return { path, namespace: 'fixture' };
          });
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            const modules = {
              react: 'export const useState=(v)=>[v,()=>{}];export const useMemo=(fn)=>fn();',
              'react/jsx-runtime': 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;',
              'react-router-dom':
                'export const useNavigate=()=>p=>f.navigated.push(p);export const useLocation=()=>({});export const useSearchParams=()=>[new URLSearchParams()];export const Navigate=()=>null;',
              '@/components/BrandMark': 'export const XbarMark=()=>null;',
              '@/lib/billingRoutes': 'export const billingPathForTier=()=>"/billing";',
              '@/lib/workspaceSetupDefaults': 'export const applyWorkspaceProfileDefaults=v=>v;',
              '@/lib/cloudWorkspace':
                'export const saveWorkspaceBackupToCloud=()=>new Promise(resolve=>{f.resolveSave=resolve});',
              '@/lib/platformConfig':
                'export const isStaticPreviewHost=()=>true;export const isSupabaseConfigured=()=>f.configured;',
              '@/lib/nativePlatform': 'export const canPresentPurchaseFlow=()=>true;',
              '@/store/useCloudStore':
                'export const useCloudStore=fn=>fn(f.cloud);useCloudStore.getState=()=>f.cloud;useCloudStore.subscribe=fn=>{f.observeCloud=fn;return ()=>{f.observeCloud=null}};',
              '@/store/useUiStore': 'export const useUiStore=fn=>fn({pushToast:()=>{}});',
              '@/store/useXbarStore':
                'export const useWorkspaceHydrated=()=>true;export const useWorkspaceReady=()=>false;export const useXbarStore=fn=>fn(f.store);',
            };
            if (path.endsWith('.css')) return { contents: '' };
            if (!modules[path]) throw new Error(`Unmocked setup dependency: ${path}`);
            return { contents: 'const f=globalThis.__setupFixture;' + modules[path] };
          });
        },
      },
    ],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  const tree = mod.exports.default();
  const findForm = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'form') return node;
    for (const child of [node.props?.children].flat()) {
      const form = findForm(child);
      if (form) return form;
    }
  };
  f.submit = () => findForm(tree).props.onSubmit({ preventDefault() {} });
  const findQuick = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'button' && node.props.children === 'Use preview defaults') return node;
    for (const child of [node.props?.children].flat()) {
      const found = findQuick(child);
      if (found) return found;
    }
  };
  f.quick = () => findQuick(tree).props.onClick();
  return f;
}

test('confirmed initial setup publishes the workspace only after binding its saved device records', async () => {
  const f = await setupFixture();
  const pending = f.submit();
  assert.equal(f.owner, 'account:signup-user', 'a pending request proves no cloud write');
  assert.equal(f.cloud.autosaveUnlocked, false, 'ordinary autosave is paused while initial setup is pending');
  f.resolveSave({ ok: true, workspaceId: 'created-ranch', message: 'Saved' });
  await pending;
  assert.deepEqual(f.published, [{ id: 'created-ranch', owner: 'created-ranch' }]);
  assert.deepEqual(f.navigated, ['/']);
  assert.equal(f.cloud.autosaveUnlocked, false, 'ordinary reconciliation must settle before entry');
});

for (const mode of [
  'failed-save',
  'other-account',
  'other-workspace',
  'other-records-owner',
  'changed-records',
  'local-file',
]) {
  test(`setup ownership handoff refuses ${mode}`, async () => {
    const f = await setupFixture();
    if (mode === 'local-file') f.workspace.documents.push({ id: 'synthetic-doc', localFileKey: 'private-original' });
    const pending = f.submit();
    if (mode === 'other-account') f.cloud.session = { user: { id: 'different-user' } };
    if (mode === 'other-workspace') f.cloud.workspaceId = 'different-ranch';
    if (mode === 'other-records-owner') f.owner = 'another-ranch';
    if (mode === 'changed-records') f.workspace.horses = [{ id: 'new-edit' }];
    const before = f.owner;
    f.resolveSave?.({ ok: mode !== 'failed-save', workspaceId: 'created-ranch', message: 'Save result' });
    await pending;
    assert.equal(f.owner, before, 'must not relabel unverified records or referenced file bytes');
    assert.deepEqual(f.published, [], 'an unresolved save must not publish the workspace');
    assert.deepEqual(f.navigated, []);
  });
}

for (const entry of ['submit', 'quick']) {
  test(`${entry}: intentional device-only setup needs no cloud acknowledgement`, async () => {
    const f = await setupFixture({ configured: false });
    f.cloud.session = null;
    f.cloud.status = 'unavailable';
    f.owner = 'local';
    await f[entry]();
    assert.deepEqual(f.navigated, ['/']);
    assert.equal(f.resolveSave, undefined);
    assert.equal(f.owner, 'local');
  });
  test(`${entry}: refused local initialization cannot begin a cloud write or navigate`, async () => {
    const f = await setupFixture();
    f.initializationDenied = true;
    await f[entry]();
    assert.deepEqual(f.navigated, []);
    assert.equal(f.resolveSave, undefined);
  });
  for (const outcome of [
    'success',
    'failure',
    'stale-account',
    'account-roundtrip',
    'missing-id',
    'unknown-history',
    'blocked-marker-write',
  ]) {
    test(`${entry}: ${outcome} cannot enable unacknowledged entry`, async () => {
      const f = await setupFixture();
      if (outcome === 'unknown-history') {
        f.owner = 'local';
        f.workspace.horses = [{ id: 'private-device-horse' }];
      }
      const pending = f[entry]();
      assert.deepEqual(f.navigated, [], 'entry waits for the cloud acknowledgement');
      if (outcome === 'stale-account') f.cloud.session = { user: { id: 'other-user' } };
      if (outcome === 'account-roundtrip') {
        f.cloud.session = { user: { id: 'other-user' } };
        f.observeCloud(f.cloud);
        f.cloud.session = { user: { id: 'signup-user' } };
        f.observeCloud(f.cloud);
      }
      if (outcome === 'blocked-marker-write')
        globalThis.window.localStorage.setItem = () => {
          throw new Error('Storage blocked');
        };
      f.resolveSave?.({
        ok: outcome !== 'failure',
        workspaceId: outcome === 'missing-id' ? undefined : 'created-ranch',
        message: 'Save result',
      });
      await pending;
      if (outcome === 'success') {
        assert.deepEqual(f.published, [{ id: 'created-ranch', owner: 'created-ranch' }]);
        assert.deepEqual(f.navigated, ['/']);
      } else {
        assert.deepEqual(f.navigated, []);
        assert.deepEqual(f.published, []);
      }
      if (outcome === 'unknown-history')
        assert.equal(f.resolveSave, undefined, 'unknown history must not be sent to the cloud');
    });
  }
}
