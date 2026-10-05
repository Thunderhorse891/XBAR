import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  createEmptyWorkspaceState,
  createHorseRecord,
  restorePersistedState,
  canRestorePersistedState,
} from '../../src/store/xbarStoreHelpers.ts';
import { useXbarStore } from '../../src/store/useXbarStore.ts';
import { buildCareBoardRows } from '../../src/lib/dashboardOps.ts';
import { localIsoDate, addLocalCalendarDays } from '../../src/lib/format.ts';

await new Promise((resolve) => setImmediate(resolve));
useXbarStore.persist.setOptions({ storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });
const horse = createHorseRecord(
  {
    name: 'Synthetic Care Horse',
    barnName: 'Care',
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
  title: 'Deworming administered',
  body: 'Synthetic test record.',
  author: 'Test Staff',
  date: localIsoDate(),
  type: 'Deworming',
  ...overrides,
});
const wormer = (horses, now = new Date()) =>
  buildCareBoardRows(horses, [], [], now)[0].signals.find((signal) => signal.key === 'wormer');
beforeEach(() =>
  useXbarStore.setState({ ...createEmptyWorkspaceState(), currentRole: 'Admin', horses: [structuredClone(horse)] }),
);

test('saving completed care changes care due and survives a supported backup round trip', () => {
  assert.equal(wormer(useXbarStore.getState().horses).status, 'due');
  const result = useXbarStore.getState().addMedicalEvent(horse.id, event());
  assert.equal(result.ok, true);
  const backup = useXbarStore.getState().exportWorkspaceBackup();
  assert.equal(canRestorePersistedState(backup.workspace), true);
  const restored = restorePersistedState(JSON.parse(JSON.stringify(backup.workspace)));
  assert.equal(restored.horses[0].medicalTimeline[0].completionState, 'completed');
  assert.equal(wormer(restored.horses).status, 'clear');
});

test('planned care persists and needs explicit completion even after its date passes', () => {
  const tomorrow = addLocalCalendarDays(new Date(), 1);
  const result = useXbarStore
    .getState()
    .addMedicalEvent(horse.id, event({ date: localIsoDate(tomorrow), completionState: 'planned' }));
  assert.equal(result.ok, true);
  const saved = JSON.parse(JSON.stringify(useXbarStore.getState().horses));
  assert.equal(wormer(saved, addLocalCalendarDays(tomorrow, 1)).status, 'due');
  const update = useXbarStore
    .getState()
    .updateMedicalEvent(horse.id, result.id, { date: localIsoDate(), completionState: 'completed' });
  assert.equal(update.ok, true);
  assert.equal(wormer(useXbarStore.getState().horses).status, 'clear');
});

test('future completed care and invalid dates are rejected without a write', () => {
  for (const date of [localIsoDate(addLocalCalendarDays(new Date(), 1)), '2026-02-30']) {
    const before = JSON.stringify(useXbarStore.getState().horses);
    assert.equal(useXbarStore.getState().addMedicalEvent(horse.id, event({ date })).ok, false);
    assert.equal(JSON.stringify(useXbarStore.getState().horses), before);
  }
});

test('completion updates check existence, permission and the resulting date', () => {
  const result = useXbarStore.getState().addMedicalEvent(horse.id, event({ completionState: 'planned' }));
  const patch = { completionState: 'completed' };
  assert.equal(useXbarStore.getState().updateMedicalEvent(horse.id, 'missing', patch).ok, false);
  useXbarStore.setState({ currentRole: 'Sales Lead' });
  assert.equal(useXbarStore.getState().updateMedicalEvent(horse.id, result.id, patch).ok, false);
  useXbarStore.setState({ currentRole: 'Medical Lead' });
  assert.equal(
    useXbarStore
      .getState()
      .updateMedicalEvent(horse.id, result.id, { ...patch, date: localIsoDate(addLocalCalendarDays(new Date(), 1)) })
      .ok,
    false,
  );
  assert.equal(useXbarStore.getState().updateMedicalEvent(horse.id, result.id, patch).ok, true);
  const before = JSON.stringify(useXbarStore.getState().horses);
  assert.equal(useXbarStore.getState().updateMedicalEvent(horse.id, result.id, { date: '2026-02-30' }).ok, false);
  assert.equal(JSON.stringify(useXbarStore.getState().horses), before);
});
