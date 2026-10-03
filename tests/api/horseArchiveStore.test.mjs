import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createEmptyWorkspaceState,
  createHorseRecord,
  restorePersistedState,
  canRestorePersistedState,
} from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { useCloudStore } from '../../src/store/useCloudStore.ts';
import { clearCloudDeletions, pendingCloudDeletions } from '../../src/lib/cloudDeletionQueue.ts';

// Exercise the actual store. Synthetic records only; no cloud/customer writes.
await new Promise((resolve) => setImmediate(resolve));
let persisted;
useXbarStore.persist.setOptions({
  storage: {
    getItem: () => persisted,
    setItem: (_name, value) => {
      persisted = JSON.parse(JSON.stringify(value));
    },
    removeItem: () => {
      persisted = null;
    },
  },
});
const profile = createEmptyWorkspaceState().workspaceProfile;
const makeHorse = () =>
  createHorseRecord(
    {
      name: 'Archive Test Horse',
      barnName: 'Archive Test',
      sex: 'Mare',
      segment: 'Broodmare',
      status: 'Medical Review',
      owner: 'Test Ranch',
      ownerEntity: 'Test Ranch',
      barn: 'A',
      pasture: 'North',
    },
    profile,
  );

beforeEach(() => {
  useCloudStore.setState({ workspaceId: null, session: null });
  clearCloudDeletions();
  const horse = makeHorse();
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin', horses: [horse] });
});

test('Undo refuses a different workspace even when a backup contains the same archive token', () => {
  useCloudStore.setState({ workspaceId: 'workspace-a' });
  const horseId = useXbarStore.getState().horses[0].id;
  const result = useXbarStore.getState().archiveHorse(horseId);
  useCloudStore.setState({ workspaceId: 'workspace-b' });
  const before = useXbarStore.getState();
  assert.equal(before.restoreHorse(horseId, result.archiveId, 'workspace-a').ok, false);
  assert.deepEqual(useXbarStore.getState(), before);
});

test('archive and restore preserve the horse and all related records; neither queues a deletion', () => {
  const state = useXbarStore.getState();
  const horse = state.horses[0];
  const related = {
    documents: [{ id: 'paper', horseId: horse.id, state: 'Ready', storagePath: 'test/paper' }],
    ownershipRecords: [{ id: 'owner', horseId: horse.id }],
    expenseReceipts: [{ id: 'receipt', horseId: horse.id, amount: 125 }],
    salesLeads: [{ id: 'lead', horseId: horse.id, offerAmount: 2500 }],
    salePacketBuilds: [{ id: 'packet', horseId: horse.id }],
  };
  useXbarStore.setState(related);
  const archived = state.archiveHorse(horse.id);
  assert.equal(archived.ok, true);
  assert.ok(archived.archiveId);
  const after = useXbarStore.getState();
  assert.equal(after.horses.length, 1);
  assert.equal(after.horses[0].archive.id, archived.archiveId);
  const record = { ...after.horses[0] };
  delete record.archive;
  assert.deepEqual(record, horse);
  for (const key of Object.keys(related)) assert.deepEqual(after[key], related[key]);
  assert.deepEqual(after.subscription, state.subscription);
  assert.deepEqual(pendingCloudDeletions(), []);
  assert.equal(after.restoreHorse(horse.id, archived.archiveId).ok, true);
  assert.deepEqual(useXbarStore.getState().horses[0], horse);
  for (const key of Object.keys(related)) assert.deepEqual(useXbarStore.getState()[key], related[key]);
  assert.deepEqual(pendingCloudDeletions(), []);
  assert.equal(useXbarStore.getState().auditEvents.length, 2);
});

test('archive survives serialization/hydration and can be restored after reload', () => {
  const horse = useXbarStore.getState().horses[0];
  const result = useXbarStore.getState().archiveHorse(horse.id);
  assert.equal(result.ok, true);
  assert.equal(canRestorePersistedState(persisted.state), true);
  const restored = restorePersistedState(persisted.state);
  assert.equal(restored.horses[0].archive.id, result.archiveId);
  useXbarStore.setState(restored);
  assert.equal(useXbarStore.getState().restoreHorse(horse.id, result.archiveId).ok, true);
  assert.equal(persisted.state.horses[0].archive, undefined);
});

test('old backups without archive metadata remain valid; malformed archive metadata is rejected', () => {
  const state = JSON.parse(JSON.stringify(persisted.state));
  assert.equal(canRestorePersistedState(state), true);
  for (const archive of [
    null,
    true,
    [],
    'archived',
    {},
    { id: '', archivedAt: '2026-10-03' },
    { id: 'a', archivedAt: 'invalid' },
    { id: {}, archivedAt: '2026-10-03' },
  ]) {
    const broken = structuredClone(state);
    broken.horses[0].archive = archive;
    assert.equal(canRestorePersistedState(broken), false, JSON.stringify(archive));
  }
});

