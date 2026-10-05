import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
async function fixture() {
  const f = {
    effects: [],
    loads: [],
    timers: new Map(),
    listeners: {},
    now: 0,
    id: 0,
    calls: [],
    states: [],
    backup: { workspace: { value: 1 } },
  };
  f.cloud = {
    status: 'signed-in',
    session: { user: { id: 'user-a' } },
    workspaceId: 'ranch-a',
    workspaceReady: true,
    autosaveReady: true,
    autosaveUnlocked: true,
    stagedStorageBytes: 0,
    syncState: 'idle',
    setSyncState: (...args) => {
      f.cloud.syncState = args[0];
      f.states.push(args);
    },
    setLastSyncAt() {},
    setWorkspaceAccessProfile() {},
    settleStagedStorageBytes() {},
  };
  f.store = { exportWorkspaceBackup: () => structuredClone(f.backup) };
  f.save = (backup, options) => new Promise((resolve, reject) => f.calls.push({ backup, options, resolve, reject }));
  globalThis.__autosaveFixture = f;
  const result = await build({
    entryPoints: ['src/components/CloudBootstrap.tsx'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'controlled-autosave',
        setup(b) {
          b.onResolve({ filter: /^(react|@\/)/ }, ({ path }) => ({ path, namespace: 'fixture' }));
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            const prefix = 'const f=globalThis.__autosaveFixture;';
            const modules = {
              react: 'export const useEffect=(fn)=>f.effects.push(fn); export const useRef=(v)=>({current:v});',
              '@/lib/authBootstrap': 'export const createLatestWriteGate=()=>({});',
              '@/lib/cloudDeletionQueue':
                'export const pendingCloudDeletions=()=>[]; export const acknowledgeCloudDeletions=()=>{};',
              '@/lib/cloudWorkspace':
                'export const saveWorkspaceBackupToCloud=(...args)=>f.save(...args); export const loadWorkspaceBackupFromCloud=()=>new Promise(resolve=>f.loads.push(resolve));',
              '@/lib/cloudSubscription':
                'export const mergeCloudSubscription=()=>{};export const withCloudSubscription=()=>{};',
              '@/store/xbarStoreHelpers': 'export const restorePersistedState=(value)=>value;',
              '@/lib/cloudSyncPolicy':
                'export const serializeWorkspaceBackup=(v)=>JSON.stringify(v);export const decideCloudReconciliation=()=>{};export const getWorkspacePayload=(v)=>v.workspace;',
              '@/lib/workspacePromotion': 'export const promoteLocalVaultFiles=()=>{};',
              '@/lib/vaultOwner': 'export const vaultOwnerId=()=>"local";',
              '@/store/useCloudStore':
                'export const useCloudStore=(fn)=>fn(f.cloud);useCloudStore.getState=()=>f.cloud;useCloudStore.subscribe=(fn)=>{f.cloudChange=fn;return ()=>{f.cloudChange=()=>{}}};',
              '@/store/useUiStore': 'export const useUiStore=(fn)=>fn({pushToast:()=>{}});',
              '@/store/useXbarStore':
                'export const useXbarStore=(fn)=>fn(f.store);useXbarStore.setState=(v)=>{f.backup={workspace:v};f.change();};useXbarStore.subscribe=(fn)=>{f.change=fn;return ()=>{f.change=()=>{}}};export const useWorkspaceHydrated=()=>true;',
            };
            return { contents: prefix + modules[path] };
          });
        },
      },
    ],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mod, mod.exports);
  globalThis.window = {
    setInterval() {
      return ++f.id;
    },
    clearInterval() {},
    setTimeout(fn, delay) {
      const id = ++f.id;
      f.timers.set(id, { fn, at: f.now + delay });
      return id;
    },
    clearTimeout(id) {
      f.timers.delete(id);
    },
    addEventListener(name, fn) {
      f.listeners[name] = fn;
    },
    removeEventListener(name) {
      delete f.listeners[name];
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  f.tick = async (ms) => {
    f.now += ms;
    for (const [id, t] of [...f.timers])
      if (t.at <= f.now) {
        f.timers.delete(id);
        t.fn();
      }
    await new Promise((resolve) => setImmediate(resolve));
  };
  mod.exports.CloudBootstrap();
  f.dispose = f.effects.at(-1)();
  f.startRefresh = () => f.effects.at(-2)();
  f.edit = (value) => {
    f.backup.workspace.value = value;
    f.change();
  };
  return f;
}

test('an edit whose debounce expires during a save is sent afterwards without another edit', async () => {
  const f = await fixture();
  await f.tick(1600);
  assert.equal(f.calls.length, 1);
  f.edit(2);
  await f.tick(1600);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  await f.tick(1600);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].backup.workspace.value, 2);
  assert.notEqual(f.states.at(-1)[0], 'idle');
  f.dispose();
});

test('a returned failure retries without requiring an edit or online event', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: false, message: 'Unavailable' });
  await f.tick(0);
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.dispose();
});

test('a rejected save releases the queue and retries', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].reject(new Error('Transport failed'));
  await f.tick(0);
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.dispose();
});

test('success reports Saved only after the newest version is acknowledged', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.edit(2);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'syncing');
  await f.tick(1600);
  f.calls[1].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'idle');
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.dispose();
});

test('offline edits retry and online notification resumes without changing data', async () => {
  const f = await fixture();
  navigator.onLine = false;
  await f.tick(1600);
  assert.equal(f.calls.length, 0);
  navigator.onLine = true;
  f.listeners.online();
  await f.tick(1600);
  assert.equal(f.calls.length, 1);
  f.dispose();
});

