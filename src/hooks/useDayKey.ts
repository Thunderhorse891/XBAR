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

export function useDayKey(): string {
  const [dayKey, setDayKey] = useState(() => dayKeyFor(new Date()));

  useEffect(() => {
    // Re-armed from each firing rather than set as an interval, so a machine
    // that slept through midnight corrects on wake instead of drifting.
    const timer = window.setTimeout(() => setDayKey(dayKeyFor(new Date())), msUntilNextDay(new Date()));
    return () => window.clearTimeout(timer);
  }, [dayKey]);

  return dayKey;
}
