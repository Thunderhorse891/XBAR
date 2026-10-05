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
  assert.equal(state.guarantee, 'none');
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
  assert.equal(breedingEntryDetails({ kind: 'foaling' }).ok, false);
  assert.deepEqual(breedingEntryDetails({ kind: 'foaling', result: 'unknown' }), {
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
