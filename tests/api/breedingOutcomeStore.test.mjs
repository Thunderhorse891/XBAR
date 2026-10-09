import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createEmptyWorkspaceState,
  createHorseRecord,
  restorePersistedState,
  canRestorePersistedState,
} from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { buildMareBreedingState } from '../../src/lib/breedingIntelligence.ts';

await new Promise((resolve) => setImmediate(resolve));
let persistWrites = 0;
useXbarStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => {
      persistWrites += 1;
    },
    removeItem: () => {},
  },
});
const horse = createHorseRecord(
  {
    name: 'Synthetic Breeding Mare',
    barnName: 'Mare',
    sex: 'Mare',
    segment: 'Broodmare',
    status: 'Broodmare Program',
    owner: 'Test',
    ownerEntity: 'Test',
    barn: 'A',
    pasture: 'A',
  },
  createEmptyWorkspaceState().workspaceProfile,
);
const event = (overrides = {}) => ({
  title: 'Pregnancy check',
  body: 'Synthetic test record.',
  author: 'Test Staff',
  date: '2026-06-01',
  kind: 'pregnancy-check',
  result: 'in-foal',
  completionState: 'completed',
  ...overrides,
});
const mareState = (now = new Date('2026-10-05T12:00:00Z')) =>
  buildMareBreedingState(useXbarStore.getState().horses[0], now);
function expectNoWrite(input, horseId = horse.id) {
  const before = useXbarStore.getState();
  const writesBefore = persistWrites;
  assert.equal(before.addBreedingEvent(horseId, input).ok, false);
  assert.equal(useXbarStore.getState(), before, 'rejected input must not mutate any store state');
  assert.equal(persistWrites, writesBefore, 'rejected input must not persist');
}
beforeEach(() => {
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin', horses: [structuredClone(horse)] });
  persistWrites = 0;
});

test('chosen outcomes survive actual store save, backfill and backup restoration', () => {
  assert.equal(useXbarStore.getState().addBreedingEvent(horse.id, event()).ok, true);
  assert.equal(mareState().status, 'in-foal');
  assert.equal(
    useXbarStore
      .getState()
      .addBreedingEvent(horse.id, event({ title: 'Foaled', kind: 'foaling', result: 'live', date: '2026-07-01' })).ok,
    true,
  );
  assert.equal(useXbarStore.getState().addBreedingEvent(horse.id, event({ date: '2026-06-15' })).ok, true);
  const backup = useXbarStore.getState().exportWorkspaceBackup();
  assert.equal(canRestorePersistedState(backup.workspace), true);
  const restored = restorePersistedState(JSON.parse(JSON.stringify(backup.workspace)));
  assert.equal(buildMareBreedingState(restored.horses[0], new Date('2026-10-05T12:00:00Z')).status, 'foaled-live');
  const saved = restored.horses[0].breedingTimeline.find((entry) => entry.title === 'Foaled');
  assert.equal(saved.details.result, 'live');
  assert.equal(saved.completionState, 'completed');
  assert.deepEqual(
    restored.horses[0].activity.find((entry) => entry.id === saved.id),
    saved,
  );
});

test('invalid kind, occurrence, date, outcome and missing target are rejected before any write', () => {
  for (const input of [
    event({ kind: '' }),
    event({ kind: 'unrecognized' }),
    event({ kind: 'foaling', result: '' }),
    event({ kind: 'foaling', result: 'in-foal' }),
    event({ result: '' }),
    event({ result: 'live' }),
    event({ completionState: '' }),
    event({ completionState: 'unknown' }),
    event({ completionState: undefined }),
    event({ date: '2026-02-30' }),
    event({ date: 'not a date' }),
    event({ date: '2062-01-01' }),
    event({ kind: 'foaling', result: 'live', date: '2062-01-01' }),
    event({ kind: 'breeding', result: undefined, date: '2062-01-01' }),
    event({ completionState: 'planned', date: '2026-02-30' }),
    event({ title: '' }),
    event({ body: '' }),
    event({ author: '' }),
  ])
    expectNoWrite(input);
  expectNoWrite(event(), 'missing-horse');
});

test('planned and cancelled events remain non-evidence before and after their dates and through backups', () => {
  const beforeAnyEvidence = mareState();
  for (const completionState of ['planned', 'cancelled']) {
    for (const kind of ['breeding', 'pregnancy-check', 'foaling']) {
      for (const date of ['2026-06-01', '2062-01-01']) {
        const result = useXbarStore.getState().addBreedingEvent(
          horse.id,
          event({
            title: 'Live foal, mare pregnant',
            body: 'Positive pregnancy check and healthy live foal.',
            kind,
            result: undefined,
            date,
            completionState,
          }),
        );
        assert.equal(result.ok, true, `${completionState} ${kind} on ${date}`);
        const saved = useXbarStore.getState().horses[0].breedingTimeline[0];
        assert.equal(saved.completionState, completionState);
        assert.equal(saved.details.recordType, kind);
        assert.equal(saved.details.result, undefined);
        assert.deepEqual(mareState(), beforeAnyEvidence);
        assert.deepEqual(mareState(new Date('2063-01-01T12:00:00Z')), beforeAnyEvidence);
      }
    }
  }
  const backup = useXbarStore.getState().exportWorkspaceBackup();
  assert.equal(canRestorePersistedState(backup.workspace), true);
  const restored = restorePersistedState(JSON.parse(JSON.stringify(backup.workspace)));
  assert.deepEqual(
    restored.horses[0].breedingTimeline,
    JSON.parse(JSON.stringify(useXbarStore.getState().horses[0].breedingTimeline)),
  );
  assert.deepEqual(restored.horses[0].activity, JSON.parse(JSON.stringify(useXbarStore.getState().horses[0].activity)));
  assert.deepEqual(buildMareBreedingState(restored.horses[0], new Date('2063-01-01T12:00:00Z')), beforeAnyEvidence);
});

