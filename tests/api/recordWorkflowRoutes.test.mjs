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
