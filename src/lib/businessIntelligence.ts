import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord } from '../types/xbar.js';
import { normalizeOwnershipRecord } from '../store/xbarStoreLogic.js';

/*
 * Business intelligence over the structured records: prices the operational
 * risk in dollars and flags spend running above trend. Every finding carries
 * its own corrective action (label + route) — a number without a way to act
 * on it is not allowed to leave this module.
 */

export interface RevenueRiskItem {
  horseId: string;
  horseName: string;
  askPrice: number;
  blockers: string[];
  actionLabel: string;
  actionRoute: string;
}

export interface RevenueRiskAssessment {
  totalListedValue: number;
  valueAtRisk: number;
  readyValue: number;
  items: RevenueRiskItem[];
}

const COGGINS_VALID_DAYS = 365;

function hasCurrentCoggins(horseId: string, documents: DocumentRecord[], now: Date): boolean {
  return documents.some((document) => {
    if (document.horseId !== horseId || document.type !== 'Coggins') return false;
    if (document.state === 'Archived') return false;
    const uploaded = Date.parse(document.uploadedAt);
    if (Number.isNaN(uploaded)) return false;
    return (now.getTime() - uploaded) / 86_400_000 <= COGGINS_VALID_DAYS;
  });
}

// A horse counts as sale inventory when it carries an asking price or is in
// sale prep. Risk = listed dollars a buyer cannot close on today.
export function assessRevenueAtRisk(
  horses: HorseRecord[],
  ownershipRecords: OwnershipRecord[],
  documents: DocumentRecord[],
  now: Date = new Date(),
): RevenueRiskAssessment {
  const items: RevenueRiskItem[] = [];
  let totalListedValue = 0;
  let valueAtRisk = 0;

  for (const horse of horses) {
    const askPrice = horse.sale?.askPrice ?? 0;
    const listed =
      askPrice > 0 ||
      horse.status === 'Sale Prep' ||
      horse.sale?.listingState === 'Market Ready' ||
      horse.sale?.listingState === 'Buyer Review';
    if (!listed) continue;
    totalListedValue += askPrice;

    const blockers: string[] = [];
    let actionLabel = '';
    let actionRoute = '';

    const record = ownershipRecords.find((item) => item.horseId === horse.id);
    if (!record) {
      blockers.push('No ownership record — proof chain not started');
      actionLabel = `Start proof chain for ${horse.name}`;
      actionRoute = '/ownership';
    } else {
      const normalized = normalizeOwnershipRecord(record);
      const unverified = (normalized.proofRequirements ?? []).filter((item) => item.status !== 'verified');
      if (normalized.transferStatus !== 'Clear') {
        blockers.push(
          unverified.length
            ? `Transfer ${normalized.transferStatus.toLowerCase()} — ${unverified.length} proof${unverified.length === 1 ? '' : 's'} unverified`
            : `Transfer status ${normalized.transferStatus} — ready to mark Clear`,
        );
        actionLabel = unverified.length ? `Verify proofs for ${horse.name}` : `Mark ${horse.name} transfer Clear`;
        actionRoute = '/ownership';
      }
    }

    if (!hasCurrentCoggins(horse.id, documents, now)) {
      blockers.push('No current Coggins on file (12-month window)');
      if (!actionLabel) {
        actionLabel = `Upload Coggins for ${horse.name}`;
        actionRoute = `/documents?upload=1&horse=${horse.id}`;
      }
    }

    if (horse.status === 'Medical Review') {
      blockers.push('Active medical review — buyer disclosure required');
      if (!actionLabel) {
        actionLabel = `Review care hold for ${horse.name}`;
        actionRoute = `/medical?horse=${horse.id}`;
      }
    }

    if (blockers.length) {
      valueAtRisk += askPrice;
      items.push({ horseId: horse.id, horseName: horse.name, askPrice, blockers, actionLabel, actionRoute });
    }
  }

  items.sort((a, b) => b.askPrice - a.askPrice);
  return { totalListedValue, valueAtRisk, readyValue: totalListedValue - valueAtRisk, items };
}

