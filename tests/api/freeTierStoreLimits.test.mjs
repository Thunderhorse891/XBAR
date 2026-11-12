import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { createEmptyWorkspaceState, createHorseRecord } from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { buildSubscriptionForTier } from '../../src/lib/xbarRuntime.ts';
import { canUseOcr } from '../../src/lib/commercialEngine.ts';

await new Promise((resolve) => setImmediate(resolve));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const input = (index) => ({
  name: `QUOTA TEST ${index}`,
  barnName: `QT ${index}`,
  sex: 'Mare',
  segment: 'Sale Prospect',
  status: 'Sale Prep',
  owner: 'Synthetic',
  ownerEntity: 'Synthetic',
  barn: 'Test',
  pasture: '',
  registrationNumber: '',
});
const store = () => useXbarStore.getState();
const intake = (files) =>
  store().createDocumentIntake({
    files,
    source: 'Manual Upload',
    uploadedBy: 'Synthetic',
    createHorseFromBatch: false,
  });
const file = (index) => new File([`manual ${index}`], `manual-${index}.txt`, { type: 'text/plain' });
const fakeDocuments = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `old-${index}`,
    title: `Old ${index}`,
    state: 'Ready',
    contentSha256: `known-${index}`,
  }));
const records = () =>
  structuredClone({
    horses: store().horses,
    ownershipRecords: store().ownershipRecords,
    documents: store().documents,
    intakeBatches: store().intakeBatches,
    subscription: store().subscription,
  });

beforeEach((context) => {
  useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin' });
  context.mock.method(console, 'error', () => {});
});

test('ordinary Free addHorse refuses the third horse without changing any records or usage', () => {
  assert.equal(store().addHorse(input(1)).ok, true);
  assert.equal(store().addHorse(input(2)).ok, true);
  const before = records();
  assert.equal(store().addHorse(input(3)).ok, false);
  assert.deepEqual(records(), before);
});

test('ordinary paid Starter addHorse preserves five-horse capacity', () => {
  useXbarStore.setState({
    subscription: buildSubscriptionForTier(store().subscription, 'Starter', { billingState: 'Active' }),
  });
  for (let index = 0; index < 5; index++) assert.equal(store().addHorse(input(index)).ok, true);
  const before = records();
  assert.equal(store().addHorse(input(6)).ok, false);
  assert.deepEqual(records(), before);
});

test('a restored over-cap workspace can still edit existing horses', () => {
  const horses = Array.from({ length: 3 }, (_, index) => createHorseRecord(input(index), store().workspaceProfile));
  useXbarStore.setState({ horses });
  assert.equal(store().updateHorse(horses[0].id, { barnName: 'Updated safely' }).ok, true);
  assert.equal(store().horses.length, 3);
  assert.equal(store().horses[0].barnName, 'Updated safely');
  assert.equal(store().addHorse(input(4)).ok, false);
});

test('eleven Free documents are refused before any original is read or uploaded', async () => {
  let reads = 0;
  class UnreadFile extends File {
    async arrayBuffer() {
      reads++;
      throw new Error('must not read over-cap source');
    }
    async text() {
      reads++;
      throw new Error('must not read over-cap source');
    }
  }
  const files = Array.from(
    { length: 11 },
    (_, index) => new UnreadFile([`manual ${index}`], `${index}.txt`, { type: 'text/plain' }),
  );
  const before = records();
  const result = await intake(files);
  assert.equal(result.ok, false);
  assert.match(result.message, /10 document limit/);
  assert.equal(reads, 0);
  assert.deepEqual(records(), before);
});

test('ten manual Free documents are allowed, the eleventh is refused, archived files free capacity', async () => {
  assert.equal((await intake(Array.from({ length: 10 }, (_, index) => file(index)))).ok, true);
  const before = records();
  assert.equal((await intake([file(11)])).ok, false);
  assert.deepEqual(records(), before);
  useXbarStore.setState({
    documents: store().documents.map((document, index) =>
      index === 0 ? { ...document, state: 'Archived' } : document,
    ),
  });
  assert.equal((await intake([file(12)])).ok, true);
  assert.equal(store().documents.filter((document) => document.state !== 'Archived').length, 10);
});

test('paid Starter accepts document250 and refuses251 without changing records', async () => {
  useXbarStore.setState({
    subscription: buildSubscriptionForTier(store().subscription, 'Starter', { billingState: 'Active' }),
    documents: fakeDocuments(249),
  });
  assert.equal((await intake([file(250)])).ok, true);
  const before = records();
  assert.equal((await intake([file(251)])).ok, false);
  assert.deepEqual(records(), before);
});