test('restore removes only archive metadata, preserving edits made while archived', () => {
  const horse = useXbarStore.getState().horses[0];
  const result = useXbarStore.getState().archiveHorse(horse.id);
  useXbarStore.getState().updateHorse(horse.id, { name: 'Corrected Name', status: 'Pasture' });
  assert.equal(useXbarStore.getState().restoreHorse(horse.id, result.archiveId).ok, true);
  assert.equal(useXbarStore.getState().horses[0].name, 'Corrected Name');
  assert.equal(useXbarStore.getState().horses[0].status, 'Pasture');
});

for (const role of ['Admin', 'Ranch Manager', 'Owner', 'Medical Lead', 'Sales Lead', 'Unknown']) {
  test(`archive/restore recheck edit permission for ${role}`, () => {
    const horse = useXbarStore.getState().horses[0];
    useXbarStore.setState({ currentRole: role });
    const allowed = ['Admin', 'Ranch Manager', 'Owner', 'Sales Lead'].includes(role);
    const before = useXbarStore.getState();
    assert.equal(before.archiveHorse(horse.id).ok, allowed);
    if (!allowed) assert.deepEqual(useXbarStore.getState(), before);
    useXbarStore.setState({ currentRole: 'Admin' });
    if (!allowed) useXbarStore.getState().archiveHorse(horse.id);
    const archiveId = useXbarStore.getState().horses[0].archive.id;
    useXbarStore.setState({ currentRole: role });
    const archived = useXbarStore.getState();
    assert.equal(archived.restoreHorse(horse.id, archiveId).ok, allowed);
    if (!allowed) assert.deepEqual(useXbarStore.getState(), archived);
  });
}

test('missing or ambiguous targets cannot report success or write', () => {
  const state = useXbarStore.getState();
  for (const action of ['archiveHorse', 'restoreHorse']) {
    assert.equal(state[action]('absent', 'token').ok, false);
    assert.deepEqual(useXbarStore.getState(), state);
  }
  useXbarStore.setState({ horses: [state.horses[0], { ...state.horses[0] }] });
  const duplicate = useXbarStore.getState();
  for (const action of ['archiveHorse', 'restoreHorse']) {
    assert.equal(duplicate[action](state.horses[0].id, 'token').ok, false);
    assert.deepEqual(useXbarStore.getState(), duplicate);
  }
});

test('old Undo cannot restore a later archive; repeat operations do not write', () => {
  const horseId = useXbarStore.getState().horses[0].id;
  const first = useXbarStore.getState().archiveHorse(horseId);
  const before = useXbarStore.getState();
  assert.equal(before.archiveHorse(horseId).ok, false);
  assert.deepEqual(useXbarStore.getState(), before);
  assert.equal(before.restoreHorse(horseId, first.archiveId).ok, true);
  assert.equal(useXbarStore.getState().restoreHorse(horseId, first.archiveId).ok, false);
  const second = useXbarStore.getState().archiveHorse(horseId);
  assert.notEqual(first.archiveId, second.archiveId);
  const current = useXbarStore.getState();
  assert.equal(current.restoreHorse(horseId, first.archiveId).ok, false);
  assert.equal(current.restoreHorse(horseId).ok, false);
  assert.deepEqual(useXbarStore.getState(), current);
});

for (const listingState of ['Draft', 'Live']) {
  test(`a ${listingState} buyer packet is preserved when its horse is archived`, () => {
    const horseId = useXbarStore.getState().horses[0].id;
    useXbarStore.setState({ sharedListings: [{ id: 'listing', horseId, state: listingState }] });
    const before = useXbarStore.getState();
    assert.equal(before.archiveHorse(horseId).ok, true);
    assert.deepEqual(useXbarStore.getState().sharedListings, before.sharedListings);
  });
}

test('restoring a horse never republishes its archived buyer packet', () => {
  const horseId = useXbarStore.getState().horses[0].id;
  const listing = { id: 'listing', horseId, state: 'Archived' };
  useXbarStore.setState({ sharedListings: [listing] });
  const result = useXbarStore.getState().archiveHorse(horseId);
  assert.equal(result.ok, true);
  assert.equal(useXbarStore.getState().restoreHorse(horseId, result.archiveId).ok, true);
  assert.deepEqual(useXbarStore.getState().sharedListings, [listing]);
});
