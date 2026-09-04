import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord, SalesLead } from '../types/xbar.js';
import {
  assessRevenueAtRisk,
  isSaleInventory,
  computeHorseEconomics,
  detectSpendAnomalies,
  type RevenueRiskAssessment,
  type SpendAnomaly,
} from './businessIntelligence.js';
import { NON_LIVE_OFFER_STATUSES } from './profitIntelligence.js';
import { monthKeyForDate, monthKeyOf, trailingMonthKeys } from './receiptMonths.js';
import { dayKeyFor } from '../hooks/useDayKey.js';

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
  /** Everything the operation has put in: what horses cost to buy, plus spend. */
  investedToDate: number;
  /** Purchase prices of the horses on the roster. */
  acquisitionCost: number;
  /** Every receipt ever recorded, whether or not it is tied to a horse. */
  receiptSpend: number;
  /** Acquisitions plus the receipts tied to a horse. The rest is ranch overhead. */
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
  /**
   * Whether this horse is for sale, by the same predicate `listedCount` uses.
   *
   * Carried on the row rather than re-derived in the table, because the table
   * re-derived it as `askPrice > 0` and the two disagreed: a horse in Sale
   * Prep, Market Ready or Buyer Review with no asking price was counted as
   * listed by the summary and labelled "Not listed for sale" by the rows
   * underneath it. One predicate, one answer.
   */
  saleInventory: boolean;
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
  /**
   * Percent of receipt spend, as whole points that sum to exactly 100.
   *
   * Not `investedToDate` — acquisitions have no receipt behind them, so
   * dividing by a total that includes them would leave the categories summing
   * to less than 100 with nothing on the page explaining the gap.
   */
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
  /** The exact instant, for anything that needs ordering or a timestamp. */
  generatedAt: string;
  /** That instant as a local calendar date — what a reader is shown. */
  generatedOn: string;
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

/*
 * Every money total in this report goes through here, so this is where a value
 * that is not a number has to stop.
 *
 * `+` on a string CONCATENATES. Two captured offers of "1000" and "2000" made
 * the pipeline figure 10002000 rather than 3000 — off by a factor of three
 * thousand, on the page handed to a banker, with nothing on screen to suggest
 * anything was wrong. An object contributes NaN, which at least shows.
 *
 * Every writer of these fields is now type-checked (the restore shape table
 * refuses a non-finite amount, and `captureBuyerRoomOffer` and
 * `buildBuyerRoomEvent` both gate on `Number.isFinite`), so this is a backstop
 * rather than the fix. It is worth having anyway: a figure someone borrows
 * against should not depend on every upstream writer having been careful.
 *
 * A value that cannot be trusted contributes NOTHING rather than being coerced.
 * Coercing "1000" to 1000 would guess at what corrupt data meant; dropping it
 * understates the total, and for a pipeline figure understating is the safe
 * direction to be wrong in.
 */
/*
 * Money that can legitimately be added to a total.
 *
 * `|| 0` and `?? 0` catch a missing amount and pass a NEGATIVE one straight
 * through, and these two figures are the only readers of the lead amounts that
 * sum them raw — `profitIntelligence` already treats a non-positive offer as an
 * unrecorded sale price rather than a number. The Sales screen stored
 * `Number(value)` on a bare truthiness test, so `-500` was a value a rancher
 * could type and save; that door is shut now, but a workspace that went through
 * it already exists, and the fix for a wrong figure is not to reject the
 * rancher's whole backup on the way in.
 */
function positiveMoney(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => (Number.isFinite(value) ? total + value : total), 0);
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

/*
 * Whole-point shares that actually add up to 100.
 *
 * Rounding each category independently does not: with four categories it
 * misses 100 about a third of the time, landing anywhere from 98% to 102%.
 * That figure is printed beside every category on screen, written to the CSV,
 * read out as "N% of spend" in the banker-facing PDF, and used as a bar WIDTH —
 * so the error is visible three ways at once, and "the percentages on your
 * report do not add up" is exactly the kind of thing that costs a lender's
 * confidence in every other number on the page.
 *
 * Largest remainder: floor every share, then hand the leftover points to the
 * categories with the largest fractional parts. Each share stays within one
 * point of its exact value, the total is exactly 100, and a category too small
 * to earn a point still reports 0 rather than being rounded up out of nothing.
 *
 * With nothing spent the exact share is 0/0, so every share is 0 — a report
 * that renders "NaN%" to a banker is worse than one that renders nothing. The
 * empty-receipt case is not what exercises this: no receipts means no category
 * rows at all. A receipt logged with an amount of zero is what reaches the
 * apportionment with nothing to divide.
 */
