import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
export async function cloudBootstrapFixture(configure) {
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
              '@/lib/platformConfig': 'export const isRelationalCloudEnabled=()=>f.relational!==false;',
              '@/lib/authBootstrap': 'export const createLatestWriteGate=()=>({});',
              '@/lib/cloudDeletionQueue':
                'export const pendingCloudDeletions=()=>[]; export const acknowledgeCloudDeletions=()=>{};',
              '@/lib/cloudWorkspace':
                'export const saveWorkspaceBackupToCloud=(...args)=>f.save(...args); export const loadWorkspaceBackupFromCloud=(...args)=>f.load ? f.load(...args) : new Promise(resolve=>f.loads.push(resolve));',
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
  configure?.(f);
  mod.exports.CloudBootstrap();
  f.dispose = f.effects.at(-1)();
  f.startRefresh = () => f.effects.at(-2)();
  f.edit = (value) => {
    f.backup.workspace.value = value;
    f.change();
  };
  return f;
}
