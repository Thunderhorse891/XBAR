import type { ExpenseCategory, ExpenseReceipt, HorseRecord, SalesLead } from '../types/xbar.js';

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
  /** What the latest delivery cost above the supplier's own baseline price. */
  extraCost: number;
  latestDate: string;
  latestQuantity: number;
  comparedPurchases: number;
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
 * What was bought, from the receipt description, so grass hay and alfalfa by
 * the bale from one supplier are two prices, not one that "rose". Digits,
 * punctuation and the receipt's own unit words are dropped, so "Grass hay - 40
 * bales" and "grass hay" are the same product. Different wording is treated as
 * a different product: a missed comparison is better than a false alarm.
 */
export function productKeyOf(receipt: Pick<ExpenseReceipt, 'title' | 'unit'>): string {
  let text = ` ${String(receipt.title ?? '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')} `;
  for (const word of normalizeKey(receipt.unit).split(' ')) {
    const letters = word.replace(/[^a-z]/g, '');
    if (letters.length > 1) text = text.replace(new RegExp(` ${letters}s? `, 'g'), ' ');
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Horses with a won sale are no longer eating the ranch's feed. */
function soldHorseIds(leads: SalesLead[]): Set<string> {
  return new Set(leads.filter((lead) => lead.outcome === 'Won').map((lead) => lead.horseId));
}

type DatedReceipt = { receipt: ExpenseReceipt; day: number; amount: number };

function buildPriceRises(dated: DatedReceipt[], today: number): SupplierPriceRise[] {
  const series = new Map<string, Array<DatedReceipt & { unitPrice: number }>>();
  for (const entry of dated) {
    if (costGroupFor(entry.receipt.category) !== 'Feed') continue;
    const unitPrice = unitPriceOf(entry.receipt);
    if (unitPrice === null || !normalizeKey(entry.receipt.vendor)) continue;
    const key = [
      normalizeKey(entry.receipt.vendor),
      entry.receipt.category,
      productKeyOf(entry.receipt),
      normalizeKey(entry.receipt.unit),
    ].join('|');
    const list = series.get(key) ?? [];
    list.push({ ...entry, unitPrice });
    series.set(key, list);
  }

  const rises: SupplierPriceRise[] = [];
  for (const purchases of series.values()) {
    if (purchases.length < 2) continue;
    purchases.sort(
      (left, right) =>
        left.day - right.day || String(left.receipt.uploadedAt).localeCompare(String(right.receipt.uploadedAt)),
    );
    const latest = purchases[purchases.length - 1]!;
    // A rise last spring is not something to act on today.
    if (today - latest.day >= COST_WINDOW_DAYS) continue;
    const compared = purchases.slice(-1 - PRICE_BASELINE_PURCHASES, -1);
    const baseline = compared.reduce((sum, entry) => sum + entry.unitPrice, 0) / compared.length;
    if (baseline <= 0) continue;
    const rise = (latest.unitPrice - baseline) / baseline;
    if (rise < PRICE_RISE_THRESHOLD) continue;
    const quantity = Number(latest.receipt.quantity);
    rises.push({
      vendor: latest.receipt.vendor.trim(),
      product: String(latest.receipt.title ?? '').trim(),
      category: latest.receipt.category,
      unit: String(latest.receipt.unit).trim(),
      latestUnitPrice: latest.unitPrice,
      baselineUnitPrice: baseline,
      risePercent: Math.round(rise * 100),
      extraCost: Math.round((latest.unitPrice - baseline) * quantity * 100) / 100,
      latestDate: latest.receipt.receiptDate,
      latestQuantity: quantity,
      comparedPurchases: compared.length,
    });
  }
  return rises.sort((left, right) => right.extraCost - left.extraCost);
}

function buildFeedSuppliers(windowReceipts: DatedReceipt[]): FeedSupplierSummary[] {
  const suppliers = new Map<string, { summary: FeedSupplierSummary; latestPricedDay: number }>();
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
    };
    existing.summary.purchases += 1;
    existing.summary.spend += entry.amount;
    const unitPrice = unitPriceOf(entry.receipt);
    if (unitPrice !== null && entry.day >= existing.latestPricedDay) {
      existing.latestPricedDay = entry.day;
      existing.summary.latestUnitPrice = unitPrice;
      existing.summary.unit = String(entry.receipt.unit).trim();
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
    const start = today - (TREND_WEEKS - index) * 7 + 1;
    const end = start + 6;
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
    priceRises: buildPriceRises(dated, today),
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
