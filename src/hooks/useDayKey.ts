import { useEffect, useState } from 'react';

/*
 * A value that changes when the calendar date does, and at no other time.
 *
 * Screens that compute anything from "today" — this month's spend, a trailing
 * window, an expiry verdict — memoize on their data and go stale when the data
 * has not changed but the day has. A tab left open on the Reports screen
 * overnight kept yesterday's answers until a horse or a receipt was edited.
 *
 * A key rather than a Date so it can sit in a dependency array without
 * re-running anything at every render, and a timer aimed at the boundary rather
 * than a poll, so a screen open all day wakes once.
 */

/** Local calendar date, not an instant — `toISOString` would be the UTC day. */
export function dayKeyFor(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Milliseconds until local midnight.
 *
 * Built from the calendar fields rather than by adding 24 hours, so it lands on
 * the real boundary across a daylight-saving change instead of an hour off.
 */
export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  // A second past the boundary: a timer that fires a millisecond early would
  // recompute the same day and then wait a further full day to correct itself.
  return Math.max(1, next.getTime() - now.getTime() + 1000);
}

/** The clock and timer the tracker runs on, injectable so the re-arming is testable. */
export interface DayKeyClock {
  now: () => Date;
  setTimeout: (handler: () => void, ms: number) => number;
  clearTimeout: (timer: number) => void;
}

const browserClock: DayKeyClock = {
  now: () => new Date(),
  setTimeout: (handler, ms) => window.setTimeout(handler, ms),
  clearTimeout: (timer) => window.clearTimeout(timer),
};

/**
 * Reports the local day key at every midnight until the returned stop is called.
 *
 * Each timeout is armed BY THE PREVIOUS CALLBACK, not by an effect re-running
 * on a changed key. The effect used to depend on `[dayKey]`, which reads as
 * "re-arm whenever the day changes" and is a chain with one weak link: a firing
 * that computes the SAME key sets no new state, so React skips the render, the
 * effect never re-runs, and the one-shot timeout is gone. The hook is then dead
 * until the route remounts, and every screen built on it silently keeps
 * yesterday's month, window and expiry answers.
 *
 * A same-key firing is not exotic. Move the system clock west — a laptop
 * carried across a time zone, or an OS correcting itself — and the timer aimed
 * at the old zone's midnight arrives while the local date is still yesterday.
 * That is exactly when a report must keep tracking the day, and exactly when
 * the old shape stopped.
 *
 * Re-arming from the callback also keeps the original intent: each timeout is
 * measured from when it actually fired, so a machine that slept through
 * midnight corrects on wake rather than drifting.
 *
 * Lives outside the hook because the bug is invisible to anything that only
 * watches the first firing, and the second firing is what has to be asserted.
 */
export function trackDayKey(onDayKey: (dayKey: string) => void, clock: DayKeyClock = browserClock): () => void {
  let timer = 0;
  let stopped = false;

  const arm = () => {
    timer = clock.setTimeout(() => {
      onDayKey(dayKeyFor(clock.now()));
      // `onDayKey` can be the last thing a screen does before it unmounts, and
      // a re-arm after the stop would outlive it as a timer nothing can clear.
      if (!stopped) arm();
    }, msUntilNextDay(clock.now()));
  };

  arm();

  return () => {
    stopped = true;
    clock.clearTimeout(timer);
  };
}

export function useDayKey(): string {
  const [dayKey, setDayKey] = useState(() => dayKeyFor(new Date()));

  // `setDayKey` is stable, so this effect belongs to the mount rather than to
  // any particular day — which is the whole point of `trackDayKey`.
  useEffect(() => trackDayKey(setDayKey), []);

  return dayKey;
}
