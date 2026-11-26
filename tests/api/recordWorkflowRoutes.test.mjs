import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRoute, nodes, action } from '../helpers/recordWorkflowHarness.mjs';

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

test('breeding context-menu selection hydrates the selected horse economics before saving', async () => {
  const f = await renderRoute('Breeding');
  const horse = (id, fee) => ({
    ...f.horse,
    id,
    name: id,
    segment: 'Stud',
    breedingEconomics: {
      studFee: fee,
      bookedMares: 2,
      breedingCosts: 30,
      mareProductionValue: 40,
      foalProjectedValue: 50,
    },
  });
  f.state.horses = [horse('first', 100), horse('second', 900)];
  f.state.subscription = { ...f.state.subscription, tier: 'Enterprise', status: 'active' };
  f.state.updateBreedingEconomics = (id, economics) => {
    f.calls.push(['save', id, economics]);
    return { ok: true };
  };
  f.render();
  const select = () => nodes(f.tree, (n) => n.type === 'select')[0];
  select().props.onChange({ target: { value: 'first' } });
  f.render();
  const rows = nodes(f.tree, (n) => typeof n.props.onContextMenu === 'function');
  rows[1].props.onContextMenu({ preventDefault() {}, clientX: 0, clientY: 0 });
  f.render();
  nodes(f.tree, (n) => n.type === 'ContextMenu')[0]
    .props.items.find((i) => i.id === 'prepare-event')
    .onSelect();
  f.render();
  action(f, 'Save revenue model');
  assert.deepEqual(
    f.calls.find((c) => c[0] === 'save'),
    ['save', 'second', f.state.horses[1].breedingEconomics],
  );
});

test('breeding empty or removed selection never silently saves another horse', async () => {
  const f = await renderRoute('Breeding');
  f.state.horses = [
    { ...f.horse, id: 'first', segment: 'Stud' },
    { ...f.horse, id: 'second', segment: 'Stud' },
  ];
  f.state.subscription = { ...f.state.subscription, tier: 'Enterprise', status: 'active' };
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Save revenue model').length, 0);
  nodes(f.tree, (n) => n.type === 'select')[0].props.onChange({ target: { value: 'first' } });
  f.render();
  f.state.horses = f.state.horses.slice(1);
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Save revenue model').length, 0);
});

async function nativeCodeLogin() {
  const f = await renderRoute('Login', {}, '', {
    cloud: {
      status: 'signed-out',
      sendEmailCode: async () => ({ ok: true, message: 'Check your email for a sign-in code.' }),
      verifyEmailCode: async () => ({ ok: false, message: 'Synthetic code rejected.' }),
    },
    modules: {
      '@/store/useCloudStore':
        'export const useCloudStore=(fn)=>fn?fn(f.cloud):f.cloud;useCloudStore.getState=()=>f.cloud;',
      '@/hooks/useOwnerAccess': 'export const useOwnerAccess=()=>"denied";',
      '@/lib/platformConfig': 'export const isSupabaseConfigured=()=>true;',
      '@/lib/nativePlatform':
        'export const isNativeApp=()=>true;export const canPresentThirdPartySignIn=()=>false;export const canPresentPurchaseFlow=()=>false;export const publicSiteHref=(p)=>p;',
      '@/lib/runtimeEvents': 'export const trackRuntimeEvent=async()=>{};',
      '@/lib/authProviders': 'export const presentableOAuthProviders=()=>[];',
    },
  });
  nodes(f.tree, (n) => n.type === 'input' && n.props.type === 'email')[0].props.onChange({
    target: { value: 'rider@example.invalid' },
  });
  f.render();
  await nodes(f.tree, (n) => n.props.children === 'Email me a sign-in code')[0].props.onClick();
  await new Promise((done) => setImmediate(done));
  f.render();
  return f;
}