function apportionCategoryShares(rows: { category: string; total: number; thisMonth: number }[]): CategorySpendRow[] {
  /*
   * The basis is derived from the rows rather than passed in, so it cannot
   * disagree with what is being divided.
   *
   * It was `receiptSpend`, computed separately over the same receipts, and the
   * two could differ: `sum` skips a non-finite amount and the category loop
   * added it raw, so one corrupt receipt left a category holding a total that
   * was never in the denominator. A single `"1000"` typed into a restored
   * backup produced a category reporting 200% of spend, drawn as a bar twice
   * the width of its track.
   *
   * Clamped to positive for the same reason `exact` can then never be
   * negative. A refund-shaped amount is not a share of anything, and a
   * negative percentage renders as a bar with a negative width. Neither writer
   * can produce one — the entry form refuses an amount that is not greater
   * than zero, and so does the restore preflight — so for every real workspace
   * this basis is exactly `receiptSpend` and the shares are unchanged. It
   * matters only for data that got in some other way, which is precisely when
   * a banker-facing page must not print nonsense.
   */
  const basis = rows.reduce(
    (total, row) => (Number.isFinite(row.total) && row.total > 0 ? total + row.total : total),
    0,
  );
  if (basis <= 0) return rows.map((row) => ({ ...row, share: 0 }));

  const exact = rows.map((row) => (Number.isFinite(row.total) && row.total > 0 ? (row.total / basis) * 100 : 0));
  const shares = exact.map((value) => Math.floor(value));
  let leftover = 100 - shares.reduce((total, value) => total + value, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    // Index breaks a tie, so two categories with identical remainders resolve
    // by the caller's order rather than by whatever sort happens to do.
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const entry of byRemainder) {
    if (leftover <= 0) break;
    shares[entry.index] += 1;
    leftover -= 1;
  }

  return rows.map((row, index) => ({ ...row, share: shares[index] }));
}

