import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { build } from 'esbuild';
import { createEmptyWorkspaceState, createHorseRecord } from '../../src/store/xbarStoreHelpers.ts';
const require = createRequire(import.meta.url);

async function renderRoute(name, changes = {}, params = '') {
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
    slots: [],
    effects: [],
    dirty: false,
    cursor: 0,
  };
  f.state.addRanchAsset = () => {
    f.calls.push(['unexpected-create']);
    return { ok: true };
  };
  f.ui = { openQuickCreate: (x) => f.calls.push(['create', x]), pushToast: (x) => f.calls.push(['toast', x]) };
  globalThis.__recordWorkflowFixture = f;
  const sourcePath = resolve(process.env.RECORD_WORKFLOW_BASE ?? '.', `src/routes/${name}.tsx`);
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
                /^(react$|react-router-dom$|@\/store\/useXbarStore$|@\/store\/useUiStore$|@\/hooks\/|@\/components\/)/,
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
                'export const useXbarStore=(fn)=>fn(f.state); useXbarStore.getState=()=>f.state; export const useHorseRecord=()=>f.state.horses.find(h=>h.id===f.horse.id);export const useCurrentRoleCapability=()=>f.state.currentRole==="Admin";';
            else if (path === '@/store/useUiStore') code = 'export const useUiStore=(fn)=>fn(f.ui);';
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
      f.tree = mod.exports.default();
      f.effects.splice(0).forEach((run) => run());
      if (!f.dirty) return f.tree;
    }
    throw new Error('Unsettled route effects');
  };
  f.render();
  return f;
}
function nodes(tree, predicate) {
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
function action(f, label) {
  const matches = nodes(f.tree, (n) => n.props.children === label && typeof n.props.onClick === 'function');
  assert.ok(matches.length, `Missing action ${label}`);
  matches[0].props.onClick();
}

test('Equipment Add opens the existing form without creating a placeholder record', async () => {
  const f = await renderRoute('Equipment');
  action(f, 'Add Equipment');
  assert.deepEqual(f.calls, [['create', { action: 'Add Equipment' }]]);
});
test('Equipment filters asset category and opens the selected existing asset', async () => {
  const asset = (id, category) => ({
    id,
    name: id,
    category,
    location: 'West',
    condition: 'Excellent',
    status: 'Available',
  });
  const f = await renderRoute('Equipment', {
    ranchAssets: [asset('tractor', 'Equipment'), asset('medical', 'Medical Kit')],
  });
  assert.equal(nodes(f.tree, (n) => n.props.children === 'medical').length, 0);
  action(f, 'Open details');
  assert.deepEqual(f.calls, [['navigate', '/assets?asset=tractor']]);
});
test('Open Group passes the canonical Young Stock filter and excludes archived horses', async () => {
  const f = await renderRoute('HerdGroups');
  f.state.horses = [
    ...f.state.horses,
    { ...f.horse, id: 'archived', segment: 'Broodmare', archive: { id: 'archive' } },
  ];
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Broodmare').length, 0);
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Open Group').length, 1);
  action(f, 'Open Group');
  assert.deepEqual(f.calls, [['navigate', '/horses?segment=Young+Stock']]);
});
test('horse profile preserves its horse for document upload and packet creation', async () => {
  const f = await renderRoute('AnimalProfile');
  action(f, 'Upload Doc');
  action(f, 'Build Sale Packet');
  assert.deepEqual(f.calls, [
    ['navigate', '/documents?horse=horse-context&from=profile&upload=1'],
    ['navigate', '/sale-packets?horse=horse-context'],
  ]);
});
test('Young Stock URL is a real roster filter, not an unrecognized value falling back to All', async () => {
  const f = await renderRoute('Horses', {}, 'segment=Young+Stock');
  const tabs = nodes(f.tree, (n) => n.type === 'SurfaceTabs' && n.props.active === 'Young Stock');
  assert.equal(tabs.length, 1);
});

test('Equipment category selection changes the visible records and preserves the URL filter', async () => {
  const asset = (id, category) => ({
    id,
    name: id,
    category,
    location: 'West',
    condition: 'Excellent',
    status: 'Available',
  });
  const f = await renderRoute('Equipment', {
    ranchAssets: [asset('tractor', 'Equipment'), asset('trailer', 'Transport')],
  });
  const select = nodes(f.tree, (n) => n.type === 'select')[0];
  select.props.onChange({ target: { value: 'Transport' } });
  f.render();
  assert.equal(f.params, 'category=Transport');
  assert.equal(nodes(f.tree, (n) => n.props.children === 'tractor').length, 0);
  action(f, 'Open details');
  assert.deepEqual(f.calls, [['navigate', '/assets?asset=trailer']]);
});

test('asset details initialize from the requested asset rather than the first record', async () => {
  const asset = (id, location) => ({
    id,
    name: id,
    category: 'Equipment',
    location,
    condition: 'Excellent',
    status: 'Available',
    assignedTo: '',
    nextService: '2026-12-01',
    notes: '',
  });
  const f = await renderRoute(
    'RanchAssets',
    { ranchAssets: [asset('first', 'East'), asset('requested', 'West')] },
    'asset=requested',
  );
  assert.equal(nodes(f.tree, (n) => n.type === 'select' && n.props.value === 'requested').length, 1);
  assert.equal(nodes(f.tree, (n) => n.type === 'input' && n.props.value === 'West').length, 1);
  assert.equal(nodes(f.tree, (n) => n.type === 'input' && n.props.value === 'East').length, 0);
});

test('roles without asset management see disabled creation and no repair mutation', async () => {
  const f = await renderRoute('Equipment', {
    currentRole: 'Owner',
    ranchAssets: [
      { id: 'tractor', name: 'Tractor', category: 'Equipment', condition: 'Service Soon', location: 'West' },
    ],
  });
  const create = nodes(f.tree, (n) => n.props.children === 'Add Equipment')[0];
  assert.equal(create.props.disabled, true);
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Mark Repaired').length, 0);
});

test('same-route unavailable asset clears the old editor and later hydration opens only the requested record', async () => {
  const asset = (id, location) => ({
    id,
    name: id,
    category: 'Equipment',
    location,
    condition: 'Excellent',
    status: 'Available',
    assignedTo: '',
    nextService: '',
    notes: '',
  });
  const f = await renderRoute('RanchAssets', { ranchAssets: [asset('a', 'East')] }, 'asset=a');
  f.params = 'asset=missing';
  f.render();
  assert.equal(nodes(f.tree, (n) => n.type === 'input' && n.props.value === 'East').length, 0);
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Save asset changes')[0].props.disabled, true);
  f.state.ranchAssets = [...f.state.ranchAssets, asset('missing', 'West')];
  f.render();
  assert.equal(nodes(f.tree, (n) => n.type === 'select' && n.props.value === 'missing').length, 1);
  assert.equal(nodes(f.tree, (n) => n.type === 'input' && n.props.value === 'West').length, 1);
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Save asset changes')[0].props.disabled, false);
});