test('native code sign-in submits independently of the required password and stays recoverable on refusal', async () => {
  const f = await nativeCodeLogin();
  const codeForm = () => nodes(f.tree, (n) => n.type === 'form' && n.props['aria-label'] === 'Email code sign-in')[0];
  assert.ok(codeForm(), 'code verification needs its own submit path, outside password validation');
  assert.equal(nodes(codeForm(), (n) => n.type === 'input' && n.props.type === 'password').length, 0);
  const input = () => nodes(codeForm(), (n) => n.type === 'input' && n.props.autoComplete === 'one-time-code')[0];
  const label = nodes(codeForm(), (n) => n.type === 'label')[0];
  assert.equal(label.props.htmlFor, input().props.id);
  const submitted = [];
  let resolve;
  f.cloud.verifyEmailCode = (email, token) => {
    submitted.push([email, token]);
    return new Promise((done) => {
      resolve = done;
    });
  };
  let prevented = 0;
  codeForm().props.onSubmit({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(submitted.length, 0, 'empty code must not start verification');
  input().props.onChange({ target: { value: '123456' } });
  f.render();
  codeForm().props.onSubmit({
    preventDefault() {
      prevented++;
    },
  });
  f.render();
  codeForm().props.onSubmit({
    preventDefault() {
      prevented++;
    },
  });
  assert.equal(prevented, 3);
  assert.deepEqual(submitted, [['rider@example.invalid', '123456']], 'busy submit must not duplicate verification');
  resolve({ ok: false, message: 'Synthetic code rejected.' });
  await new Promise((done) => setImmediate(done));
  f.render();
  assert.equal(input().props.value, '123456', 'refusal keeps the entered code available to correct');
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert')[0].props.children, 'Synthetic code rejected.');
  assert.equal(nodes(codeForm(), (n) => n.type === 'button' && n.props.type === 'submit')[0].props.disabled, false);
});

test('setup cloud failure is announced, retains details and offers an independent retry', async () => {
  const f = await renderRoute('SetupWorkspace', {}, 'plan=Professional', {
    cloud: {
      status: 'signed-in',
      session: { user: { id: 'synthetic-rider' } },
      workspaceId: null,
      setSyncState() {},
      setLastSyncAt() {},
      setWorkspaceAccessProfile() {},
      saveWorkspace: async () => ({ ok: false, message: 'Synthetic connection interrupted.' }),
    },
    modules: {
      '@/store/useXbarStore':
        'export const useXbarStore=(fn)=>fn(f.state); export const useWorkspaceHydrated=()=>true;export const useWorkspaceReady=()=>Boolean(f.state.workspaceProfile.setupCompleteAt);',
      '@/lib/platformConfig': 'export const isSupabaseConfigured=()=>true;export const isStaticPreviewHost=()=>false;',
      '@/lib/cloudWorkspace': 'export const saveWorkspaceBackupToCloud=()=>f.cloud.saveWorkspace();',
    },
  });
  const originals = [];
  f.state.initializeWorkspace = (profile) => {
    originals.push(profile);
    f.state.workspaceProfile = { ...profile, setupCompleteAt: 'synthetic-time' };
    f.receipt = { name: 'xbar-live-workspace', completed: Promise.resolve(true) };
    return { ok: true, message: 'Created on this device.' };
  };
  f.state.exportWorkspaceBackup = () => ({ workspace: f.state.workspaceProfile });
  f.render();
  const field = (placeholder) => nodes(f.tree, (n) => n.type === 'input' && n.props.placeholder === placeholder)[0];
  field('XBAR LLC').props.onChange({ target: { value: 'Patient Rider LLC' } });
  f.render();
  field('Primary Ranch').props.onChange({ target: { value: 'Patient Ranch' } });
  f.render();
  const submit = () => nodes(f.tree, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  await submit();
  f.render();
  const alert = nodes(f.tree, (n) => n.props.role === 'alert' && n.props.className === 'clean-form-error')[0];
  assert.ok(alert, 'setup failure must be announced in its persistent form, not just a toast');
  assert.match(alert.props.children, /Synthetic connection interrupted/);
  assert.equal(alert.props.tabIndex, -1, 'the failure summary must be focusable without adding a tab stop');
  assert.equal(field('XBAR LLC').props.value, 'Patient Rider LLC');
  assert.equal(field('Primary Ranch').props.value, 'Patient Ranch');
  assert.equal(
    f.calls.some((c) => c[0] === 'navigate'),
    false,
  );
  let release;
  f.cloud.saveWorkspace = () =>
    new Promise((done) => {
      release = done;
    });
  const retry = submit();
  await new Promise((done) => setImmediate(done));
  f.render();
  assert.equal(
    nodes(f.tree, (n) => n.props.role === 'alert').length,
    0,
    'retry clears the previous failure while waiting',
  );
  assert.equal(
    nodes(f.tree, (n) => n.type === 'button' && n.props.children === 'Creating workspace...')[0].props.disabled,
    true,
  );
  release({ ok: true, workspaceId: 'synthetic-ranch', message: 'Saved.' });
  await retry;
  f.render();
  assert.deepEqual(originals[1], originals[0], 'retry preserves exact submitted details and derived owner defaults');
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'navigate'),
    [['navigate', '/billing?plan=Professional']],
  );
});
