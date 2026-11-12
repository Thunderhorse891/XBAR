import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRoute, nodes } from '../helpers/recordWorkflowHarness.mjs';

function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}
function metric(f, label) {
  return text(
    nodes(f.tree, (n) => n.props.className === 'horse-card__metric' && text(n.props.children[0]) === label)[0]?.props
      .children[1],
  );
}
function kpi(f, label) {
  return text(
    nodes(f.tree, (n) => n.props.className?.includes('hc-kpi') && text(n.props.children[0]) === label)[0]?.props
      .children[1],
  );
}
const listing = (state) => ({
  id: 'listing',
  horseId: 'horse-context',
  state,
  sharePath: '/buyer/young-horse',
  accessMode: 'Private Token',
  shareToken: 'synthetic',
  tokenIssuedAt: '',
  channels: [],
  createdAt: '',
  updatedAt: '',
});

for (const [state, label, footer, live] of [
  ['Draft', 'Draft', 'Buyer packet staged', '0'],
  ['Live', 'Released', 'Buyer packet released', '1'],
  ['Archived', 'Private', '', '0'],
]) {
  test(`horse card reflects ${state} packet state without treating staging as release`, async () => {
    const f = await renderRoute('Horses', { sharedListings: [listing(state)] });
    assert.equal(metric(f, 'Release'), label);
    assert.equal(kpi(f, 'Buyer Packets Live'), live);
    const pills = nodes(f.tree, (n) => n.type === 'Pill').map(text);
    assert.equal(pills.includes('Buyer packet live'), false);
    if (footer) assert.ok(pills.includes(footer));
    else
      assert.equal(
        pills.some((x) => x.startsWith('Buyer packet ')),
        false,
      );
  });
}

test('insured value on a non-sale card never displays its asking price', async () => {
  const f = await renderRoute('Horses');
  f.state.horses = [{ ...f.horse, insuredValue: 12000, sale: { ...f.horse.sale, askPrice: 25000 } }];
  f.render();
  assert.equal(metric(f, 'Insured'), '$12K');
});

test('sale cards keep asking and insured value distinct, including a missing asking price', async () => {
  const f = await renderRoute('Horses');
  f.state.horses = [
    { ...f.horse, segment: 'Sale Prospect', insuredValue: 12000, sale: { ...f.horse.sale, askPrice: 25000 } },
  ];
  f.render();
  assert.equal(metric(f, 'Ask'), '$25K');
  f.state.horses = [{ ...f.state.horses[0], sale: { ...f.horse.sale, askPrice: 0 } }];
  f.render();
  assert.equal(metric(f, 'Insured'), '$12K');
});

test('ready-to-list overview uses the current release gate, not a legacy stored Ready flag', async () => {
  const f = await renderRoute('Horses');
  f.state.horses = [{ ...f.horse, readiness: { ...f.horse.readiness, packetStatus: 'Ready' } }];
  f.render();
  assert.equal(kpi(f, 'Ready to List'), '0');
});

test('horse card date-dependent readiness and document gaps refresh without editing the records', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 12, 12).getTime() });
  const f = await renderRoute('Horses', {}, '', {});
  f.state.horses = [{ ...f.horse, segment: 'Sale Prospect' }];
  f.state.documents = [
    {
      id: 'coggins',
      horseId: f.horse.id,
      title: 'Coggins',
      type: 'Coggins',
      state: 'Ready',
      confidence: 1,
      duplicateRisk: 'Low',
      entities: { examDate: '2025-11-12' },
      extractedTextPreview: '',
      summary: '',
    },
  ];
  f.render();
  const scoreBefore = nodes(f.tree, (n) => n.type === 'ProgressBar')[0].props.value;
  const gapsBefore = Number(kpi(f, 'Missing Documents'));
  t.mock.timers.setTime(new Date(2026, 10, 13, 12).getTime());
  f.dayKey = '2026-11-13';
  f.render();
  assert.equal(nodes(f.tree, (n) => n.type === 'ProgressBar')[0].props.value, scoreBefore - 20);
  assert.equal(Number(kpi(f, 'Missing Documents')), gapsBefore + 1);
});

test('a complete packet never shows release clear while ownership review blocks release', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 12, 12).getTime() });
  const f = await renderRoute('Horses');
  const horse = {
    ...f.horse,
    segment: 'Sale Prospect',
    alerts: [],
    gallery: [
      { kind: 'Hero', status: 'Approved' },
      { kind: 'Sale Still', status: 'Approved' },
    ],
    sale: { ...f.horse.sale, askPrice: 10000, socialReady: true },
  };
  f.state.horses = [horse];
  f.state.documents = ['Registration', 'Transfer Packet', 'Coggins', 'Vet Record', 'Media Kit'].map((type, i) => ({
    id: `d${i}`,
    type,
    horseId: horse.id,
    state: 'Ready',
    entities: { examDate: '2026-11-10' },
  }));
  f.state.ownershipRecords = [
    { id: 'owner', horseId: horse.id, transferStatus: 'Clear', pendingDocuments: [], proofRequirements: [] },
  ];
  f.render();
  const pills = nodes(f.tree, (n) => n.type === 'Pill').map(text);
  assert.ok(pills.includes('Needs Review'));
  assert.ok(!pills.includes('Readiness clear'));
  assert.ok(!pills.includes('Release clear'));
  assert.equal(kpi(f, 'Ready to List'), '0');
});
