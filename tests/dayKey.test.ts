import assert from 'node:assert/strict';
import test from 'node:test';

import { dayKeyFor, msUntilNextDay } from '../src/hooks/useDayKey.js';

/*
 * The Reports screen computes half its numbers from the clock — the generated
 * date, "this month", the trailing window, the anomalies measured against it —
 * and memoized them on the data alone, so a tab left open overnight kept
 * yesterday's answers. This is the value that makes the day boundary
 * observable to a dependency array.
 */

test('the key is the local calendar day, not the UTC one', () => {
  // 7pm on the 24th in a negative-UTC zone is already the 25th in UTC. A key
  // built from toISOString would roll over five hours early for the ranchers
  // this product is sold to.
  const evening = new Date(2026, 7, 24, 19, 30, 0);
  assert.equal(dayKeyFor(evening), '2026-08-24');
});

test('single-digit months and days are padded, so keys compare as equal only when the day is', () => {
  assert.equal(dayKeyFor(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
  assert.notEqual(dayKeyFor(new Date(2026, 0, 5)), dayKeyFor(new Date(2026, 0, 15)));
});

test('the timer aims at the next local midnight', () => {
  const justBefore = new Date(2026, 7, 24, 23, 59, 30);
  const wait = msUntilNextDay(justBefore);

  // 30 seconds, plus the deliberate one-second overshoot.
  assert.equal(wait, 31_000);

  const fired = new Date(justBefore.getTime() + wait);
  assert.equal(dayKeyFor(fired), '2026-08-25', 'the key must have changed by the time the timer fires');
});

test('the wait is never zero or negative', () => {
  // A timeout of 0 at exactly midnight would spin, recomputing the same key.
  const midnight = new Date(2026, 7, 24, 0, 0, 0, 0);
  assert.ok(msUntilNextDay(midnight) > 0);
  assert.equal(msUntilNextDay(midnight), 24 * 60 * 60 * 1000 + 1000);
});

test('a day that is not 24 hours long still lands on the boundary', () => {
  // Built from calendar fields rather than by adding 24 hours, so a
  // daylight-saving transition does not put the refresh an hour off. In
  // America/Denver, 2026-11-01 is a 25-hour day.
  const before = new Date(2026, 9, 31, 12, 0, 0);
  const fired = new Date(before.getTime() + msUntilNextDay(before));

  assert.equal(dayKeyFor(fired), '2026-11-01', 'the timer must land on the next calendar day, whatever its length');
});
