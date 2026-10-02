/*
 * Recording money received on a closed sale (audit F08).
 *
 * Marking a lead Won records what was agreed. It does not settle it: a buyer can
 * still owe the balance, or the deposit. The money engine counts a sale as
 * collected only from what is recorded here, so this is the one place that
 * decides whether a figure typed into the close-out form is believable.
 *
 * It refuses rather than guesses: an amount over the agreed price, a payment
 * without the day it landed, a day that has not happened yet. A wrong
 * "received" figure is worse than none, because the dashboard would show it as
 * banked and nobody would check it.
 */

export type SalePaymentResult =
  { ok: true; amountReceived?: number; amountReceivedOn?: string } | { ok: false; message: string };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

function isCalendarDay(value: string): boolean {
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function validateSalePayment(input: {
  /** Raw text from the amount field; blank means nothing recorded. */
  amount: string;
  /** Raw YYYY-MM-DD from the date field. */
  receivedOn: string;
  /** The agreed sale price: the counteroffer when there is one, else the offer. */
  saleValue: number;
  /** The viewer's local day, YYYY-MM-DD. */
  today: string;
}): SalePaymentResult {
  const rawAmount = input.amount.trim();
  const receivedOn = input.receivedOn.trim();

  if (!rawAmount) {
    if (receivedOn) return { ok: false, message: 'Enter the amount received, or clear the payment date.' };
    return { ok: true };
  }

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, message: 'Amount received must be $0 or more.' };
  }
  if (amount > 0 && !(input.saleValue > 0)) {
    return { ok: false, message: 'Record the agreed sale amount before the money received against it.' };
  }
  if (amount > input.saleValue && input.saleValue > 0) {
    return {
      ok: false,
      message: `Amount received ($${amount.toLocaleString()}) is more than the agreed sale price ($${input.saleValue.toLocaleString()}). Correct the price or the amount.`,
    };
  }
  if (amount > 0 && !receivedOn) {
    return { ok: false, message: 'Add the date the payment was received.' };
  }
  if (receivedOn && !isCalendarDay(receivedOn)) {
    return { ok: false, message: 'The payment date is not a real calendar day.' };
  }
  if (receivedOn && receivedOn > input.today) {
    return { ok: false, message: "A payment date can't be in the future -- record it once the money lands." };
  }

  return { ok: true, amountReceived: amount, ...(receivedOn ? { amountReceivedOn: receivedOn } : {}) };
}
