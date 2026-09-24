import type {
  ExpenseCategory,
  ExpenseReceipt,
  HorseRecord,
  SalesLead,
  SubscriptionProfile,
  SubscriptionTier,
} from '../types/xbar.js';
import { hasActivePaidPlan } from './subscriptionDecision.js';
import { subscriptionTierConfig } from './xbarRuntime.js';

/*
 * Cost per horse per day — the number a rancher can hold a supplier, a sale
 * price and a subscription against.
 *
 * Every figure here is a sum of receipts the rancher logged. Nothing is
 * estimated to fill a gap: with no horses in care there is no per-horse figure,
 * a feed receipt without a quantity has no unit price, and a supplier with one
 * priced delivery has no history to rise against. Each of those comes back as
 * null or empty so the screen can say what to add, rather than a number nobody
 * would think to check.
 *
 * Days are calendar days, compared day against day. A receipt dated
 * 'YYYY-MM-DD' is that day wherever the rancher is; parsing it as an instant
 * would file a receipt dated the 1st under the previous day in US time zones
 * (the defect receiptMonths.ts records for month keys).
 */

/** How far back the headline figures look. */
export const COST_WINDOW_DAYS = 90;
/** Weekly points in the trend line — 13 weeks covers the 90-day window. */
export const TREND_WEEKS = 13;
/** A delivery at least this much above the supplier's own recent price is flagged. */
export const PRICE_RISE_THRESHOLD = 0.05;
/** How many earlier deliveries form a supplier's baseline price. */
const PRICE_BASELINE_PURCHASES = 3;
/** Trend change needs this much history to compare the last 30 days against. */
const TREND_MIN_DAYS = 60;
const TREND_RECENT_DAYS = 30;
export const DAYS_PER_MONTH = 365.25 / 12;
const DAY_MS = 86_400_000;

export type CostGroup = 'Feed' | 'Care' | 'Vet' | 'General';

export const COST_GROUPS: readonly CostGroup[] = ['Feed', 'Care', 'Vet', 'General'];

const GROUP_FOR_CATEGORY: Record<ExpenseCategory, CostGroup> = {
  Feed: 'Feed',
  Supplements: 'Feed',
  Bedding: 'Feed',
  Farrier: 'Care',
  Wormer: 'Care',
  'Dental Float': 'Care',
  'Vet Care': 'Vet',
  Travel: 'General',
};

export function costGroupFor(category: string): CostGroup {
  return GROUP_FOR_CATEGORY[category as ExpenseCategory] ?? 'General';
}

export type CostGroupDaily = {
  group: CostGroup;
  total: number;
  perHorsePerDay: number | null;
  /** Fraction of the per-horse spend this group accounts for, 0–1. */
  share: number;
};

export type HorseDailyCost = {
  horseId: string;
  horseName: string;
  /** Receipts tagged to this horse inside the window. */
  direct: number;
  /** This horse's even share of ranch-wide receipts inside the window. */
  sharedShare: number;
  perDay: number;
};

export type CostTrendPoint = {
  /** First day of the week, 'YYYY-MM-DD'. */
  weekStart: string;
  total: number;
  /** Null for a week that ended before the first receipt, or with no horses in care. */
  perHorsePerDay: number | null;
};

export type SupplierPriceRise = {
  vendor: string;
  /** The receipt description of the latest delivery — what was bought. */
  product: string;
  category: string;
  unit: string;
  latestUnitPrice: number;
  baselineUnitPrice: number;
  /** Whole percent above the baseline. */
  risePercent: number;
  /** What the deliveries since the rise cost above the supplier's price before it. */
  extraCost: number;
  latestDate: string;
  latestQuantity: number;
  comparedPurchases: number;
  /** The first delivery that came in above the earlier price: when the rise began. */
  risingSince: string;
  /** Deliveries at or since the rise, the latest included. */
  deliveriesSinceRise: number;
};

export type FeedSupplierSummary = {
  vendor: string;
  purchases: number;
  spend: number;
  latestUnitPrice: number | null;
  unit: string | null;
};

