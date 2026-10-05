import type { ExpenseReceipt } from '../types/xbar.js';
import { monthKeyOf, trailingMonthKeys } from './receiptMonths.js';
const DAY_MS = 86_400_000;
/** The calendar day a receipt was written for, as a day number, or null when unreadable. */
export function receiptDay(value: string | undefined): number | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const time = Date.UTC(year, month - 1, day);
    const check = new Date(time);
    // Date.UTC rolls February 30 into March; a date that does not exist is unreadable.
    if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
    return time / DAY_MS;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / DAY_MS;
}

/** Today in the viewer's zone, as a day number. */
export function localDay(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
}

/** Only dated, finite, nonnegative receipts on or before the report day are spend. */
export function recordedReceipts(receipts: ExpenseReceipt[], now: Date): ExpenseReceipt[] {
  const today = localDay(now);
  return receipts.filter((receipt) => {
    const day = receiptDay(receipt.receiptDate);
    return (
      day !== null &&
      day <= today &&
      typeof receipt.amount === 'number' &&
      Number.isFinite(receipt.amount) &&
      receipt.amount >= 0
    );
  });
}

/** Coverage describes presence, never a claim that every receipt was entered. */
export function observedReceiptMonths(receipts: ExpenseReceipt[], now: Date): string[] {
  const months = trailingMonthKeys(now, 3);
  const observed = new Set(recordedReceipts(receipts, now).map((receipt) => monthKeyOf(receipt.receiptDate)));
  return months.filter((month) => observed.has(month));
}

/** Recorded-spend average only: an absent month is unknown, not zero. */
export function recordedMonthlyBurn(receipts: ExpenseReceipt[], now: Date): number | null {
  const dated = recordedReceipts(receipts, now);
  const months = trailingMonthKeys(now, 3);
  if (observedReceiptMonths(dated, now).length !== months.length) return null;
  return Math.round(
    dated
      .filter((receipt) => months.includes(monthKeyOf(receipt.receiptDate) ?? ''))
      .reduce((total, receipt) => total + receipt.amount, 0) / 3,
  );
}
