import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMareBreedingState } from '../src/lib/breedingIntelligence.js';
import { breedingEntryDetails } from '../src/lib/breedingEntry.js';
import type { HorseRecord, TimelineEvent } from '../src/types/xbar.js';

const now = new Date('2026-06-01T12:00:00Z');
const event = (id: string, date: string, kind: string, result?: string): TimelineEvent =>
  ({
    id,
    date,
    title: kind,
    summary: 'Synthetic outcome evidence',
    category: 'Breeding',
    owner: 'Test Vet',
    details: { recordType: kind, result },
  }) as TimelineEvent;
const mare = (breedingTimeline: TimelineEvent[]): HorseRecord =>
  ({ id: 'mare', name: 'Synthetic Mare', sex: 'Mare', breedingTimeline }) as HorseRecord;

test('recorded foaling needs no historical cover to establish its outcome', () => {
  assert.equal(
    buildMareBreedingState(mare([event('birth', '2026-04-01', 'foaling', 'live')]), now).status,
    'foaled-live',
  );
});

test('missing foaling outcome never defaults to a live foal or fulfilled guarantee', () => {
  const state = buildMareBreedingState(
    mare([event('birth', '2026-04-01', 'foaling', 'unknown'), event('cover', '2025-05-01', 'breeding')]),
    now,
  );
  assert.equal(state.status, 'foaling-unknown');
  assert.equal(state.guarantee, 'not-recorded');
});

test('future and impossible pregnancy evidence cannot establish a pregnancy', () => {
  for (const date of ['2062-01-01', '2026-02-30']) {
    assert.notEqual(
      buildMareBreedingState(mare([event('check', date, 'pregnancy-check', 'in-foal')]), now).status,
      'in-foal',
    );
  }
});

test('foaling creation requires an explicit outcome, with unknown supported', () => {
  assert.equal(breedingEntryDetails({ completionState: 'completed', kind: 'foaling' }).ok, false);
  assert.deepEqual(breedingEntryDetails({ completionState: 'completed', kind: 'foaling', result: 'unknown' }), {
    ok: true,
    details: { recordType: 'foaling', result: 'unknown' },
  });
});

test('legacy foaling wording describes the foal, not the mare or a negated outcome', async () => {
  const { foalingOutcome } = await import('../src/lib/breedingIntelligence.js');
  for (const [summary, expected] of [
    ['Mare healthy after delivery', 'unknown'],
    ['Not a healthy colt', 'unknown'],
    ['Foal alive is not yet confirmed', 'unknown'],
    ['Foal not alive', 'loss'],
    ['No live foal', 'loss'],
    ['Healthy colt delivered', 'live'],
    ['Live foal, no complications', 'live'],
    ['No signs of loss; foal alive', 'live'],
  ] as const) {
    const record = { ...event('birth', '2026-04-01', 'foaling'), summary };
    assert.equal(foalingOutcome(record), expected, summary);
  }
});

test('exact timestamp cycles use observed time; mixed date-only cycles retain recorded order', () => {
  for (const coverDate of ['2026-05-01', '2026-05-01T23:00:00-07:00']) {
    for (const checkDate of ['2026-05-01', '2026-05-01T00:00:00Z']) {
      const cover = event('cover', coverDate, 'breeding');
      const check = event('old-check', checkDate, 'pregnancy-check', 'in-foal');
      assert.equal(buildMareBreedingState(mare([cover, check]), now).status, 'bred-awaiting-check');
      assert.equal(
        buildMareBreedingState(mare([check, cover]), now).status,
        coverDate.includes('T') && checkDate.includes('T') ? 'bred-awaiting-check' : 'in-foal',
      );
      const birth = event('birth', checkDate, 'foaling', 'live');
      assert.equal(buildMareBreedingState(mare([cover, birth]), now).status, 'bred-awaiting-check');
      assert.equal(
        buildMareBreedingState(mare([birth, cover]), now).status,
        coverDate.includes('T') && checkDate.includes('T') ? 'bred-awaiting-check' : 'foaled-live',
      );
    }
  }
});

test('uncertain and contradictory legacy outcomes cannot establish guarantees or pregnancy', async () => {
  const { foalingOutcome, pregnancyCheckOutcome } = await import('../src/lib/breedingIntelligence.js');
  for (const summary of [
    'Possible live foal',
    'Foal alive or dead unclear',
    'Live foal; stillborn',
    'Suspected loss',
    'Maybe healthy colt',
    'Foal alive; foal died',
  ]) {
    const record = { ...event('birth', '2026-04-01', 'foaling'), summary };
    assert.equal(foalingOutcome(record), 'unknown', summary);
    assert.equal(buildMareBreedingState(mare([record]), now).guarantee, 'not-recorded', summary);
  }
  for (const summary of ['Not open', 'Not negative', 'Not barren', 'Never empty']) {
    assert.equal(
      pregnancyCheckOutcome({ ...event('check', '2026-05-01', 'pregnancy-check'), summary }),
      'unknown',
      summary,
    );
  }
});

test('checkpoint days and latest checks share the normalized written calendar day', async () => {
  const { currentPregnancyOutcome } = await import('../src/lib/breedingIntelligence.js');
  assert.equal(
    currentPregnancyOutcome(
      [
        event('new-open', '2026-05-16', 'pregnancy-check', 'open'),
        event('older-positive', '2026-05-16T23:00:00-07:00', 'pregnancy-check', 'in-foal'),
      ],
      '2026-05-01',
    ),
    'unknown',
  );
  for (const date of ['2026-05-16', '2026-05-16T00:00:00+14:00', '2026-05-16T23:00:00-07:00']) {
    const state = buildMareBreedingState(
      mare([
        event('check', date, 'pregnancy-check', 'in-foal'),
        event('cover', '2026-05-01T23:00:00-07:00', 'breeding'),
      ]),
      new Date('2026-05-20T12:00:00Z'),
    );
    assert.equal(state.bredOn, '2026-05-01');
    assert.equal(
      state.overdueCheckpoints.some((check) => check.dayOffset === 15),
      false,
      date,
    );
  }
});

test('modal and anticipated wording stays uncertain across both outcome classifiers', async () => {
  const { foalingOutcome, pregnancyCheckOutcome } = await import('../src/lib/breedingIntelligence.js');
  for (const prefix of ['Likely', 'Probably', 'Possibly', 'Suspected', 'Presumed', 'Apparently', 'Tentative']) {
    assert.equal(
      foalingOutcome({ ...event('birth', '2026-04-01', 'foaling'), summary: `${prefix} live foal` }),
      'unknown',
      prefix,
    );
    assert.equal(
      pregnancyCheckOutcome({ ...event('check', '2026-04-01', 'pregnancy-check'), summary: `${prefix} in foal` }),
      'unknown',
      prefix,
    );
  }
  for (const summary of [
    'Might be pregnant',
    'May be open',
    'Could be pregnant',
    'Should be pregnant',
    'Would be pregnant',
    'Not sure she is open',
  ]) {
    assert.equal(
      pregnancyCheckOutcome({ ...event('check', '2026-04-01', 'pregnancy-check'), summary }),
      'unknown',
      summary,
    );
  }
  assert.equal(
    foalingOutcome({ ...event('birth', '2026-04-01', 'foaling'), summary: 'Live foal anticipated' }),
    'unknown',
  );
});
