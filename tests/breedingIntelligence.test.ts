import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GESTATION_MEAN_DAYS,
  buildCheckpoints,
  buildMareBreedingState,
  buildBreedingProgram,
} from '../src/lib/breedingIntelligence.js';
import type { HorseRecord, TimelineEvent, BreedingRecordDetails } from '../src/types/xbar.js';

const now = new Date('2026-06-10T12:00:00Z');
const DAY = 86_400_000;

function isoDaysAgo(days: number): string {
  return new Date(now.getTime() - days * DAY).toISOString().slice(0, 10);
}

function breedingEvent(daysAgo: number, recordType: BreedingRecordDetails['recordType'], extra: Partial<BreedingRecordDetails> = {}): TimelineEvent {
  return {
    id: `ev-${recordType}-${daysAgo}`,
    date: isoDaysAgo(daysAgo),
    title: recordType,
    summary: '',
    owner: 'Vet',
    category: 'Breeding',
    details: { recordType, ...extra } as BreedingRecordDetails,
  } as TimelineEvent;
}

function mare(id: string, name: string, timeline: TimelineEvent[], economics?: HorseRecord['breedingEconomics']): HorseRecord {
  return { id, name, sex: 'Mare', breedingTimeline: timeline, breedingEconomics: economics } as unknown as HorseRecord;
}

test('checkpoint cadence matches the standard equine prenatal schedule', () => {
  const bredOn = new Date(now.getTime() - 16 * DAY);
  const checkpoints = buildCheckpoints(bredOn, now);
  assert.equal(checkpoints.length, 8);
  // Day-15 ultrasound is now overdue (16 days elapsed), and critical.
  const first = checkpoints[0]!;
  assert.equal(first.dayOffset, 15);
  assert.equal(first.status, 'overdue');
  assert.equal(first.critical, true);
  // The 9-month EHV booster is far upcoming.
  const ehv9 = checkpoints.find((c) => c.dayOffset === 270)!;
  assert.equal(ehv9.kind, 'vaccination');
  assert.equal(ehv9.status, 'upcoming');
});

test('a freshly bred mare awaits confirmation', () => {
  const state = buildMareBreedingState(mare('m1', 'Glory', [breedingEvent(5, 'breeding', { mateName: 'Thunder', method: 'live-cover' })]), now);
  assert.equal(state.status, 'bred-awaiting-check');
  assert.equal(state.guarantee, 'covered');
  assert.equal(state.mateName, 'Thunder');
  assert.match(state.actionLabel, /Confirm pregnancy/);
});

test('expected foaling date is breeding + 340 days with a normal window', () => {
  const state = buildMareBreedingState(
    mare('m1', 'Glory', [
      breedingEvent(60, 'breeding', { mateName: 'Thunder' }),
      breedingEvent(30, 'pregnancy-check', { result: 'in foal' }),
    ]),
    now,
  );
  assert.equal(state.status, 'in-foal');
  const expected = new Date(now.getTime() - 60 * DAY + GESTATION_MEAN_DAYS * DAY).toISOString().slice(0, 10);
  assert.equal(state.expectedFoalingDate, expected);
  assert.ok(state.foalingWindowStart! < state.expectedFoalingDate!);
  assert.ok(state.foalingWindowEnd! > state.expectedFoalingDate!);
});

test('a confirmed mare inside 30 days of foaling is near-term with kit prep action', () => {
  // Bred 320 days ago => due in ~20 days.
  const state = buildMareBreedingState(
    mare('m1', 'Glory', [
      breedingEvent(320, 'breeding', { mateName: 'Thunder' }),
      breedingEvent(290, 'pregnancy-check', { result: 'confirmed' }),
    ]),
    now,
  );
  assert.equal(state.status, 'near-term');
  assert.ok(state.daysToFoaling! <= 30);
  assert.match(state.actionLabel, /Prepare foaling kit/);
});

test('overdue critical checkpoints take action priority', () => {
  // Bred 35 days ago, no checks logged: day-15 and day-28 critical checks overdue.
  const state = buildMareBreedingState(mare('m1', 'Glory', [breedingEvent(35, 'breeding', { mateName: 'Thunder' })]), now);
  assert.ok(state.overdueCheckpoints.length >= 2);
  assert.match(state.actionLabel, /overdue/);
});

test('live foaling fulfils the guarantee; a loss owes a rebreed', () => {
  const live = buildMareBreedingState(
    mare('m1', 'Glory', [breedingEvent(345, 'breeding'), breedingEvent(2, 'foaling', { result: 'live filly' })]),
    now,
  );
  assert.equal(live.status, 'foaled-live');
  assert.equal(live.guarantee, 'fulfilled');

  const loss = buildMareBreedingState(
    mare('m2', 'Star', [breedingEvent(345, 'breeding'), breedingEvent(2, 'foaling', { result: 'foaling loss' })]),
    now,
  );
  assert.equal(loss.status, 'foaled-loss');
  assert.equal(loss.guarantee, 'rebreed-owed');
  assert.match(loss.actionLabel, /rebreed/i);
});

test('a negative pregnancy check returns the mare to open', () => {
  const state = buildMareBreedingState(
    mare('m1', 'Glory', [breedingEvent(40, 'breeding'), breedingEvent(15, 'pregnancy-check', { result: 'open' })]),
    now,
  );
  assert.equal(state.status, 'open');
  assert.equal(state.guarantee, 'none');
});

