import assert from 'node:assert/strict';
import test from 'node:test';
import { projectCareEvidence } from '../src/lib/careProjection.js';
import type { DocumentRecord, HorseRecord, TimelineEvent } from '../src/types/xbar.js';

const treatment = (id: string, date: string, status: string, completionState = 'completed') =>
  ({ id, date, status, completionState }) as TimelineEvent;
const horse = (medicalTimeline: TimelineEvent[]) => ({ id: 'horse-1', medicalTimeline }) as HorseRecord;
const coggins = (id: string, examDate: string, horseId = 'horse-1', state = 'Ready') =>
  ({ id, horseId, type: 'Coggins', state, entities: { examDate } }) as DocumentRecord;

test('evidence selects only completed valid care for the explicit calendar day', () => {
  const records = [
    treatment('future', '2026-09-30', 'Deworming'),
    treatment('planned', '2026-08-02', 'Deworming', 'planned'),
    treatment('invalid', '2026-06-31', 'Deworming'),
    treatment('current-2', '2026-06-01T21:00:00-05:00', 'Deworming'),
    treatment('current-1', '2026-06-01', 'Deworming'),
    treatment('old', '2026-05-31', 'Deworming'),
  ];
  const docs = [
    coggins('wrong-horse', '2026-08-15', 'other'),
    coggins('review', '2026-08-15', 'horse-1', 'Needs Review'),
    coggins('good', '2025-08-31T23:30:00-10:00'),
  ];
  const expected = [
    {
      kind: 'wormer',
      status: 'due',
      evidenceDay: '2026-06-01',
      dueDay: '2026-08-30',
      evidenceIds: ['current-1', 'current-2'],
    },
    { kind: 'dental', status: 'missing' },
    { kind: 'coggins', status: 'watch', evidenceDay: '2025-08-31', dueDay: '2026-08-31', evidenceIds: ['good'] },
  ];
  const before = process.env.TZ;
  try {
    for (const zone of ['America/Chicago', 'Pacific/Apia', 'Europe/Berlin']) {
      process.env.TZ = zone;
      assert.deepEqual(projectCareEvidence(horse(records), docs, '2026-08-31'), expected);
      assert.deepEqual(projectCareEvidence(horse([...records].reverse()), docs, '2026-08-31'), expected);
    }
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
  assert.equal(projectCareEvidence(horse(records), docs, '2026-09-01')[2].status, 'due');
});

test('unknown evidence is not given a due day; invalid evaluation day is refused', () => {
  const h = horse([treatment('invalid', '2026-08-99', 'Dental')]);
  assert.deepEqual(projectCareEvidence(h, [coggins('unknown', '2026-08-31Tgarbage')], '2026-08-31'), [
    { kind: 'wormer', status: 'missing' },
    { kind: 'dental', status: 'missing' },
    { kind: 'coggins', status: 'missing', invalidExamOnFile: true },
  ]);
  assert.throws(() => projectCareEvidence(h, [], '2026-02-30'), /calendar day/);
  assert.throws(() => projectCareEvidence(h, [], '2026-03-01T00:00:00Z'), /calendar day/);
});
