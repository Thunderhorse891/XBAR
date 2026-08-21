import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord, SalesLead } from '../types/xbar.js';
import {
  assessRevenueAtRisk,
  computeHorseEconomics,
  detectSpendAnomalies,
  type RevenueRiskAssessment,
  type SpendAnomaly,
} from './businessIntelligence.js';
import { NON_LIVE_OFFER_STATUSES } from './profitIntelligence.js';
import { monthKeyForDate, monthKeyOf, trailingMonthKeys } from './receiptMonths.js';

/*
 * The whole-operation report, in dollars.
 *
 * The Reports screen used to show three counts and a readiness donut. None of
 * it was money, and none of it left the app — a rancher could not hand any of
 * it to a banker, an accountant, or a partner.
 *
 * The arithmetic underneath is not new: assessRevenueAtRisk,
 * computeHorseEconomics and detectSpendAnomalies already existed and were
 * already tested, but were only ever surfaced per-horse in the sale-packet
 * wizard and as alerts on the reminders screen. This module composes them into
 * one herd-level picture so there is a single place that answers "where is my
 * money, and what is holding it up".
 *
 * Kept free of React and of the store so it can be tested directly and reused
 * by the export path without a browser.
 */

export interface RanchReportMoney {
  /** Every receipt ever recorded, whether or not it is tied to a horse. */
  investedToDate: number;
  /** Receipts tied to a specific horse. The remainder is general ranch spend. */
  investedInHorses: number;
  investedThisMonth: number;
  /** Trailing three-month average spend across the whole operation. */
  monthlyBurn: number;
  /** Asking prices of everything listed for sale. */
  listedValue: number;
  /** Listed dollars a buyer cannot close on today. */
  valueAtRisk: number;
  readyValue: number;
  /** Open offers that have not been won or lost. */
  pipelineValue: number;
  depositsHeld: number;
}

export interface HorseEconomicsRow {
  horseId: string;
  horseName: string;
  status: string;
  investedToDate: number;
  monthlyBurn: number;
  askPrice: number;
  breakEvenPrice: number;
  projectedMargin: number;
  marginPercent: number;
  safeDiscountFloor: number;
  readinessScore: number;
  /** Why this horse cannot be sold today. Empty when nothing is blocking it. */
  blockers: string[];
}

export interface CategorySpendRow {
  category: string;
  total: number;
  /** Percent of investedToDate, rounded. */
  share: number;
  thisMonth: number;
}

export interface RanchReportReadiness {
  average: number;
  ready: number;
  gettingThere: number;
  notReady: number;
}

export interface RanchReport {
  generatedAt: string;
  horseCount: number;
  listedCount: number;
  documentsToReview: number;
  money: RanchReportMoney;
  readiness: RanchReportReadiness;
  /** Sorted so the horse costing the most money sits at the top. */
  horses: HorseEconomicsRow[];
  /** Sorted by total spend, largest first. */
  categories: CategorySpendRow[];
  anomalies: SpendAnomaly[];
  risk: RevenueRiskAssessment;
}

export interface RanchReportInput {
  horses: HorseRecord[];
  documents: DocumentRecord[];
  expenseReceipts: ExpenseReceipt[];
  salesLeads: SalesLead[];
  ownershipRecords: OwnershipRecord[];
}

/** How many complete months the burn figure averages over. */
const TRAILING_MONTHS = 3;

/** Offer stages that represent money still in play. */
const OPEN_OFFER_STAGES = new Set(['New', 'Qualified', 'Offer']);

