import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  canRestorePersistedState,
  createEmptyWorkspaceState,
  restorePersistedState,
} from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { buildSubscriptionForTier } from '../../src/lib/xbarRuntime.ts';

// Synthetic local records only; no external accounts, payments, or cloud writes.
await new Promise((resolve) => setImmediate(resolve));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
beforeEach(() => {
  useXbarStore.setState({
    ...createEmptyWorkspaceState(),
    currentRole: 'Admin',
    subscription: buildSubscriptionForTier(createEmptyWorkspaceState().subscription, 'Enterprise', {
      billingState: 'Active',
    }),
    salesLeads: [
      {
        id: 'sale',
        name: 'Buyer',
        stage: 'Closed',
        outcome: 'Won',
        offerAmount: 25000,
        depositAmount: 5000,
        depositStatus: 'Paid',
      },
    ],
  });
});
for (const amount of [0, 4000]) {
  test(`store refuses total ${amount} below a paid deposit without changing records`, () => {
    const before = useXbarStore.getState().salesLeads;
    const result = useXbarStore
      .getState()
      .updateSalesLead('sale', { amountReceived: amount, amountReceivedOn: '2026-05-01' });
    assert.equal(result.ok, false);
    assert.match(result.message, /paid deposit/);
    assert.deepEqual(useXbarStore.getState().salesLeads, before);
  });
}
test('store preserves an explicit correction to both deposit and total', () => {
  const result = useXbarStore
    .getState()
    .updateSalesLead('sale', { amountReceived: 4000, amountReceivedOn: '2026-05-01', depositAmount: 4000 });
  assert.equal(result.ok, true, result.message);
  assert.equal(useXbarStore.getState().salesLeads[0].amountReceived, 4000);
  assert.equal(useXbarStore.getState().salesLeads[0].depositAmount, 4000);
});
test('clearing the explicit total preserves the separately recorded deposit', () => {
  const result = useXbarStore
    .getState()
    .updateSalesLead('sale', { amountReceived: undefined, amountReceivedOn: undefined });
  assert.equal(result.ok, true, result.message);
  assert.equal(useXbarStore.getState().salesLeads[0].depositAmount, 5000);
});

test('correcting an incorrectly paid deposit permits a zero total', () => {
  const result = useXbarStore.getState().updateSalesLead('sale', { amountReceived: 0, depositStatus: 'Due' });
  assert.equal(result.ok, true, result.message);
  assert.equal(useXbarStore.getState().salesLeads[0].amountReceived, 0);
  assert.equal(useXbarStore.getState().salesLeads[0].depositStatus, 'Due');
});

test('a new buyer offer on a sold horse is refused without changing its receipt', () => {
  const historical = {
    ...useXbarStore.getState().salesLeads[0],
    horseId: 'horse',
    amountReceived: 25000,
    amountReceivedOn: '2026-05-01',
  };
  useXbarStore.setState({
    salesLeads: [historical],
    horses: [
      {
        id: 'horse',
        name: 'Synthetic horse',
        sale: { inquiryCount: 1 },
        activity: [],
        documents: [],
        health: {},
        breeding: {},
      },
    ],
    buyerRoomEvents: [
      { id: 'offer', horseId: 'horse', kind: 'offer', actor: 'Buyer', amount: 20000, at: '2026-10-04T12:00:00Z' },
    ],
  });
  const result = useXbarStore.getState().captureBuyerRoomOffer('offer');
  assert.equal(result.ok, false);
  assert.match(result.message, /already sold/);
  assert.deepEqual(useXbarStore.getState().salesLeads, [historical]);
});

test('restore refuses a future receipt before installing it; the actual store refuses it too', () => {
  const workspace = {
    ...createEmptyWorkspaceState(),
    salesLeads: [
      {
        id: 'receipt',
        name: 'Buyer',
        horseId: 'horse',
        channel: 'Site Inquiry',
        stage: 'Closed',
        lastTouch: '2026-05-01',
        offerAmount: 25000,
        amountReceived: 25000,
        amountReceivedOn: '9999-12-31',
      },
    ],
  };
  assert.equal(
    canRestorePersistedState({
      ...workspace,
      salesLeads: [{ ...workspace.salesLeads[0], amountReceivedOn: '2026-05-01' }],
    }),
    true,
  );
  assert.equal(canRestorePersistedState(workspace), false);
  const before = useXbarStore.getState().salesLeads;
  const result = useXbarStore
    .getState()
    .updateSalesLead('sale', { amountReceived: 25000, amountReceivedOn: '9999-12-31' });
  assert.equal(result.ok, false);
  assert.deepEqual(useXbarStore.getState().salesLeads, before);
});