test('a replaced workspace or account cannot receive late save status or another retry', async () => {
  for (const replacement of [
    { workspaceId: 'ranch-b' },
    { session: { user: { id: 'user-b' } } },
    { autosaveUnlocked: false },
  ]) {
    const f = await fixture();
    await f.tick(1600);
    Object.assign(f.cloud, replacement);
    const previous = f.states.length;
    f.calls[0].resolve({ ok: true, message: 'Wrong context saved' });
    await f.tick(0);
    await f.tick(30000);
    assert.equal(f.states.length, previous);
    assert.equal(f.calls.length, 1);
    f.dispose();
  }
});

test('disposal clears queued retries and ignores an in-flight completion', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.edit(2);
  f.dispose();
  const previous = f.states.length;
  f.calls[0].resolve({ ok: false, message: 'Unavailable' });
  await f.tick(30000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.states.length, previous);
});

test('snapshot exceptions do not escape the retry queue', async () => {
  const f = await fixture();
  const value = {};
  value.self = value;
  f.backup = value;
  await f.tick(1600);
  assert.equal(f.calls.length, 0);
  assert.equal(f.states.at(-1)[0], 'error');
  f.backup = { workspace: { value: 2 } };
  await f.tick(30000);
  assert.equal(f.calls.length, 1);
  f.dispose();
});

test('a failed post-save snapshot inspection remains retryable rather than stranding error status', async () => {
  const f = await fixture();
  await f.tick(1600);
  assert.deepEqual(f.calls[0].options.expectedContext, { userId: 'user-a', workspaceId: 'ranch-a' });
  const value = {};
  value.self = value;
  f.backup = value;
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'error');
  f.backup = { workspace: { value: 1 } };
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'idle');
  f.dispose();
});

test('clean focus refresh installs teammate records without echo-saving them', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  assert.equal(f.loads.length, 1);
  f.loads[0]({ ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } });
  await f.tick(0);
  await f.tick(1600);
  assert.equal(f.backup.workspace.value, 2);
  assert.equal(f.calls.length, 1);
  stop();
  f.dispose();
});

test('focus refresh cannot replace an edit made while the remote read is pending', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.edit(3);
  f.loads[0]({ ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 3);
  stop();
  f.dispose();
});

test('focus refresh is read-only on failure and refuses replaced workspace context', async () => {
  for (const changed of [false, true]) {
    const f = await fixture();
    await f.tick(1600);
    f.calls[0].resolve({ ok: true, message: 'Saved' });
    await f.tick(0);
    const stop = f.startRefresh();
    f.listeners.focus();
    await f.tick(0);
    if (changed) f.cloud.workspaceId = 'other';
    f.loads[0](
      changed
        ? { ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } }
        : { ok: false, message: 'Incomplete cloud load' },
    );
    await f.tick(0);
    assert.equal(f.backup.workspace.value, 1);
    stop();
    f.dispose();
  }
});

test('a workspace or role round trip invalidates an in-flight refresh', async () => {
  for (const key of ['workspaceId', 'workspaceRole']) {
    const f = await fixture();
    await f.tick(1600);
    f.calls[0].resolve({ ok: true, message: 'Saved' });
    await f.tick(0);
    const stop = f.startRefresh();
    f.listeners.focus();
    await f.tick(0);
    const original = { ...f.cloud };
    f.cloud[key] = 'other';
    f.cloudChange(f.cloud, original);
    const interim = { ...f.cloud };
    f.cloud[key] = original[key];
    f.cloudChange(f.cloud, interim);
    f.loads[0]({ ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } });
    await f.tick(0);
    assert.equal(f.backup.workspace.value, 1);
    stop();
    f.dispose();
  }
});

test('a throwing snapshot on focus refresh is handled and a later focus can recover', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  const circular = {};
  circular.self = circular;
  f.backup = circular;
  f.listeners.focus();
  await f.tick(0);
  assert.equal(f.loads.length, 0);
  f.backup = { workspace: { value: 1 } };
  f.listeners.focus();
  await f.tick(0);
  assert.equal(f.loads.length, 1);
  stop();
  f.dispose();
});

test('normalized empty remote histories cannot erase this workspace’s local packet references', async () => {
  const f = await fixture();
  f.backup.workspace.auditEvents = [{ id: 'audit-a' }];
  f.backup.workspace.salePacketBuilds = [{ id: 'packet-a', localFileKey: 'file-a' }];
  f.backup.workspace.buyerRoomEvents = [{ id: 'buyer-a' }];
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.loads[0]({
    ok: true,
    source: 'relational',
    workspaceId: 'ranch-a',
    backup: { workspace: { value: 2, auditEvents: [], salePacketBuilds: [], buyerRoomEvents: [] } },
  });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 2);
  assert.deepEqual(f.backup.workspace.salePacketBuilds, [{ id: 'packet-a', localFileKey: 'file-a' }]);
  assert.equal(f.backup.workspace.auditEvents.length, 1);
  assert.equal(f.backup.workspace.buyerRoomEvents.length, 1);
  stop();
  f.dispose();
});

test('live refresh never installs a successful but stale device recovery snapshot', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.loads[0]({ ok: true, source: 'snapshot', backup: { workspace: { value: 99 } } });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 1);
  stop();
  f.dispose();
});

test('live refresh refuses a relational response for a different ranch', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.loads[0]({ ok: true, source: 'relational', workspaceId: 'other-ranch', backup: { workspace: { value: 99 } } });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 1);
  stop();
  f.dispose();
});
