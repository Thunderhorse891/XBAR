import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { canRestorePersistedState, createEmptyWorkspaceState } from '../../src/store/xbarStoreHelpers.ts';
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