export interface SpendAnomaly {
  category: string;
  monthTotal: number;
  trailingAverage: number;
  deltaPercent: number;
  actionLabel: string;
  actionRoute: string;
}

const ANOMALY_THRESHOLD_PERCENT = 25;
const MINIMUM_MONTH_SPEND = 50;

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

// Flags categories where this month's spend runs more than 25% above the
// trailing three-month average (ignoring trivial totals).
export function detectSpendAnomalies(receipts: ExpenseReceipt[], now: Date = new Date()): SpendAnomaly[] {
  const currentKey = monthKey(now);
  const trailingKeys = [1, 2, 3].map((offset) => monthKey(new Date(now.getFullYear(), now.getMonth() - offset, 1)));

  const totals = new Map<string, { current: number; trailing: number }>();
  for (const receipt of receipts) {
    const date = new Date(receipt.receiptDate);
    if (Number.isNaN(date.getTime())) continue;
    const key = monthKey(date);
    const bucket = totals.get(receipt.category) ?? { current: 0, trailing: 0 };
    if (key === currentKey) bucket.current += receipt.amount;
    else if (trailingKeys.includes(key)) bucket.trailing += receipt.amount;
    totals.set(receipt.category, bucket);
  }

  const anomalies: SpendAnomaly[] = [];
  for (const [category, bucket] of totals) {
    const trailingAverage = bucket.trailing / 3;
    if (bucket.current < MINIMUM_MONTH_SPEND || trailingAverage <= 0) continue;
    const deltaPercent = Math.round(((bucket.current - trailingAverage) / trailingAverage) * 100);
    if (deltaPercent >= ANOMALY_THRESHOLD_PERCENT) {
      anomalies.push({
        category,
        monthTotal: Math.round(bucket.current),
        trailingAverage: Math.round(trailingAverage),
        deltaPercent,
        actionLabel: `Review ${category.toLowerCase()} receipts`,
        actionRoute: '/expenses',
      });
    }
  }

  anomalies.sort((a, b) => b.deltaPercent - a.deltaPercent);
  return anomalies;
}

export interface HorseEconomics {
  horseId: string;
  costToDate: number;
  monthlyBurn: number;
  askPrice: number;
  projectedMargin: number;
  breakEvenPrice: number;
  safeDiscountFloor: number;
  marginPercent: number;
}

const CARRY_MONTHS = 2; // expected months on market while a buyer closes
const PROTECTED_MARGIN = 0.15; // never discount below cost + 15%

// Margin intelligence for a sale horse: what it cost, what it burns per
// month, where break-even sits once carry cost is included, and the lowest
// price a seller should accept without giving the margin away.
export function computeHorseEconomics(
  horse: HorseRecord,
  receipts: ExpenseReceipt[],
  now: Date = new Date(),
): HorseEconomics {
  const horseReceipts = receipts.filter((receipt) => receipt.horseId === horse.id);
  const costToDate = horseReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);

  const trailingStart = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime();
  const trailingSpend = horseReceipts.reduce((sum, receipt) => {
    const date = Date.parse(receipt.receiptDate);
    return !Number.isNaN(date) && date >= trailingStart && date <= now.getTime() ? sum + receipt.amount : sum;
  }, 0);
  const monthlyBurn = Math.round(trailingSpend / 3);

  const askPrice = horse.sale?.askPrice ?? 0;
  const breakEvenPrice = Math.round(costToDate + monthlyBurn * CARRY_MONTHS);
  const safeDiscountFloor = Math.round(breakEvenPrice * (1 + PROTECTED_MARGIN));
  const projectedMargin = askPrice > 0 ? askPrice - breakEvenPrice : 0;
  const marginPercent = askPrice > 0 ? Math.round((projectedMargin / askPrice) * 100) : 0;

  return { horseId: horse.id, costToDate, monthlyBurn, askPrice, projectedMargin, breakEvenPrice, safeDiscountFloor, marginPercent };
}
