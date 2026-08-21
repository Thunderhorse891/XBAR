import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord, SalesLead } from '../types/xbar.js';
import {
  assessRevenueAtRisk,
  computeHorseEconomics,
  detectSpendAnomalies,
  type RevenueRiskAssessment,
  type SpendAnomaly,
} from './businessIntelligence.js';

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

/** Offer stages that represent money still in play. */
const OPEN_OFFER_STAGES = new Set(['New', 'Qualified', 'Offer']);

function sameMonth(value: string, now: Date): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Trailing three-month average spend across every receipt.
 *
 * Deliberately averaged over three whole months rather than over "months that
 * had receipts": a quiet month is a real month of low burn, and dropping it
 * would overstate what the operation actually costs to run.
 */
function trailingMonthlyBurn(receipts: ExpenseReceipt[], now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth() - 3, 1).getTime();
  const trailing = receipts.filter((receipt) => {
    const date = Date.parse(receipt.receiptDate);
    return !Number.isNaN(date) && date >= start && date <= now.getTime();
  });
  return Math.round(sum(trailing.map((receipt) => receipt.amount)) / 3);
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

  const openOffers = salesLeads.filter((lead) => OPEN_OFFER_STAGES.has(lead.stage) && lead.outcome !== 'Lost');

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
      pipelineValue: sum(openOffers.map((lead) => lead.offerAmount ?? 0)),
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