test('geldings and stallions are excluded as carriers', () => {
  const gelding = { id: 'g1', name: 'Comet', sex: 'Gelding', breedingTimeline: [] } as unknown as HorseRecord;
  assert.equal(buildMareBreedingState(gelding, now).status, 'not-breeding');
});

function plainBreedingEvent(daysAgo: number, title: string, summary = '', status?: string): TimelineEvent {
  return {
    id: `pev-${title}-${daysAgo}`,
    date: isoDaysAgo(daysAgo),
    title,
    summary,
    owner: 'Owner',
    category: 'Breeding',
    status,
  } as TimelineEvent;
}

test('a breeding logged through the app (free-text, no details) is recognized', () => {
  const state = buildMareBreedingState(
    mare('m1', 'Glory', [plainBreedingEvent(10, 'Bred to Thunder', 'Live cover')]),
    now,
  );
  assert.equal(state.status, 'bred-awaiting-check');
  assert.ok(state.expectedFoalingDate);
  assert.match(state.actionLabel, /Confirm pregnancy/);
});

test('a breeding verb outranks result words in mixed notes', () => {
  // "open" describes prior state; the logged action is a cover.
  const open = buildMareBreedingState(mare('m1', 'Glory', [plainBreedingEvent(8, 'Open mare bred to Thunder')]), now);
  assert.equal(open.status, 'bred-awaiting-check');
  const cover = buildMareBreedingState(mare('m2', 'Star', [plainBreedingEvent(8, 'Confirmed live cover')]), now);
  assert.equal(cover.status, 'bred-awaiting-check');
});

test('a live foaling note that mentions "still" is not read as a loss', () => {
  const state = buildMareBreedingState(
    mare('m1', 'Glory', [
      plainBreedingEvent(345, 'Bred to Thunder'),
      plainBreedingEvent(2, 'Foaled a live filly', 'mare and foal still doing well'),
    ]),
    now,
  );
  assert.equal(state.status, 'foaled-live');
  assert.equal(state.guarantee, 'fulfilled');
});

test('a free-text positive pregnancy check confirms the mare in foal', () => {
  const state = buildMareBreedingState(
    mare('m1', 'Glory', [
      plainBreedingEvent(60, 'Bred to Thunder'),
      plainBreedingEvent(30, 'Pregnancy check', 'Confirmed in foal'),
    ]),
    now,
  );
  assert.equal(state.status, 'in-foal');
});

test('a breeding past the latest foaling date with no outcome is not counted as active', () => {
  const state = buildMareBreedingState(
    mare('m1', 'Glory', [
      breedingEvent(400, 'breeding', { mateName: 'Thunder' }),
      breedingEvent(370, 'pregnancy-check', { result: 'in foal' }),
    ]),
    now,
  );
  assert.notEqual(state.status, 'near-term');
  assert.notEqual(state.status, 'in-foal');
  assert.equal(state.status, 'bred-awaiting-check');
  assert.match(state.actionLabel, /Record foaling outcome/);

  const program = buildBreedingProgram([
    mare('m1', 'Glory', [
      breedingEvent(400, 'breeding', { mateName: 'Thunder' }),
      breedingEvent(370, 'pregnancy-check', { result: 'in foal' }),
    ], { studFee: 3000, bookedMares: 1, breedingCosts: 4000, mareProductionValue: 0, foalProjectedValue: 18000 }),
  ], now);
  assert.equal(program.nearTerm, 0);
  assert.equal(program.inFoal, 0);
});

test('a bred mare that went open stays in the program with a rebreed action', () => {
  const program = buildBreedingProgram([
    mare('m1', 'Glory', [breedingEvent(40, 'breeding'), breedingEvent(15, 'pregnancy-check', { result: 'open' })]),
  ], now);
  assert.equal(program.maresTracked, 1);
  assert.equal(program.mares[0]!.status, 'open');
  assert.match(program.mares[0]!.actionLabel, /[Rr]ebreed/);
});

test('program rollup aggregates carriers, value, and overdue checks', () => {
  const program = buildBreedingProgram(
    [
      mare('m1', 'Glory', [breedingEvent(320, 'breeding'), breedingEvent(290, 'pregnancy-check', { result: 'in foal' })], { studFee: 3000, bookedMares: 1, breedingCosts: 4000, mareProductionValue: 0, foalProjectedValue: 18000 }),
      mare('m2', 'Star', [breedingEvent(60, 'breeding'), breedingEvent(30, 'pregnancy-check', { result: 'confirmed' })], { studFee: 3000, bookedMares: 1, breedingCosts: 4000, mareProductionValue: 0, foalProjectedValue: 12000 }),
      mare('m3', 'Dusty', [breedingEvent(35, 'breeding')]), // no checks → overdue criticals
      { id: 'g1', name: 'Comet', sex: 'Gelding', breedingTimeline: [] } as unknown as HorseRecord,
    ],
    now,
  );
  assert.equal(program.maresTracked, 3); // gelding excluded
  assert.equal(program.inFoal, 2);
  assert.equal(program.nearTerm, 1); // Glory due in ~20 days
  assert.equal(program.projectedProgramValue, 30000); // 18k + 12k
  assert.equal(program.projectedProgramMargin, 22000); // (18k-4k)+(12k-4k)
  assert.ok(program.overdueCheckCount >= 2); // Dusty's day-15/28 checks
  // Most urgent (overdue checks) sorts first.
  assert.equal(program.mares[0]!.horseName, 'Dusty');
});