test('concurrent Free intakes serialize capacity decisions', async () => {
  useXbarStore.setState({ documents: fakeDocuments(9) });
  const results = await Promise.all([intake([file('a')]), intake([file('b')])]);
  assert.deepEqual(
    results.map((result) => result.ok),
    [true, false],
  );
  assert.equal(store().documents.length, 10);
});

test('document count changed during original processing is rechecked before commit', async () => {
  class ChangingFile extends File {
    async arrayBuffer() {
      useXbarStore.setState({ documents: fakeDocuments(10) });
      return super.arrayBuffer();
    }
  }
  const result = await intake([new ChangingFile(['manual'], 'racing.txt', { type: 'text/plain' })]);
  assert.equal(result.ok, false);
  assert.match(result.message, /No records were added/);
  assert.deepEqual(store().documents, fakeDocuments(10));
  assert.equal(store().intakeBatches.length, 0);
});

test('a plan downgrade during a batch cannot commit documents beyond the new cap', async () => {
  useXbarStore.setState({
    subscription: buildSubscriptionForTier(store().subscription, 'Starter', { billingState: 'Active' }),
    documents: fakeDocuments(10),
  });
  class DowngradeFile extends File {
    async arrayBuffer() {
      useXbarStore.setState({
        subscription: buildSubscriptionForTier(store().subscription, 'Free', { billingState: 'Inactive' }),
      });
      return super.arrayBuffer();
    }
  }
  const result = await intake([new DowngradeFile(['manual'], 'downgrade.txt', { type: 'text/plain' })]);
  assert.equal(result.ok, false);
  assert.equal(store().documents.length, 10);
  assert.equal(store().intakeBatches.length, 0);
});

for (const billingState of ['Inactive', 'Past Due', 'Active', 'Manual Billing']) {
  test(`actual v9 rehydration migrates ${billingState} access without losing records or purchased rates`, async () => {
    const legacy = createEmptyWorkspaceState();
    legacy.workspaceProfile.ranchName = 'Synthetic Migration Ranch';
    legacy.subscription = buildSubscriptionForTier(legacy.subscription, 'Starter', { billingState });
    legacy.subscription.monthlyRate = 12;
    legacy.subscription.billingPeriod = 'annual';
    legacy.subscription.annualRate = 120;
    legacy.horses = [createHorseRecord(input('legacy'), legacy.workspaceProfile)];
    legacy.documents = fakeDocuments(3);
    let saved;
    useXbarStore.persist.setOptions({
      storage: {
        getItem: () => ({ state: structuredClone(legacy), version: 9 }),
        setItem: (_name, value) => {
          saved = value;
        },
        removeItem: () => {},
      },
    });
    await useXbarStore.persist.rehydrate();
    const entitled = billingState === 'Active' || billingState === 'Manual Billing';
    assert.equal(store().subscription.tier, entitled ? 'Starter' : 'Free');
    assert.equal(store().subscription.usage.horseLimit, entitled ? 5 : 2);
    assert.equal(store().subscription.usage.documentLimit, entitled ? 250 : 10);
    assert.equal(store().subscription.usage.storageLimitGb, entitled ? 25 : 1);
    assert.equal(canUseOcr(store().subscription), entitled);
    assert.equal(store().subscription.monthlyRate, 12);
    assert.equal(store().subscription.annualRate, 120);
    assert.equal(store().subscription.billingPeriod, 'annual');
    assert.equal(store().horses[0].id, legacy.horses[0].id);
    assert.equal(store().horses[0].name, legacy.horses[0].name);
    assert.deepEqual(
      store().documents.map((document) => document.id),
      legacy.documents.map((document) => document.id),
    );
    assert.equal(saved.version, 10);
  });
}

test('actual v9 rehydration preserves a zero-rate Enterprise operator grant', async () => {
  const legacy = createEmptyWorkspaceState();
  legacy.subscription = buildSubscriptionForTier(legacy.subscription, 'Enterprise', { billingState: 'Manual Billing' });
  legacy.subscription.monthlyRate = 0;
  legacy.horses = [createHorseRecord(input('owner'), legacy.workspaceProfile)];
  useXbarStore.persist.setOptions({
    storage: {
      getItem: () => ({ state: structuredClone(legacy), version: 9 }),
      setItem: () => {},
      removeItem: () => {},
    },
  });
  await useXbarStore.persist.rehydrate();
  assert.equal(store().subscription.tier, 'Enterprise');
  assert.equal(store().subscription.billingState, 'Manual Billing');
  assert.equal(store().subscription.monthlyRate, 0);
  assert.equal(store().subscription.usage.horseLimit, 2000);
  assert.equal(canUseOcr(store().subscription), true);
  assert.equal(store().horses[0].id, legacy.horses[0].id);
});
