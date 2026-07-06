import type { SalesLead } from '../types/xbar.js';

export const buyerOfferStatuses = [
  'Submitted',
  'Countered',
  'Accepted',
  'Rejected',
  'Deposit Due',
  'Deposit Paid',
] as const satisfies readonly NonNullable<SalesLead['offerStatus']>[];

export const buyerDepositStatuses = ['Not Requested', 'Due', 'Paid'] as const satisfies readonly NonNullable<
  SalesLead['depositStatus']
>[];

export type BuyerOfferStatus = (typeof buyerOfferStatuses)[number];
export type BuyerDepositStatus = (typeof buyerDepositStatuses)[number];

export type BuyerOfferDraft = {
  amount: string;
  status: BuyerOfferStatus;
  buyerNote: string;
  counterOffer: string;
  depositAmount: string;
  depositStatus: BuyerDepositStatus;
  followUpDate: string;
  existingNotes?: string;
};

export type BuyerOfferPatch = Partial<
  Pick<
    SalesLead,
    | 'stage'
    | 'lastTouch'
    | 'nextFollowUp'
    | 'notes'
    | 'offerAmount'
    | 'counterOfferAmount'
    | 'offerStatus'
    | 'depositAmount'
    | 'depositStatus'
  >
>;

type MoneyParseResult = { ok: true; value?: number } | { ok: false; message: string };

function todayStamp(now: Date) {
  return now.toISOString().slice(0, 10);
}

function parsePositiveMoney(value: string, label: string, required = false): MoneyParseResult {
  const trimmed = value.trim();
  if (!trimmed) {
    return required ? { ok: false, message: `${label} is required.` } : { ok: true };
  }

  const parsed = Number(trimmed.replace(/[$,]/g, ''));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { ok: false, message: `${label} must be greater than $0.` };
  }

  return { ok: true, value: Math.round(parsed * 100) / 100 };
}

function mergeOfferNote(existingNotes: string | undefined, buyerNote: string) {
  const existing = existingNotes?.trim() ?? '';
  const note = buyerNote.trim();
  if (!note) return existing || undefined;

  const formatted = `Offer note: ${note}`;
  if (existing.includes(formatted)) return existing;
  return [existing, formatted].filter(Boolean).join('\n\n');
}

export function createBuyerOfferDraft(lead?: SalesLead): BuyerOfferDraft {
  return {
    amount: lead?.offerAmount ? String(lead.offerAmount) : '',
    status: lead?.offerStatus && lead.offerStatus !== 'Draft' ? lead.offerStatus : 'Submitted',
    buyerNote: '',
    counterOffer: lead?.counterOfferAmount ? String(lead.counterOfferAmount) : '',
    depositAmount: lead?.depositAmount ? String(lead.depositAmount) : '',
    depositStatus: lead?.depositStatus ?? 'Not Requested',
    followUpDate: lead?.nextFollowUp ?? '',
  };
}

export function buildBuyerOfferPatch(
  draft: BuyerOfferDraft,
  now = new Date(),
): { ok: true; amount: number; patch: BuyerOfferPatch } | { ok: false; message: string } {
  const amount = parsePositiveMoney(draft.amount, 'Offer amount', true);
  if (!amount.ok) return amount;
  if (amount.value === undefined) return { ok: false, message: 'Offer amount is required.' };

  const counterOffer = parsePositiveMoney(draft.counterOffer, 'Counteroffer');
  if (!counterOffer.ok) return counterOffer;

  const depositAmount = parsePositiveMoney(draft.depositAmount, 'Deposit amount');
  if (!depositAmount.ok) return depositAmount;

  if (draft.followUpDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.followUpDate)) {
    return { ok: false, message: 'Follow-up date must use YYYY-MM-DD.' };
  }

  const notes = mergeOfferNote(draft.existingNotes, draft.buyerNote);
  const patch: BuyerOfferPatch = {
    stage: 'Offer',
    lastTouch: todayStamp(now),
    offerAmount: amount.value,
    offerStatus: draft.status,
    depositStatus: draft.depositStatus,
  };

  if (counterOffer.value !== undefined) patch.counterOfferAmount = counterOffer.value;
  if (depositAmount.value !== undefined) patch.depositAmount = depositAmount.value;
  if (draft.followUpDate) patch.nextFollowUp = draft.followUpDate;
  if (notes !== undefined) patch.notes = notes;

  return { ok: true, amount: amount.value, patch };
}