export type CostPerHorseSummary = {
  horsesInCare: number;
  /** Days of records the burn window covers: 0 with no receipts, never more than COST_WINDOW_DAYS. */
  trackedDays: number;
  /**
   * Days the per-horse figures cover — measured from the first receipt that is
   * actually split across the herd, so an old receipt for a sold horse cannot
   * stretch today's spend over months it was not part of. Never more than
   * trackedDays.
   */
  perHorseDays: number;
  /** Every receipt in the window, including ones tagged to horses no longer in care. */
  windowTotal: number;
  /** Window spend normalised to an average month. */
  monthlyBurn: number;
  perHorsePerDay: number | null;
  groups: CostGroupDaily[];
  horses: HorseDailyCost[];
  trend: CostTrendPoint[];
  /** Whole percent change of the last 30 days against the rest of the window; null without enough history. */
  trendChangePercent: number | null;
  priceRises: SupplierPriceRise[];
  /**
   * Products with a delivery in the window that had an earlier delivery to
   * compare with. Zero means "not enough history", which is not the same as
   * "no supplier raised prices".
   */
  priceComparisons: number;
  feedSuppliers: FeedSupplierSummary[];
  /** Feed, supplement and bedding receipts in the window logged without a quantity and unit. */
  unpricedFeedPurchases: number;
};

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
function localDay(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS;
}

function isoDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function normalizeKey(value: string | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function validAmount(receipt: ExpenseReceipt): number | null {
  const amount = Number(receipt.amount);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

/** Unit price for a feed receipt, or null when it was logged without a usable quantity and unit. */
export function unitPriceOf(receipt: Pick<ExpenseReceipt, 'amount' | 'quantity' | 'unit'>): number | null {
  const quantity = Number(receipt.quantity);
  const amount = Number(receipt.amount);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  if (!normalizeKey(receipt.unit)) return null;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount / quantity;
}

/*
 * A unit as a comparison key. The Unit field is free text, so "bale", "Bales"
 * and "bales" are one unit; each word is lowered and made singular. Anything
 * else ("lb" and "pound") stays distinct: a missed comparison beats a false alarm.
 */
function singularUnitWord(word: string): string {
  if (/^\d/.test(word) || word.length <= 2) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (/(x|ch|sh|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

function receiptTokens(text: string | undefined): string[] {
  return (
    String(text ?? '')
      .toLowerCase()
      .match(/\d+(?:[.,]\d+)*|[a-z]+/g) ?? []
  ).map((token) => (/^\d/.test(token) ? token.replace(/,/g, '') : token));
}

export function unitKeyOf(unit: string | undefined): string {
  return receiptTokens(unit).map(singularUnitWord).join(' ');
}

/*
 * What was bought, from the receipt description, so grass hay and alfalfa by
 * the bale from one supplier are two prices, not one that "rose". Only the
 * quantity phrase is dropped: the receipt's own unit words, with the count in
 * front of them ("40 bales", "4 x 50 lb bags"). Every other number stays,
 * because it can name the product: 10% and 12% sweet feed are two feeds.
 * Different wording is a different product: a missed comparison beats a false
 * alarm.
 */
export function productKeyOf(receipt: Pick<ExpenseReceipt, 'title' | 'unit'>): string {
  const unitWords = new Set(unitKeyOf(receipt.unit).split(' ').filter(Boolean));
  const isUnit = (token: string | undefined) => token !== undefined && unitWords.has(singularUnitWord(token));
  const isNumber = (token: string | undefined) => token !== undefined && /^\d/.test(token);
  const tokens = receiptTokens(receipt.title);
  const kept: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (isNumber(token)) {
      // A count, an optional "x", then unit words: the whole phrase is quantity.
      let next = index + 1;
      if (tokens[next] === 'x') next += 1;
      if (isUnit(tokens[next])) {
        while (isUnit(tokens[next])) next += 1;
        index = next - 1;
        continue;
      }
      kept.push(token);
    } else if (!isUnit(token)) {
      kept.push(token);
    }
  }
  return kept.join(' ');
}

/** Horses with a won sale are no longer eating the ranch's feed. */
function soldHorseIds(leads: SalesLead[]): Set<string> {
  return new Set(leads.filter((lead) => lead.outcome === 'Won').map((lead) => lead.horseId));
}

type DatedReceipt = { receipt: ExpenseReceipt; day: number; amount: number };

function buildPriceRises(dated: DatedReceipt[], today: number): { rises: SupplierPriceRise[]; comparisons: number } {
  const series = new Map<string, Array<DatedReceipt & { unitPrice: number }>>();
  for (const entry of dated) {
    if (costGroupFor(entry.receipt.category) !== 'Feed') continue;
    const unitPrice = unitPriceOf(entry.receipt);
    if (unitPrice === null || !normalizeKey(entry.receipt.vendor)) continue;
    const key = [
      normalizeKey(entry.receipt.vendor),
      entry.receipt.category,
      productKeyOf(entry.receipt),
      unitKeyOf(entry.receipt.unit),
    ].join('|');
    const list = series.get(key) ?? [];
    list.push({ ...entry, unitPrice });
    series.set(key, list);
  }

  const rises: SupplierPriceRise[] = [];
  let comparisons = 0;
  for (const purchases of series.values()) {
    if (purchases.length < 2) continue;
    purchases.sort(
      (left, right) =>
        left.day - right.day || String(left.receipt.uploadedAt).localeCompare(String(right.receipt.uploadedAt)),
    );
    const inWindow = (index: number) => today - purchases[index]!.day < COST_WINDOW_DAYS;
    // The supplier's own price before a delivery: its last few deliveries.
    const priceBefore = (index: number) => {
      const prior = purchases.slice(Math.max(0, index - PRICE_BASELINE_PURCHASES), index);
      return prior.reduce((sum, entry) => sum + entry.unitPrice, 0) / prior.length;
    };
    if (purchases.some((_, index) => index > 0 && inWindow(index))) comparisons += 1;

    /*
     * Every delivery in the window is checked against the deliveries before
     * it. The rise is the earliest one that has held since: every delivery
     * from it to the latest still at least 5% above the price before it. So a
     * price that went up and stayed up is still flagged after the dearer
     * deliveries have become the recent history, a spike that came back down
     * neither counts nor hides a newer rise, and a rise last spring is not
     * something to act on today.
     */
    const heldFrom = (index: number) => {
      const before = priceBefore(index);
      return (
        before > 0 &&
        purchases.slice(index).every((entry) => (entry.unitPrice - before) / before >= PRICE_RISE_THRESHOLD)
      );
    };
    const start = purchases.findIndex((_, index) => index > 0 && inWindow(index) && heldFrom(index));
    if (start < 0) continue;
    const baseline = priceBefore(start);
    const latest = purchases[purchases.length - 1]!;
    const rise = (latest.unitPrice - baseline) / baseline;
    const sinceRise = purchases.slice(start);
    const extraCost = sinceRise.reduce(
      (sum, entry) => sum + Math.max(0, entry.unitPrice - baseline) * Number(entry.receipt.quantity),
      0,
    );
    rises.push({
      vendor: latest.receipt.vendor.trim(),
      product: String(latest.receipt.title ?? '').trim(),
      category: latest.receipt.category,
      unit: unitKeyOf(latest.receipt.unit),
      latestUnitPrice: latest.unitPrice,
      baselineUnitPrice: baseline,
      risePercent: Math.round(rise * 100),
      extraCost: Math.round(extraCost * 100) / 100,
      latestDate: latest.receipt.receiptDate,
      latestQuantity: Number(latest.receipt.quantity),
      comparedPurchases: Math.min(PRICE_BASELINE_PURCHASES, start),
      risingSince: purchases[start]!.receipt.receiptDate,
      deliveriesSinceRise: sinceRise.length,
    });
  }
  return { rises: rises.sort((left, right) => right.extraCost - left.extraCost), comparisons };
}

function buildFeedSuppliers(windowReceipts: DatedReceipt[]): FeedSupplierSummary[] {
  const suppliers = new Map<
    string,
    { summary: FeedSupplierSummary; latestPricedDay: number; latestUploadedAt: string }
  >();
  for (const entry of windowReceipts) {
    if (costGroupFor(entry.receipt.category) !== 'Feed') continue;
    const key = normalizeKey(entry.receipt.vendor) || 'unspecified supplier';
    const existing = suppliers.get(key) ?? {
      summary: {
        vendor: entry.receipt.vendor.trim() || 'Unspecified supplier',
        purchases: 0,
        spend: 0,
        latestUnitPrice: null,
        unit: null,
      },
      latestPricedDay: -Infinity,
      latestUploadedAt: '',
    };
    existing.summary.purchases += 1;
    existing.summary.spend += entry.amount;
    const unitPrice = unitPriceOf(entry.receipt);
    // Same-day purchases are ordered by upload time, as the price watch does;
    // the store lists newest first, so arrival order alone would pick the older.
    const uploadedAt = String(entry.receipt.uploadedAt ?? '');
    const newer =
      entry.day > existing.latestPricedDay ||
      (entry.day === existing.latestPricedDay && uploadedAt.localeCompare(existing.latestUploadedAt) > 0);
    if (unitPrice !== null && newer) {
      existing.latestPricedDay = entry.day;
      existing.latestUploadedAt = uploadedAt;
      existing.summary.latestUnitPrice = unitPrice;
      existing.summary.unit = unitKeyOf(entry.receipt.unit);
    }
    suppliers.set(key, existing);
  }
  return [...suppliers.values()].map((entry) => entry.summary).sort((left, right) => right.spend - left.spend);
}

export function buildCostPerHorse(input: {
  horses: Pick<HorseRecord, 'id' | 'name'>[];
  receipts: ExpenseReceipt[];
  salesLeads?: SalesLead[];
  now?: Date;
}): CostPerHorseSummary {
  const now = input.now ?? new Date();
  const today = localDay(now);
  const sold = soldHorseIds(input.salesLeads ?? []);
  const inCare = input.horses.filter((horse) => !sold.has(horse.id));
  const inCareIds = new Set(inCare.map((horse) => horse.id));
  const headcount = inCare.length;

  // Future-dated receipts have not been spent yet and stay out of every figure.
  const dated: DatedReceipt[] = input.receipts.flatMap((receipt) => {
    const day = receiptDay(receipt.receiptDate);
    const amount = validAmount(receipt);
    return day !== null && amount !== null && day <= today ? [{ receipt, day, amount }] : [];
  });

  /*
   * Per-horse figures count receipts for horses in care plus ranch-wide ones.
   * A receipt tagged to a sold (or deleted) horse was real money and stays in
   * the burn, but spreading it over the horses still here would inflate what
   * each of them costs.
   */
  const isAllocated = (receipt: ExpenseReceipt) => !receipt.horseId || inCareIds.has(receipt.horseId);
  const allocatedDated = dated.filter((entry) => isAllocated(entry.receipt));

  // Two windows. The burn runs from the first receipt of any kind; the
  // per-horse figures from the first receipt they actually count, or an old
  // sold-horse receipt would divide today's herd spend by months of nothing.
  const windowDays = (first: number) => (Number.isFinite(first) ? Math.min(COST_WINDOW_DAYS, today - first + 1) : 0);
  const firstDay = dated.reduce((min, entry) => Math.min(min, entry.day), Infinity);
  const trackedDays = windowDays(firstDay);
  const windowReceipts = dated.filter((entry) => entry.day >= today - trackedDays + 1);
  const allocatedFirstDay = allocatedDated.reduce((min, entry) => Math.min(min, entry.day), Infinity);
  const perHorseDays = windowDays(allocatedFirstDay);
  const allocatedWindow = allocatedDated.filter((entry) => entry.day >= today - perHorseDays + 1);

  let windowTotal = 0;
  let shared = 0;
  const direct = new Map<string, number>();
  const groupAllocated = new Map<CostGroup, number>(COST_GROUPS.map((group) => [group, 0]));
  let unpricedFeedPurchases = 0;
  for (const entry of windowReceipts) {
    windowTotal += entry.amount;
    if (costGroupFor(entry.receipt.category) === 'Feed' && unitPriceOf(entry.receipt) === null) {
      unpricedFeedPurchases += 1;
    }
  }
  for (const entry of allocatedWindow) {
    const group = costGroupFor(entry.receipt.category);
    groupAllocated.set(group, (groupAllocated.get(group) ?? 0) + entry.amount);
    if (entry.receipt.horseId) {
      direct.set(entry.receipt.horseId, (direct.get(entry.receipt.horseId) ?? 0) + entry.amount);
    } else {
      shared += entry.amount;
    }
  }
  const allocated = [...groupAllocated.values()].reduce((sum, value) => sum + value, 0);
  const perDayDivisor = perHorseDays > 0 && headcount > 0 ? perHorseDays * headcount : 0;

  const groups: CostGroupDaily[] = COST_GROUPS.map((group) => {
    const total = groupAllocated.get(group) ?? 0;
    return {
      group,
      total,
      perHorsePerDay: perDayDivisor ? total / perDayDivisor : null,
      share: allocated > 0 ? total / allocated : 0,
    };
  });

  const horses: HorseDailyCost[] =
    perHorseDays > 0
      ? inCare
          .map((horse) => {
            const own = direct.get(horse.id) ?? 0;
            const sharedShare = headcount > 0 ? shared / headcount : 0;
            return {
              horseId: horse.id,
              horseName: horse.name,
              direct: own,
              sharedShare,
              perDay: (own + sharedShare) / perHorseDays,
            };
          })
          .sort((left, right) => right.perDay - left.perDay || left.horseName.localeCompare(right.horseName))
      : [];

  const trend: CostTrendPoint[] = Array.from({ length: TREND_WEEKS }, (_, index) => {
    // Thirteen weeks are 91 days; the first is trimmed to the 90-day window so
    // the line never shows a receipt the headline figures leave out.
    const end = today - (TREND_WEEKS - index - 1) * 7;
    const start = Math.max(end - 6, today - COST_WINDOW_DAYS + 1);
    const total = allocatedDated
      .filter((entry) => entry.day >= start && entry.day <= end)
      .reduce((sum, entry) => sum + entry.amount, 0);
    // A week that ended before anything was logged is missing history, not a $0
    // week; the week records began in is divided by the days it actually covers.
    const known = Number.isFinite(allocatedFirstDay) && end >= allocatedFirstDay && headcount > 0;
    const daysCovered = end - Math.max(start, allocatedFirstDay) + 1;
    return { weekStart: isoDay(start), total, perHorsePerDay: known ? total / daysCovered / headcount : null };
  });

  let trendChangePercent: number | null = null;
  if (perHorseDays >= TREND_MIN_DAYS && headcount > 0) {
    const recentStart = today - TREND_RECENT_DAYS + 1;
    const recent = allocatedWindow.filter((entry) => entry.day >= recentStart).reduce((s, e) => s + e.amount, 0);
    const earlier = allocatedWindow.filter((entry) => entry.day < recentStart).reduce((s, e) => s + e.amount, 0);
    const recentDaily = recent / TREND_RECENT_DAYS;
    const earlierDaily = earlier / (perHorseDays - TREND_RECENT_DAYS);
    if (earlierDaily > 0) trendChangePercent = Math.round(((recentDaily - earlierDaily) / earlierDaily) * 100);
  }

  const priceWatch = buildPriceRises(dated, today);

  return {
    horsesInCare: headcount,
    trackedDays,
    perHorseDays,
    windowTotal,
    monthlyBurn: trackedDays > 0 ? (windowTotal / trackedDays) * DAYS_PER_MONTH : 0,
    perHorsePerDay: perDayDivisor ? allocated / perDayDivisor : null,
    groups,
    horses,
    trend,
    trendChangePercent,
    priceRises: priceWatch.rises,
    priceComparisons: priceWatch.comparisons,
    feedSuppliers: buildFeedSuppliers(windowReceipts),
    unpricedFeedPurchases,
  };
}

export type SubscriptionPayback = {
  planMonthlyRate: number;
  /** What the plan costs per horse per day, or null with no horses or no plan price. */
  planPerHorsePerDay: number | null;
  /** The plan's share of what each horse already costs per day, 0–1; null when either side is unknown. */
  shareOfDailyCost: number | null;
  /** Extra paid above suppliers' own baseline prices on flagged deliveries in the window. */
  priceRiseOverpay: number;
  /** How many months of the plan the flagged overpay equals; null without a plan price. */
  planMonthsCovered: number | null;
};

export type PaybackPlan = {
  tier: SubscriptionTier;
  monthlyRate: number;
  /** True when this is a plan the workspace is paying for now; false means a list price. */
  paying: boolean;
};

/**
 * The price the payback card measures against. A plan being paid for now is
 * measured at its own rate. Anything else — never subscribed, lapsed,
 * canceled — is measured at the list price of the plan it is on, and says so:
 * a canceled workspace keeps its old rate on file while paying nothing, so
 * the stored rate alone is not what anyone pays.
 */
export function paybackPlan(subscription: SubscriptionProfile): PaybackPlan {
  if (hasActivePaidPlan(subscription)) {
    return { tier: subscription.tier, monthlyRate: subscription.monthlyRate, paying: true };
  }
  return { tier: subscription.tier, monthlyRate: subscriptionTierConfig[subscription.tier].monthlyRate, paying: false };
}

/**
 * Answers "is this subscription paying for itself?" from the same figures.
 *
 * It compares the plan against what the rancher already spends, and counts the
 * supplier overpay XBAR caught. It never claims money was saved: a flagged
 * price rise is money the rancher can now act on, not money returned.
 */
export function buildSubscriptionPayback(summary: CostPerHorseSummary, planMonthlyRate: number): SubscriptionPayback {
  const rate = Number.isFinite(planMonthlyRate) && planMonthlyRate > 0 ? planMonthlyRate : 0;
  const planPerHorsePerDay = rate > 0 && summary.horsesInCare > 0 ? rate / DAYS_PER_MONTH / summary.horsesInCare : null;
  const shareOfDailyCost =
    planPerHorsePerDay !== null && summary.perHorsePerDay !== null && summary.perHorsePerDay > 0
      ? planPerHorsePerDay / summary.perHorsePerDay
      : null;
  const priceRiseOverpay = Math.round(summary.priceRises.reduce((sum, rise) => sum + rise.extraCost, 0) * 100) / 100;
  return {
    planMonthlyRate: rate,
    planPerHorsePerDay,
    shareOfDailyCost,
    priceRiseOverpay,
    planMonthsCovered: rate > 0 ? priceRiseOverpay / rate : null,
  };
}
