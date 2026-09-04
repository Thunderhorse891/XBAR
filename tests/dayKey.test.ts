import assert from 'node:assert/strict';
import test from 'node:test';

import { dayKeyFor, msUntilNextDay, trackDayKey } from '../src/hooks/useDayKey.js';
import type { DayKeyClock } from '../src/hooks/useDayKey.js';

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

/*
 * The re-arming half.
 *
 * `trackDayKey` is exported from the hook so the SECOND firing can be
 * asserted. The bug it was extracted for is invisible to anything that only
 * watches the first one: the effect used to depend on `[dayKey]`, so a firing
 * that computed the same key set no state, React skipped the render, the
 * effect never re-ran, and the one-shot timeout was gone for good.
 */

/** Mirrors MAX_CHECK_INTERVAL_MS in the hook. */
const BOUND = 10 * 60 * 1000;

/** What the tracker should wait: the nearer of the boundary and the bound. */
const expectedWait = (from: Date) => Math.min(msUntilNextDay(from), BOUND);

interface ArmedTimer {
  at: number;
  delay: number;
  handler: () => void;
}

function fakeClock(start: Date) {
  let nowMs = start.getTime();
  let nextId = 1;
  const armed = new Map<number, ArmedTimer>();
  const wakeHandlers = new Set<() => void>();

  const clock: DayKeyClock = {
    now: () => new Date(nowMs),
    setTimeout: (handler, delay) => {
      const id = nextId++;
      armed.set(id, { at: nowMs + delay, delay, handler });
      return id;
    },
    clearTimeout: (timer) => {
      armed.delete(timer);
    },
    subscribeToWake: (handler) => {
      wakeHandlers.add(handler);
      return () => wakeHandlers.delete(handler);
    },
  };

  const only = (): ArmedTimer => {
    assert.equal(armed.size, 1, `expected exactly one armed timer, found ${armed.size}`);
    return [...armed.values()][0];
  };

  const fireDue = () => {
    const id = [...armed.keys()][0];
    const timer = armed.get(id)!;
    armed.delete(id);
    nowMs = timer.at;
    timer.handler();
  };

  return {
    clock,
    armedCount: () => armed.size,
    wakeHandlerCount: () => wakeHandlers.size,
    /** The single pending timeout, asserting there is exactly one. */
    only,
    /** Runs the pending timeout. `landsAt` overrides where the clock actually is. */
    fire: (landsAt?: Date) => {
      const timer = only();
      const id = [...armed.keys()][0];
      armed.delete(id);
      nowMs = landsAt ? landsAt.getTime() : timer.at;
      timer.handler();
    },
    /** Runs every timeout that comes due on the way to `target`. */
    advanceTo: (target: Date) => {
      for (let guard = 0; guard < 10_000; guard += 1) {
        const timer = only();
        if (timer.at > target.getTime()) break;
        fireDue();
      }
      nowMs = Math.max(nowMs, target.getTime());
    },
    /** The tab is shown again, or the window refocused. */
    wake: () => {
      for (const handler of [...wakeHandlers]) handler();
    },
    setNow: (at: Date) => {
      nowMs = at.getTime();
    },
  };
}

test('the boundary still wins whenever it is nearer than the bounded check', () => {
  // The bound must never make a normal midnight arrive later than it used to.
  const clock = fakeClock(new Date(2026, 7, 24, 23, 59, 30));
  trackDayKey(() => {}, clock.clock);

  assert.equal(clock.only().delay, 31_000, 'half a minute from midnight, the timer still aims at midnight');
});

test('no single wait runs longer than the bounded check', () => {
  // Noon is twelve hours from the boundary. A timeout that long is only
  // correct while the clock underneath it holds still.
  const clock = fakeClock(new Date(2026, 7, 24, 12, 0, 0));
  trackDayKey(() => {}, clock.clock);

  assert.equal(clock.only().delay, BOUND);
});

test('a zone change that moves the local date FORWARD is noticed at the next bounded check', () => {
  // The opposite of the westward case below, and the one re-arming cannot fix:
  // the local calendar date rolls over BEFORE the armed timer, which is still
  // aimed at the old zone's midnight. The callback has not run yet, so there is
  // nothing to re-arm from — only a wait short enough to come back and look.
  const clock = fakeClock(new Date(2026, 7, 24, 12, 0, 0));
  const seen: string[] = [];
  trackDayKey((key) => seen.push(key), clock.clock);

  // The clock jumps east past midnight while the timer is pending.
  const jumped = new Date(2026, 7, 25, 0, 5, 0);
  clock.fire(jumped);

  assert.deepEqual(seen, ['2026-08-25'], 'the new day is reported without waiting for the old aim');
  assert.equal(clock.armedCount(), 1);
  assert.equal(clock.only().delay, expectedWait(jumped));
});