function sameMonth(value: string, now: Date): boolean {
  // Compared as calendar months, never as instants. See receiptMonths.ts: a
  // date-only value is parsed as UTC, so in US time zones a receipt dated the
  // 1st read as the previous month and vanished from this month's totals.
  return monthKeyOf(value) === monthKeyForDate(now);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Average spend over the three complete months before this one.
 *
 * Averaged over three whole months rather than over "months that had
 * receipts": a quiet month is a real month of low burn, and dropping it would
 * overstate what the operation actually costs to run. The current month is
 * excluded for the same reason in reverse — it is partial, and averaging it
 * against whole months would make the figure fall every 1st and climb back
 * over the following weeks.
 */
function trailingMonthlyBurn(receipts: ExpenseReceipt[], now: Date): number {
  // Exactly the three complete months before this one, so the divisor matches
  // the period. A range from three months back to today spans FOUR calendar
  // months and was divided by three: an operation spending $300 a month
  // reported $400, in the UI, the CSV and the banker-facing PDF alike.
  const window = new Set(trailingMonthKeys(now, TRAILING_MONTHS));
  const trailing = receipts.filter((receipt) => {
    const key = monthKeyOf(receipt.receiptDate);
    return key !== null && window.has(key);
  });
  return Math.round(sum(trailing.map((receipt) => receipt.amount)) / TRAILING_MONTHS);
}

export function buildRanchReport(input: RanchReportInput, now: Date = new Date()): RanchReport {
  const { horses, documents, expenseReceipts, salesLeads, ownershipRecords } = input;

  const risk = assessRevenueAtRisk(horses, ownershipRecords, documents, now);
  const blockersByHorse = new Map(risk.items.map((item) => [item.horseId, item.blockers]));

  const horseRows: HorseEconomicsRow[] = horses.map((horse) => {
    const economics = computeHorseEconomics(horse, expenseReceipts, now);
    return {
      horseId: horse.id,
      horseName: horse.name,
      status: horse.status,
      investedToDate: economics.costToDate,
      monthlyBurn: economics.monthlyBurn,
      askPrice: economics.askPrice,
      breakEvenPrice: economics.breakEvenPrice,
      projectedMargin: economics.projectedMargin,
      marginPercent: economics.marginPercent,
      safeDiscountFloor: economics.safeDiscountFloor,
      readinessScore: horse.readiness?.score ?? 0,
      blockers: blockersByHorse.get(horse.id) ?? [],
    };
  });
  horseRows.sort((a, b) => b.investedToDate - a.investedToDate);

  const categoryTotals = new Map<string, { total: number; thisMonth: number }>();
  for (const receipt of expenseReceipts) {
    const bucket = categoryTotals.get(receipt.category) ?? { total: 0, thisMonth: 0 };
    bucket.total += receipt.amount;
    if (sameMonth(receipt.receiptDate, now)) bucket.thisMonth += receipt.amount;
    categoryTotals.set(receipt.category, bucket);
  }

  const investedToDate = sum(expenseReceipts.map((receipt) => receipt.amount));
  const categories: CategorySpendRow[] = [...categoryTotals.entries()]
    .map(([category, bucket]) => ({
      category,
      total: bucket.total,
      // Guarded rather than assumed non-zero: with no receipts at all this is
      // 0/0, and a report that renders "NaN%" to a banker is worse than one
      // that renders nothing.
      share: investedToDate > 0 ? Math.round((bucket.total / investedToDate) * 100) : 0,
      thisMonth: bucket.thisMonth,
    }))
    .sort((a, b) => b.total - a.total);

  const scores = horses.map((horse) => horse.readiness?.score ?? 0);
  const readiness: RanchReportReadiness = {
    average: scores.length ? Math.round(sum(scores) / scores.length) : 0,
    ready: scores.filter((score) => score >= 95).length,
    gettingThere: scores.filter((score) => score >= 75 && score < 95).length,
    notReady: scores.filter((score) => score < 75).length,
  };

  // Money genuinely still on the table.
  //
  // The stage alone is not enough: the Sales editor moves stage and offer
  // status independently, so a lead can sit in 'Offer' with a status of
  // 'Draft' (never sent) or 'Rejected' (dead). Counting either would quote a
  // pipeline figure to a banker that no buyer has agreed to.
  //
  // The predicate is buildRanchFinancials's, using its own exported set rather
  // than a second copy of the rule — a report that disagrees with the Money
  // screen about the same number is worse than either being wrong alone. A
  // legacy lead with no status is deliberately not in that set, so it still
  // counts through the stage.
  const openOffers = salesLeads.filter(
    (lead) =>
      OPEN_OFFER_STAGES.has(lead.stage) &&
      lead.outcome !== 'Lost' &&
      !NON_LIVE_OFFER_STATUSES.has(lead.offerStatus ?? ''),
  );

  return {
    generatedAt: now.toISOString(),
    horseCount: horses.length,
    listedCount: horseRows.filter((row) => row.askPrice > 0).length,
    documentsToReview: documents.filter(
      (document) => document.state === 'Needs Review' || document.state === 'Queued' || document.state === 'Matched',
    ).length,
    money: {
      investedToDate,
      investedInHorses: sum(expenseReceipts.filter((receipt) => receipt.horseId).map((receipt) => receipt.amount)),
      investedThisMonth: sum(
        expenseReceipts.filter((receipt) => sameMonth(receipt.receiptDate, now)).map((receipt) => receipt.amount),
      ),
      monthlyBurn: trailingMonthlyBurn(expenseReceipts, now),
      listedValue: risk.totalListedValue,
      valueAtRisk: risk.valueAtRisk,
      readyValue: risk.readyValue,
      // The counter when there is one, like buildRanchFinancials: once a buyer
      // has countered, the counter is what is actually on the table, and
      // reporting the original ask would overstate the pipeline.
      pipelineValue: sum(openOffers.map((lead) => lead.counterOfferAmount || lead.offerAmount || 0)),
      depositsHeld: sum(
        salesLeads.filter((lead) => lead.depositStatus === 'Paid').map((lead) => lead.depositAmount ?? 0),
      ),
    },
    readiness,
    horses: horseRows,
    categories,
    anomalies: detectSpendAnomalies(expenseReceipts, now),
    risk,
  };
}
