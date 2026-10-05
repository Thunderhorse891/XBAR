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
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const horse = createHorseRecord(
  {
    name: 'Synthetic Breeding Mare',
    barnName: 'Mare',
    sex: 'Mare',
    segment: 'Broodmare',
    status: 'Active',
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
  ...overrides,
});
beforeEach(() =>
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin', horses: [structuredClone(horse)] }),
);

test('chosen outcomes survive actual store save, backfill and backup restoration', () => {
  assert.equal(useXbarStore.getState().addBreedingEvent(horse.id, event()).ok, true);
  assert.equal(buildMareBreedingState(useXbarStore.getState().horses[0]).status, 'in-foal');
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
  assert.equal(buildMareBreedingState(restored.horses[0]).status, 'foaled-live');
  assert.equal(restored.horses[0].breedingTimeline.find((entry) => entry.title === 'Foaled').details.result, 'live');
});

test('invalid/future/missing-outcome and denied-role writes preserve records', () => {
  for (const input of [
    event({ kind: 'foaling', result: '' }),
    event({ date: '2026-02-30' }),
    event({ date: '2062-01-01' }),
  ]) {
    const before = JSON.stringify(useXbarStore.getState().horses);
    assert.equal(useXbarStore.getState().addBreedingEvent(horse.id, input).ok, false);
    assert.equal(JSON.stringify(useXbarStore.getState().horses), before);
  }
  useXbarStore.setState({ currentRole: 'Owner' });
  assert.equal(useXbarStore.getState().addBreedingEvent(horse.id, event()).ok, false);
  assert.equal(useXbarStore.getState().horses[0].breedingTimeline.length, 0);
});
