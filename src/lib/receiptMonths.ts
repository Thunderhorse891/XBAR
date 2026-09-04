/*
 * Which calendar month a receipt belongs to.
 *
 * Two defects lived in this arithmetic, in two files each, and both changed
 * numbers a rancher would hand to a banker.
 *
 * The first was time zones. `new Date('2026-08-01')` is parsed as UTC midnight
 * per the ECMAScript date-only form, so in any negative-UTC zone — which is
 * every US ranch — it lands on July 31 locally. Reading `.getMonth()` off it
 * then filed receipts dated the 1st under the previous month, quietly dropping
 * them from "spent this month" and from each category's monthly total.
 *
 * A receipt date is calendar data, not an instant: `2026-08-01` means August
 * whether it is read in Denver or Berlin. So the month is taken from the string
 * itself and never round-tripped through a Date.
 *
 * The second was the trailing window. A range starting three months back and
 * ending today spans FOUR calendar months — May, June, July and part of August
 * on August 21 — and was divided by three. An operation spending $300 a month
 * reported $400. Months here are whole and complete, and there are exactly
 * three of them.
 */

/** `2026-08`, from either a date-only value or a full timestamp. */
export function monthKeyOf(receiptDate: string): string | null {
  const raw = String(receiptDate ?? '').trim();
  if (!raw) return null;

  // A bare calendar date — the form receipts are actually stored in. It names a
  // month outright, so it is read from the text with no Date involved and no
  // zone can move it.
  const dateOnly = /^(\d{4})-(\d{2})-\d{2}$/.exec(raw);
  if (dateOnly) return `${dateOnly[1]}-${dateOnly[2]}`;

  // Anything with a time is an instant, not a calendar date, so it is parsed
  // and read in the local zone — the month the person looking at it would say
  // it happened in. Taking the UTC month from the text instead would move an
  // evening receipt near a month boundary into the following month.
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : monthKeyForDate(parsed);
}

/** `2026-08`, from a Date, read in local time. */
export function monthKeyForDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The last `count` COMPLETE months before `now`, most recent first.
 *
 * The current month is deliberately excluded. Including it averages a partial
 * month against whole ones, so a burn figure would drop every 1st of the month
 * and climb back over the following weeks — the same operation appearing to get
 * cheaper and dearer with the calendar.
 */
export function trailingMonthKeys(now: Date, count = 3): string[] {
  return Array.from({ length: count }, (_, index) =>
    monthKeyForDate(new Date(now.getFullYear(), now.getMonth() - (index + 1), 1)),
  );
}
