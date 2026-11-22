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

test('mixed recorded days and offset instants cannot cycle or discard unanimous evidence', async () => {
  const { chronologicalBreedingEvents, currentPregnancyOutcome } = await import('../src/lib/breedingIntelligence.js');
  const dates = ['2026-01-01T23:59:00-12:00', '2026-01-02', '2026-01-03T00:01:00+14:00'];
  const permutations = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const order of permutations) {
    const rows = order.map((index) => event(String(index), dates[index]!, 'pregnancy-check', 'in-foal'));
    assert.equal(currentPregnancyOutcome(rows, '', now), 'positive', String(order));
    assert.equal(buildMareBreedingState(mare(rows), now).status, 'in-foal', String(order));
    assert.deepEqual(
      chronologicalBreedingEvents(rows, now).map(({ id }) => id),
      ['0', '2', '1'],
    );
    assert.equal(
      currentPregnancyOutcome(
        rows.map((row) => (row.id === '1' ? event('1', dates[1]!, 'pregnancy-check', 'open') : row)),
        '',
        now,
      ),
      'unknown',
      String(order),
    );
  }
});

test('a cross-offset check cannot prove it followed an adjacent written-day cover', () => {
  const cover = event('cover', '2026-01-02', 'breeding');
  const unclearCheck = event('ambiguous-check', '2026-01-03T00:01:00+14:00', 'pregnancy-check', 'in-foal');
  const laterCheck = event('later-check', '2026-01-04T00:01:00+14:00', 'pregnancy-check', 'in-foal');
  for (const timeline of [
    [unclearCheck, cover],
    [cover, unclearCheck],
  ]) {
    assert.equal(buildMareBreedingState(mare(timeline), now).status, 'bred-awaiting-check');
    assert.equal(buildMareBreedingState(mare([...timeline, laterCheck]), now).status, 'in-foal');
  }
});

test('unresolved written and UTC order cannot let one conflicting birth override the other', () => {
  const cover = event('cover', '2025-03-01', 'breeding');
  const loss = event('loss', '2026-01-02', 'foaling', 'loss');
  const live = event('live', '2026-01-03T00:01:00+14:00', 'foaling', 'live');
  for (const births of [
    [loss, live],
    [live, loss],
  ]) {
    assert.equal(buildMareBreedingState(mare([...births, cover]), now).status, 'foaling-unknown');
  }
});

test('incomparable covers never borrow dates, sires or episode outcomes from display ordering', () => {
  const cover = (id: string, date: string, mateName: string): TimelineEvent => ({
    ...event(id, date, 'breeding'),
    details: { recordType: 'breeding', mateName },
  });
  const a = cover('a', '2026-01-02', 'Stallion A');
  const b = cover('b', '2026-01-03T00:01:00+14:00', 'Stallion B');
  const check = event('check', '2026-01-01T23:00:00-12:00', 'pregnancy-check', 'in-foal');
  const later = event('later', '2026-01-05T00:00:00-06:00', 'pregnancy-check', 'in-foal');
  const clear = cover('clear', '2026-01-04T00:30:00-06:00', 'Stallion C');
  const rows = [a, b, check];
  for (const order of [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ]) {
    const timeline = order.map((index) => rows[index]!);
    for (const [events, status] of [
      [timeline, 'pregnancy-unknown'],
      [[later, ...timeline], 'in-foal'],
      [[event('late-open', later.date, 'pregnancy-check', 'open'), ...timeline], 'open'],
    ] as const) {
      const state = buildMareBreedingState(mare([...events]), now);
      assert.equal(state.status, status, String(order));
      assert.equal(state.bredOn, undefined);
      assert.equal(state.mateName, undefined);
      assert.equal(state.expectedFoalingDate, undefined);
      assert.equal(state.guarantee, 'not-recorded');
    }
    const resolved = buildMareBreedingState(mare([later, clear, ...timeline]), now);
    assert.equal(resolved.status, 'in-foal');
    assert.equal(resolved.bredOn, '2026-01-04');
    assert.equal(resolved.mateName, 'Stallion C');
    assert.ok(resolved.expectedFoalingDate);
  }
  const sameDay = event('same-day', '2026-01-02T12:00:00Z', 'pregnancy-check', 'in-foal');
  assert.equal(buildMareBreedingState(mare([a, sameDay, b]), now).status, 'pregnancy-unknown');
  const withRecordedOrder = buildMareBreedingState(mare([sameDay, a, b]), now);
  assert.equal(withRecordedOrder.status, 'in-foal');
  assert.equal(withRecordedOrder.mateName, undefined);
});

test('incomparable covers keep unanimous later births and do not revive a pre-birth check', () => {
  const first = event('date-cover', '2026-01-02', 'breeding');
  const second = event('exact-cover', '2026-01-03T00:01:00+14:00', 'breeding');
  const check = event('positive', '2026-01-05T10:00:00Z', 'pregnancy-check', 'in-foal');
  const births = [
    event('birth-day', '2026-02-02', 'foaling', 'live'),
    event('birth-time', '2026-02-03T00:01:00+14:00', 'foaling', 'live'),
  ];
  for (const covers of [
    [first, second],
    [second, first],
  ]) {
    assert.equal(buildMareBreedingState(mare([...births, check, ...covers]), now).status, 'foaled-live');
    const conflict = [births[0]!, event('different-birth', births[1]!.date, 'foaling', 'loss')];
    assert.equal(buildMareBreedingState(mare([...conflict, check, ...covers]), now).status, 'foaling-unknown');
  }
});