test('direct cloud import refuses future receipts without replacing current records', () => {
  const before = useXbarStore.getState().exportWorkspaceBackup();
  const incoming = {
    ...before,
    workspace: {
      ...before.workspace,
      salesLeads: [{ ...before.workspace.salesLeads[0], amountReceived: 25000, amountReceivedOn: '9999-12-31' }],
    },
  };
  const result = useXbarStore.getState().importWorkspaceBackup(incoming);
  assert.equal(result.ok, false, 'a future receipt cannot enter through cloud import');
  assert.deepEqual(useXbarStore.getState().exportWorkspaceBackup().workspace, before.workspace);
});

test('local migration also refuses future receipt dates before they can age into valid payments', () => {
  const workspace = useXbarStore.getState().exportWorkspaceBackup().workspace;
  workspace.salesLeads = [{ ...workspace.salesLeads[0], amountReceived: 25000, amountReceivedOn: '9999-12-31' }];
  assert.throws(() => restorePersistedState(workspace), /future payment receipt/);
});

test('actual store records partial and full payments that survive export and import', () => {
  for (const amountReceived of [8000, 25000]) {
    const result = useXbarStore.getState().updateSalesLead('sale', { amountReceived, amountReceivedOn: '2026-05-01' });
    assert.equal(result.ok, true, result.message);
    const backup = useXbarStore.getState().exportWorkspaceBackup();
    useXbarStore.setState({ salesLeads: [] });
    assert.equal(useXbarStore.getState().importWorkspaceBackup(backup).ok, true);
    assert.equal(useXbarStore.getState().salesLeads[0].amountReceived, amountReceived);
    assert.equal(useXbarStore.getState().salesLeads[0].amountReceivedOn, '2026-05-01');
  }
});

test("a second direct Won update cannot replace a horse's recorded historical sale", () => {
  const first = {
    ...useXbarStore.getState().salesLeads[0],
    horseId: 'horse',
    amountReceived: 25000,
    amountReceivedOn: '2026-05-01',
  };
  const second = {
    ...first,
    id: 'other',
    outcome: undefined,
    stage: 'Offer',
    amountReceived: undefined,
    amountReceivedOn: undefined,
    depositStatus: 'Due',
  };
  useXbarStore.setState({ salesLeads: [first, second] });
  const before = useXbarStore.getState().salesLeads;
  const result = useXbarStore.getState().updateSalesLead('other', { stage: 'Closed', outcome: 'Won' });
  assert.equal(result.ok, false);
  assert.match(result.message, /already.*sale/i);
  assert.deepEqual(useXbarStore.getState().salesLeads, before);
});

test('reopening a paid sale preserves received cash through the actual store and report exports', async () => {
  const { createHorseRecord } = await import('../../src/store/xbarStoreHelpers.ts');
  const { buildRanchFinancials } = await import('../../src/lib/profitIntelligence.ts');
  const { buildRanchReport } = await import('../../src/lib/ranchReport.ts');
  const { ranchReportToCsv } = await import('../../src/lib/ranchReportExport.ts');
  const empty = createEmptyWorkspaceState();
  const created = createHorseRecord(
    {
      name: 'Cash Conservation Horse',
      barnName: 'Cash',
      sex: 'Mare',
      segment: 'Broodmare',
      status: 'Sale Prep',
      owner: 'Synthetic Ranch',
      ownerEntity: 'Synthetic Ranch',
      barn: 'A',
      pasture: 'A',
    },
    empty.workspaceProfile,
  );
  const horse = { ...created, costBasis: 10000, sale: { ...created.sale, askPrice: 25000 } };
  const paid = {
    ...useXbarStore.getState().salesLeads[0],
    horseId: horse.id,
    amountReceived: 25000,
    amountReceivedOn: '2026-05-01',
  };
  useXbarStore.setState({ horses: [horse], salesLeads: [paid] });
  const before = buildRanchFinancials([horse], [], [paid]);
  const result = useXbarStore.getState().updateSalesLead('sale', { stage: 'Offer', outcome: undefined });
  assert.equal(result.ok, true, result.message);
  const state = useXbarStore.getState();
  assert.equal(state.salesLeads[0].amountReceived, 25000);
  const after = buildRanchFinancials(state.horses, [], state.salesLeads);
  assert.equal(after.totalCashReceived, before.totalCashReceived);
  assert.equal(after.unappliedReceipts, 20000);
  assert.equal(after.grossProfitOnSales, 0);
  const report = buildRanchReport({
    horses: state.horses,
    salesLeads: state.salesLeads,
    expenseReceipts: [],
    documents: [],
    ownershipRecords: [],
  });
  assert.equal(report.money.totalCashReceived, 25000);
  assert.equal(report.money.unappliedReceipts, 20000);
  assert.match(ranchReportToCsv(report), /"Unapplied recorded receipts \(excluding held deposits\)","20000"/);
});
