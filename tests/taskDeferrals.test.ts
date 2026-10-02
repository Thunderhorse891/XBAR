import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { addLocalDays, deferTask, isDeferred, readDeferrals, SNOOZE_CHOICES } from '../src/lib/taskDeferrals.js';

/*
 * Audit F09: on Care Tasks, Snooze showed a toast and stored nothing, and
 * "Mark Done" hid the row on this device for the UTC day while reporting
 * `task.completed`. Acceptance: a snooze persists a deadline; hiding is not
 * labelled or reported as completion.
 */

const TODAY = '2026-10-02';

test('a snooze lasts until its local day, then the task returns', () => {
  const tomorrow = addLocalDays(TODAY, 1);
  const deferrals = deferTask({}, 'care-h1', tomorrow);
  assert.equal(isDeferred(deferrals, 'care-h1', TODAY), true);
  assert.equal(isDeferred(deferrals, 'care-h1', tomorrow), false, 'back on the day it was snoozed until');
  assert.equal(isDeferred(deferrals, 'doc-d1', TODAY), false, 'other tasks are untouched');
  // It survives a reload: what is written is read back while in force.
  assert.deepEqual(readDeferrals(JSON.stringify(deferrals), TODAY), { 'care-h1': tomorrow });
  assert.deepEqual(readDeferrals(JSON.stringify(deferrals), tomorrow), {}, 'lapsed entries are dropped');
});

test('snooze choices land on real local days, across month and year ends', () => {
  assert.deepEqual(
    SNOOZE_CHOICES.map((choice) => choice.days),
    [1, 3, 7],
  );
  assert.equal(addLocalDays('2026-10-02', 7), '2026-10-09');
  assert.equal(addLocalDays('2026-10-30', 3), '2026-11-02');
  assert.equal(addLocalDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addLocalDays('2028-02-28', 1), '2028-02-29');
});

test('nothing unreadable can hide work', () => {
  for (const raw of [null, '', 'not json', '[]', '"care-h1"', '42', 'null']) {
    assert.deepEqual(readDeferrals(raw, TODAY), {}, String(raw));
  }
  const mixed = JSON.stringify({
    good: '2026-10-05',
    expired: '2026-10-02',
    malformed: 'next week',
    numeric: 20261005,
    nothing: null,
  });
  assert.deepEqual(readDeferrals(mixed, TODAY), { good: '2026-10-05' });
});

test('the screen persists snoozes, and hiding is never reported as done', async () => {
  const screen = await readFile('src/routes/TodayWork.tsx', 'utf8');
  assert.match(screen, /localStorage\.setItem\(TASK_DEFERRALS_KEY, JSON\.stringify\(next\)\)/);
  assert.match(screen, /SNOOZE_CHOICES\.map/);
  assert.match(screen, /defer\(open, choice\.days, 'snooze'\)/);
  assert.match(screen, /events\.taskDismissed : events\.taskSnoozed/);
  assert.doesNotMatch(screen, /events\.taskCompleted/, 'a hidden task is not a completed one');
  assert.doesNotMatch(screen, /Mark Done|Mark done/);
  assert.doesNotMatch(screen, /toast\('Snoozed'\)/, 'a snooze that stores nothing');
  assert.doesNotMatch(screen, /toISOString\(\)\.slice\(0, 10\)/, 'deferrals use the local day');
  assert.match(screen, /clears for everyone once (?:the|its) record is fixed/);
  const telemetry = await readFile('src/lib/telemetry.ts', 'utf8');
  assert.match(telemetry, /taskDismissed: 'task\.dismissed'/);
  assert.match(telemetry, /taskSnoozed: 'task\.snoozed'/);
});
