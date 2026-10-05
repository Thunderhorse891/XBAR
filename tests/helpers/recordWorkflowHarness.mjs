import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { createEmptyWorkspaceState, createHorseRecord } from '../../src/store/xbarStoreHelpers.ts';
const require = createRequire(import.meta.url);

export async function renderRoute(name, changes = {}, params = '', options = {}) {
  const empty = createEmptyWorkspaceState();
  const horse = createHorseRecord(
    {
      name: 'Young Horse',
      barnName: '',
      segment: 'Young Stock',
      sex: 'Filly',
      status: 'Pasture',
      owner: 'Test',
      ownerEntity: 'Test',
      barn: 'West',
      pasture: '',
    },
    empty.workspaceProfile,
  );
  horse.id = 'horse-context';
  const f = {
    state: { ...empty, horses: [horse], currentRole: 'Admin', ...changes },
    horse,
    params,
    calls: [],
    cloud: { session: null, workspaceId: null, workspaceRole: 'Admin', ...options.cloud },
    receipt: null,
    slots: [],
    effects: [],
    dirty: false,
    cursor: 0,
  };
  f.state.addRanchAsset ??= () => {
    f.calls.push(['unexpected-create']);
    return { ok: true };
  };
  f.ui = {
    openQuickCreate: (x) => f.calls.push(['create', x]),
    closeQuickCreate: () => {
      f.calls.push(['close']);
      f.ui.quickCreate = null;
    },
    pushToast: (x) => f.calls.push(['toast', x]),
    ...options.ui,
  };
  globalThis.__recordWorkflowFixture = f;
  const sourcePath = resolve(
    process.env.RECORD_WORKFLOW_BASE ?? '.',
    name.includes('/') ? `src/${name}.tsx` : `src/routes/${name}.tsx`,
  );
  const source = await readFile(sourcePath, 'utf8');
  const componentNames = new Set(['default']);
  for (const match of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]@\/components\//g)) {
    for (const name of match[1].split(',').map((x) => x.trim())) componentNames.add(name);
  }
  const out = await build({
    stdin: { contents: source, sourcefile: sourcePath, resolveDir: process.cwd(), loader: 'tsx' },
    bundle: true,
    jsx: 'automatic',
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    plugins: [
      {
        name: 'controlled-route-boundaries',
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(react$|react-router-dom$|@\/store\/useXbarStore$|@\/store\/useUiStore$|@\/store\/useCloudStore$|@\/lib\/workspaceStorage$|@\/hooks\/|@\/components\/)/,
            },
            ({ path }) => ({ path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => {
            const prefix = 'const f=globalThis.__recordWorkflowFixture;';
            let code;
            if (path === 'react')
              code = `export const useMemo=(fn,deps)=>{const i=f.cursor++;const prev=f.slots[i];if(!prev||deps.some((v,j)=>v!==prev.deps[j]))f.slots[i]={deps,value:fn()};return f.slots[i].value};
                export const useRef=(v)=>{const i=f.cursor++;return f.slots[i]??=({current:v})};
                export const useEffect=(fn,deps)=>{const i=f.cursor++;const prev=f.slots[i];if(!prev||deps.some((v,j)=>v!==prev[j])){f.slots[i]=deps;f.effects.push(fn)}};
                export const useState=(initial)=>{const i=f.cursor++;if(!(i in f.slots))f.slots[i]=typeof initial==="function"?initial():initial;return [f.slots[i],(v)=>{const next=typeof v==="function"?v(f.slots[i]):v;f.dirty ||= next!==f.slots[i];f.slots[i]=next}]};`;
            else if (path === 'react-router-dom')
              code =
                'export const useNavigate=()=>((p)=>f.calls.push(["navigate",p])); export const useParams=()=>({id:f.horse.id}); export const useSearchParams=()=>{if(f.searchText!==f.params){f.searchText=f.params;f.searchValue=new URLSearchParams(f.params)}return [f.searchValue,(p)=>{f.params=p.toString()}]};export const Link="a";';
            else if (path === '@/store/useXbarStore')
              code =
                'export const useXbarStore=(fn)=>fn(f.state); useXbarStore.getState=()=>f.state;useXbarStore.subscribe=()=>()=>{}; export const useHorseRecord=()=>f.state.horses.find(h=>h.id===f.horse.id);export const useCurrentRoleCapability=()=>f.state.currentRole==="Admin";';
            else if (path === '@/store/useCloudStore')
              code =
                'export const useCloudStore=(fn)=>fn(f.cloud);useCloudStore.getState=()=>f.cloud;useCloudStore.subscribe=()=>()=>{};';
            else if (path === '@/store/useUiStore')
              code = 'export const useUiStore=(fn)=>fn(f.ui);useUiStore.getState=()=>f.ui;';
            else if (path === '@/lib/workspaceStorage') code = 'export const getWorkspacePersistReceipt=()=>f.receipt;';
            else if (path.startsWith('@/hooks/'))
              code =
                'export const useEffectiveSubscription=()=>f.state.subscription;export const useHorseMediaUrl=(_p,src)=>src;export const useHorsePhotoSelection=()=>({});export const useHorseArchiveActions=()=>({});';
            else
              code = [...componentNames]
                .filter((x) => x !== 'default')
                .map((x) => `export const ${x}=${JSON.stringify(x)};`)
                .join('');
            return { contents: prefix + code };
          });
          b.onResolve({ filter: /\.css$/ }, () => ({ path: 'empty', namespace: 'empty' }));
          b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' }));
        },
      },
    ],
  });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', out.outputFiles[0].text)(require, mod, mod.exports);
  f.render = () => {
    for (let pass = 0; pass < 10; pass++) {
      f.cursor = 0;
      f.dirty = false;
      f.tree = options.exportName
        ? mod.exports[options.exportName](options.props ?? {})
        : mod.exports.default
          ? mod.exports.default()
          : mod.exports[name.split('/').at(-1)]({
              horse: f.state.horses[0],
              onAdd: () => f.calls.push(['addPhotos']),
              uploading: false,
            });
      f.effects.splice(0).forEach((run) => run());
      if (!f.dirty) return f.tree;
    }
    throw new Error('Unsettled route effects');
  };
  f.render();
  return f;
}
export function nodes(tree, predicate) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node.props) {
      if (predicate(node)) found.push(node);
      Object.values(node.props).forEach(visit);
    }
  };
  visit(tree);
  return found;
}
export function action(f, label) {
  const matches = nodes(f.tree, (n) => n.props.children === label && typeof n.props.onClick === 'function');
  assert.ok(matches.length, `Missing action ${label}`);
  matches[0].props.onClick();
}