export function buildRanchReport(input: RanchReportInput, now: Date = new Date()): RanchReport {
  const { horses, documents, expenseReceipts, salesLeads, ownershipRecords } = input;

  /*
   * A horse with a Won lead has been SOLD, and the sale fields do not say so.
   *
   * Closing a lead as Won leaves the horse's `askPrice` and `listingState`
   * exactly as they were — the Sales editor changes the lead, not the horse —
   * so `isSaleInventory` still returns true and the old asking price kept
   * appearing under "Listed", "Ready to close" and "Held up" long after the
   * money came in. buildRanchFinancials already treats the same horse as
   * `'sold'`, so the Money screen and this report disagreed about the same
   * animal, in the UI, the CSV and the banker-facing PDF alike.
   *
   * `depositsHeld` below already carries this exact correction for the same
   * reason: a stale field left behind by a completed sale.
   *
   * Won, not Closed: the STAGE moves independently of the outcome, and a lead
   * can sit in Closed having been lost. Only an outcome of Won means the animal
   * left the herd.
   */
  const soldHorseIds = new Set(
    salesLeads.filter((lead) => lead.outcome === 'Won' && lead.horseId).map((lead) => lead.horseId),
  );
  const isSold = (horse: HorseRecord) => soldHorseIds.has(horse.id);
  /*
   * Sold horses are excluded from the RISK assessment, not from the report.
   * They keep their economics row below — what the operation put into them is
   * still real money and still belongs in the totals — but revenue that has
   * already been collected is not revenue at risk, and its blockers are moot.
   */
  const saleInventoryHorses = horses.filter((horse) => !isSold(horse));

  const risk = assessRevenueAtRisk(saleInventoryHorses, ownershipRecords, documents, now);
  const blockersByHorse = new Map(risk.items.map((item) => [item.horseId, item.blockers]));

  const horseRows: HorseEconomicsRow[] = horses.map((horse) => {
    const economics = computeHorseEconomics(horse, expenseReceipts, now);
    return {
      horseId: horse.id,
      horseName: horse.name,
      status: horse.status,
      saleInventory: isSaleInventory(horse) && !isSold(horse),
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
    // The same rule `sum` applies, for the same reason. `+=` on a string
    // CONCATENATES: a receipt amount of `"1000"` turned a category total into
    // the string `"01000"`, which then sorted, divided and rendered as though
    // it were money. This was the one money total in the report that did not
    // go through `sum`, and so the one that could disagree with it.
    if (!Number.isFinite(receipt.amount)) continue;
    const bucket = categoryTotals.get(receipt.category) ?? { total: 0, thisMonth: 0 };
    bucket.total += receipt.amount;
    if (sameMonth(receipt.receiptDate, now)) bucket.thisMonth += receipt.amount;
    categoryTotals.set(receipt.category, bucket);
  }

  const receiptSpend = sum(expenseReceipts.map((receipt) => receipt.amount));
  const categories: CategorySpendRow[] = apportionCategoryShares(
    [...categoryTotals.entries()]
      .map(([category, bucket]) => ({ category, total: bucket.total, thisMonth: bucket.thisMonth }))
      // Name breaks a tie on equal spend so the order — and therefore which
      // category absorbs a leftover point below — is the same on every run.
      .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category)),
  );

  // What the horses cost to buy. Real money the operation has put in, and
  // invisible until now: a horse bought for $10,000 with no receipts against it
  // reported $0 invested in the UI, the CSV and the banker-facing PDF alike.
  const acquisitionCost = sum(horses.map((horse) => Math.max(0, horse.costBasis ?? 0)));

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
  /*
   * A recorded outcome of ANY kind means the deal is closed.
   *
   * This excluded `Lost` and not `Won`, so a lead that had been won and was
   * later moved back to `Offer` counted its new amount as open pipeline while
   * `soldHorseIds` above counted the same horse as sold — the report
   * contradicting itself about one animal, in the CSV and the banker-facing
   * PDF as much as on screen.
   *
   * `!lead.outcome` rather than naming the two values: "no outcome recorded"
   * is the condition that actually means live, and it stays correct if a third
   * outcome is ever added.
   *
   * The store no longer produces that state — reopening a closed lead clears
   * its outcome — but this is the figure a banker reads, so it does not depend
   * on every writer upstream getting it right.
   */
  const openOffers = salesLeads.filter(
    (lead) =>
      OPEN_OFFER_STAGES.has(lead.stage) &&
      !lead.outcome &&
      !NON_LIVE_OFFER_STATUSES.has(lead.offerStatus ?? '') &&
      /*
       * The horse, not just the lead.
       *
       * A horse can carry several leads, and winning one does not close the
       * others — `updateSalesLead` patches only `item.id === leadId`. So a
       * sibling still sitting in Offer has no outcome of its own and passed
       * every test above, while `soldHorseIds` counted the same animal as sold.
       * The report contradicted itself about one horse again, by a second
       * route: the animal is gone, and its asking price was still being
       * reported as money in play.
       *
       * `depositsHeld` deliberately does NOT get this correction, and the
       * difference is the point. Pipeline value is money expected to COME IN,
       * which a horse that has already left the herd cannot produce. A deposit
       * is money already sitting in the ranch's account, and the losing buyer's
       * deposit is genuinely still held until it is refunded or forfeited.
       */
      !(lead.horseId && soldHorseIds.has(lead.horseId)),
  );

  return {
    generatedAt: now.toISOString(),
    // The same instant as a LOCAL calendar date, because that is the calendar
    // every other figure here is computed in. `generatedAt.slice(0, 10)` is the
    // UTC day: for a ranch in Denver generating a report at 6pm, it reads as
    // tomorrow, on a page whose monthly totals are keyed to today.
    generatedOn: dayKeyFor(now),
    horseCount: horses.length,
    // The risk assessment's own predicate, not a second copy of it. Testing
    // `askPrice > 0` here counted fewer horses than the blockers list directly
    // below reported on — a horse in Sale Prep with no price yet is sale
    // inventory, and the report disagreed with itself about that.
    listedCount: saleInventoryHorses.filter(isSaleInventory).length,
    documentsToReview: documents.filter(
      (document) => document.state === 'Needs Review' || document.state === 'Queued' || document.state === 'Matched',
    ).length,
    money: {
      investedToDate: receiptSpend + acquisitionCost,
      acquisitionCost,
      receiptSpend,
      investedInHorses:
        acquisitionCost + sum(expenseReceipts.filter((receipt) => receipt.horseId).map((receipt) => receipt.amount)),
      // Receipts only. A purchase price carries no date, so it cannot be
      // attributed to a month without inventing one — and a horse bought two
      // years ago would land in whatever month this report was run.
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
      pipelineValue: sum(
        openOffers.map((lead) => positiveMoney(lead.counterOfferAmount) || positiveMoney(lead.offerAmount)),
      ),
      // Money the operation is holding that is not yet its own.
      //
      // A deposit on a deal closed as Won has been applied to the sale — the
      // Sales editor leaves `depositStatus: 'Paid'` in place afterwards, so
      // counting on that field alone kept the deposit on the books forever and
      // overstated the figure in the UI, the CSV and the banker-facing PDF.
      //
      // `Lost` is deliberately still counted: that money is usually sitting in
      // the ranch's account pending a refund or a forfeiture decision, so it is
      // genuinely still held. Only a completed sale has consumed it.
      depositsHeld: sum(
        salesLeads
          .filter((lead) => lead.depositStatus === 'Paid' && lead.outcome !== 'Won')
          .map((lead) => positiveMoney(lead.depositAmount)),
      ),
    },
    readiness,
    horses: horseRows,
    categories,
    anomalies: detectSpendAnomalies(expenseReceipts, now),
    risk,
  };
}