test('planned or cancelled outcomes do not replace an earlier completed check', () => {
  assert.equal(useXbarStore.getState().addBreedingEvent(horse.id, event()).ok, true);
  for (const completionState of ['planned', 'cancelled']) {
    const result = useXbarStore.getState().addBreedingEvent(
      horse.id,
      event({
        kind: 'foaling',
        result: 'loss',
        date: '2026-09-01',
        completionState,
      }),
    );
    assert.equal(result.ok, true);
    assert.equal(mareState().status, 'in-foal');
  }
});

test('completed checks and foalings require explicit outcomes and honor them over contradictory notes', () => {
  for (const [kind, result, status] of [
    ['pregnancy-check', 'in-foal', 'in-foal'],
    ['pregnancy-check', 'open', 'open'],
    ['pregnancy-check', 'pending', 'pregnancy-unknown'],
    ['foaling', 'live', 'foaled-live'],
    ['foaling', 'loss', 'foaled-loss'],
    ['foaling', 'unknown', 'foaling-unknown'],
  ]) {
    useXbarStore.setState({ horses: [structuredClone(horse)] });
    assert.equal(
      useXbarStore.getState().addBreedingEvent(
        horse.id,
        event({
          kind,
          result,
          title: 'Mare open; live foal; foaling loss',
          body: 'Pregnant; not pregnant; outcome unknown.',
        }),
      ).ok,
      true,
    );
    assert.equal(mareState().status, status, `${kind}: ${result}`);
  }
});

test('all non-breeding roles deny writes without persistence and Admin can save', () => {
  for (const currentRole of ['Ranch Manager', 'Owner', 'Medical Lead', 'Sales Lead', 'Pending access', 'Unknown']) {
    useXbarStore.setState({ currentRole });
    expectNoWrite(event());
    expectNoWrite(event({ completionState: 'planned', result: undefined }));
  }
  useXbarStore.setState({ currentRole: 'Admin' });
  assert.equal(useXbarStore.getState().addBreedingEvent(horse.id, event()).ok, true);
  assert.equal(useXbarStore.getState().horses[0].breedingTimeline.length, 1);
});

test('restoring a legacy record preserves absence of occurrence state and conservative legacy interpretation', () => {
  const legacy = {
    id: 'legacy-check',
    title: 'Pregnancy check',
    summary: 'Result unknown.',
    date: '2026-06-01',
    owner: 'Test',
    category: 'Breeding',
  };
  useXbarStore.setState({ horses: [{ ...structuredClone(horse), breedingTimeline: [legacy], activity: [legacy] }] });
  const backup = useXbarStore.getState().exportWorkspaceBackup();
  assert.equal(canRestorePersistedState(backup.workspace), true);
  const restored = restorePersistedState(JSON.parse(JSON.stringify(backup.workspace)));
  assert.equal(restored.horses[0].breedingTimeline[0].completionState, undefined);
  assert.equal(
    buildMareBreedingState(restored.horses[0], new Date('2026-10-05T12:00:00Z')).status,
    'pregnancy-unknown',
  );
});

test('backup round trip preserves reviewed contract evidence, linked document IDs and unrelated horse data', () => {
  const contract = {
    id: 'synthetic-contract',
    title: 'Reviewed breeding contract',
    summary: 'Synthetic contract record.',
    date: '2026-05-01',
    owner: 'Test',
    category: 'Breeding',
    completionState: 'completed',
    details: {
      recordType: 'contract',
      documentId: 'synthetic-contract-document',
      liveFoalGuarantee: {
        breedingEventId: 'synthetic-cover',
        counterparty: 'Synthetic Stud Owner',
        terms: 'Review written conditions.',
        coverage: 'conditional',
        conditionsReview: 'unreviewed',
        reviewedBy: 'Test Staff',
        reviewedOn: '2026-05-01',
        claimDeadline: '2027-05-01',
      },
    },
  };
  const before = { ...structuredClone(horse), breedingTimeline: [contract], activity: [contract] };
  useXbarStore.setState({ horses: [before] });
  const backup = useXbarStore.getState().exportWorkspaceBackup();
  const serialized = JSON.parse(JSON.stringify(backup.workspace));
  assert.equal(canRestorePersistedState(serialized), true);
  const restored = restorePersistedState(serialized);
  assert.deepEqual(restored.horses[0], JSON.parse(JSON.stringify(before)));
  assert.deepEqual(restored.horses[0].breedingTimeline[0].details, contract.details);
  assert.equal(restored.horses[0].breedingTimeline[0].details.documentId, 'synthetic-contract-document');
});