test('a firing that computes the same day still re-arms the timer', () => {
  // The westward case: the timeout aimed at the old midnight lands while the
  // local date is still yesterday. Under the old `[dayKey]` effect this was the
  // last timer ever armed, and every screen keyed on the day quietly froze.
  const clock = fakeClock(new Date(2026, 7, 24, 23, 59, 30));
  const seen: string[] = [];
  trackDayKey((key) => seen.push(key), clock.clock);

  const landed = new Date(2026, 7, 24, 23, 0, 31);
  clock.fire(landed);

  assert.deepEqual(seen, ['2026-08-24'], 'the firing reports the day it actually landed on');
  assert.equal(clock.armedCount(), 1, 'the timer must be re-armed even though the key did not change');
  assert.equal(
    clock.only().delay,
    expectedWait(landed),
    'the next wait is measured from where the clock really is, not from the old aim',
  );
});

test('the tracker keeps reporting across consecutive days', () => {
  // The pessimistic direction: re-arming must not stop after one boundary, and
  // must not report a day that has not arrived.
  const clock = fakeClock(new Date(2026, 7, 24, 12, 0, 0));
  const seen: string[] = [];
  trackDayKey((key) => seen.push(key), clock.clock);

  clock.advanceTo(new Date(2026, 7, 27, 12, 0, 0));

  assert.deepEqual(
    [...new Set(seen)],
    ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27'],
    'every day in the span is reported, in order, and no day that has not arrived is',
  );
  assert.equal(clock.armedCount(), 1, 'exactly one timer stays armed — re-arming must not accumulate');
});

test('a machine that slept through midnight measures the next wait from when it woke', () => {
  // This pins that the re-arm reads the clock rather than adding a fixed day to
  // the old aim, so a suspended laptop does not drift a little further from the
  // boundary every night.
  const clock = fakeClock(new Date(2026, 7, 24, 23, 59, 30));
  const seen: string[] = [];
  trackDayKey((key) => seen.push(key), clock.clock);

  const wokeLate = new Date(2026, 7, 25, 9, 15, 0);
  clock.fire(wokeLate);

  assert.deepEqual(seen, ['2026-08-25']);
  assert.equal(clock.only().delay, expectedWait(wokeLate));
});

test('showing the tab again reports the day immediately rather than at the next check', () => {
  // A zone change almost always arrives with a sleep or a switch away from the
  // tab, so the bounded check is the guarantee and this is what makes it feel
  // instant.
  const clock = fakeClock(new Date(2026, 7, 24, 23, 50, 0));
  const seen: string[] = [];
  trackDayKey((key) => seen.push(key), clock.clock);

  clock.setNow(new Date(2026, 7, 25, 0, 2, 0));
  clock.wake();

  assert.deepEqual(seen, ['2026-08-25']);
});

test('a wake re-aims the pending timer instead of leaving a stale one beside it', () => {
  const clock = fakeClock(new Date(2026, 7, 24, 12, 0, 0));
  trackDayKey(() => {}, clock.clock);

  const jumped = new Date(2026, 7, 25, 0, 2, 0);
  clock.setNow(jumped);
  clock.wake();

  assert.equal(clock.armedCount(), 1, 'the timer measured against the old clock must be replaced, not joined');
  assert.equal(clock.only().delay, expectedWait(jumped));
});

test('a clock with no wake support still tracks the day', () => {
  // `subscribeToWake` is optional: the bounded check is what guarantees
  // correctness, and a caller may supply a bare clock.
  const base = fakeClock(new Date(2026, 7, 24, 23, 59, 30));
  const bare: DayKeyClock = {
    now: base.clock.now,
    setTimeout: base.clock.setTimeout,
    clearTimeout: base.clock.clearTimeout,
  };
  const seen: string[] = [];
  const stop = trackDayKey((key) => seen.push(key), bare);

  base.fire();

  assert.deepEqual(seen, ['2026-08-25']);
  assert.equal(base.armedCount(), 1);
  stop();
  assert.equal(base.armedCount(), 0);
});

test('stopping clears the armed timer and unsubscribes', () => {
  const clock = fakeClock(new Date(2026, 7, 24, 12, 0, 0));
  const seen: string[] = [];
  const stop = trackDayKey((key) => seen.push(key), clock.clock);

  assert.equal(clock.armedCount(), 1, 'the first timer is armed on the spot, not on the first firing');
  assert.equal(clock.wakeHandlerCount(), 1);

  stop();

  assert.equal(clock.armedCount(), 0);
  assert.equal(clock.wakeHandlerCount(), 0, 'a listener left behind would outlive the screen that owns it');
  clock.wake();
  assert.deepEqual(seen, [], 'and must report nothing after the stop');
});

test('stopping from inside the callback does not leave a timer behind', () => {
  // Reporting a new day is exactly what makes a screen re-render, and that
  // render can be the one that unmounts it. A re-arm after the stop would be a
  // timer nothing holds a handle to any more.
  const clock = fakeClock(new Date(2026, 7, 24, 12, 0, 0));
  let stop = () => {};
  stop = trackDayKey(() => stop(), clock.clock);

  clock.fire();

  assert.equal(clock.armedCount(), 0, 'a stop during the callback must win over the re-arm');
});
