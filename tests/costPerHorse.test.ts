import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COST_WINDOW_DAYS,
  DAYS_PER_MONTH,
  PRICE_RISE_THRESHOLD,
  TREND_WEEKS,
  buildCostPerHorse,
  buildSubscriptionPayback,
  costGroupFor,
  productKeyOf,
  receiptDay,
  unitPriceOf,
} from '../src/lib/costPerHorse.js';
import {
  parseReceiptQuantity,
  validateExpenseReceiptInput,
  type ExpenseReceiptInput,
} from '../src/store/xbarStoreLogic.js';
import type { ExpenseReceipt, HorseRecord, SalesLead } from '../src/types/xbar.js';

// buildCostPerHorse is the Costs screen: cost per horse per day, monthly burn,
// the 90-day trend and supplier price rises. Every figure must trace to a
// logged receipt — these tests pin that, and pin the cases where the honest
// answer is "not enough data" rather than a number.

// Midday local time, so "today" is 2026-06-30 in any zone the suite runs in.
const NOW = new Date(2026, 5, 30, 12);

const horse = (id: string, name = id) => ({ id, name }) as Pick<HorseRecord, 'id' | 'name'>;

let seq = 0;
function receipt(fields: Partial<ExpenseReceipt> & { amount: number; receiptDate: string }): ExpenseReceipt {
  seq += 1;
  return {
    id: `r-${seq}`,
    title: 'Receipt',
    category: 'Feed',
    vendor: 'Valley Feed',
    uploadedAt: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}Z`,
    uploadedBy: 'Test',
    ...fields,
  } as ExpenseReceipt;
}

function assertClose(actual: number | null | undefined, expected: number, message?: string) {
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < 1e-9, message ?? `${actual} ≈ ${expected}`);
}

/** 'YYYY-MM-DD' for `days` before 2026-06-30. */
function daysAgo(days: number) {
  return new Date(Date.UTC(2026, 5, 30) - days * 86_400_000).toISOString().slice(0, 10);
}

test('cost per horse per day divides the window spend by days tracked and horses in care', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a'), horse('b')],
    receipts: [
      receipt({ amount: 900, receiptDate: daysAgo(200) }), // history older than the window
      receipt({ amount: 1800, receiptDate: daysAgo(10) }),
    ],
    now: NOW,
  });

  assert.equal(summary.trackedDays, COST_WINDOW_DAYS, 'history older than 90 days caps the window at 90');
  assert.equal(summary.windowTotal, 1800, 'the 200-day-old receipt is outside the window');
  assert.equal(summary.perHorsePerDay, 1800 / 90 / 2);
  assert.equal(summary.monthlyBurn, (1800 / 90) * DAYS_PER_MONTH);
});

test('a short history divides by the days actually recorded, not by 90', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [receipt({ amount: 300, receiptDate: daysAgo(9) })],
    now: NOW,
  });

  assert.equal(summary.trackedDays, 10, 'first receipt 9 days ago through today is 10 days');
  assert.equal(summary.perHorsePerDay, 30);
});

test('tagged receipts stay with their horse and ranch-wide receipts split evenly', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a', 'Alpha'), horse('b', 'Bravo')],
    receipts: [
      receipt({ amount: 100, receiptDate: daysAgo(9), horseId: 'a', category: 'Vet Care' }),
      receipt({ amount: 200, receiptDate: daysAgo(9) }),
    ],
    now: NOW,
  });

  const alpha = summary.horses.find((row) => row.horseId === 'a');
  const bravo = summary.horses.find((row) => row.horseId === 'b');
  assert.equal(alpha?.direct, 100);
  assert.equal(alpha?.sharedShare, 100);
  assert.equal(alpha?.perDay, 20);
  assert.equal(bravo?.direct, 0);
  assert.equal(bravo?.perDay, 10);
  assert.equal(summary.horses[0]?.horseId, 'a', 'most expensive horse first');
  // The ranch figure is the average of the horses, so the two views cannot disagree.
  assert.equal(summary.perHorsePerDay, (20 + 10) / 2);
});

test('a sold horse leaves the headcount; its receipts stay in the burn but are not spread over the herd', () => {
  const sold = { id: 'lead-1', horseId: 'gone', outcome: 'Won' } as SalesLead;
  const summary = buildCostPerHorse({
    horses: [horse('a'), horse('gone')],
    receipts: [
      receipt({ amount: 500, receiptDate: daysAgo(9), horseId: 'gone' }),
      receipt({ amount: 100, receiptDate: daysAgo(9) }),
    ],
    salesLeads: [sold],
    now: NOW,
  });

  assert.equal(summary.horsesInCare, 1);
  assert.equal(summary.windowTotal, 600, 'the burn counts every dollar spent');
  assert.equal(summary.perHorsePerDay, 100 / 10, 'the sold horse’s $500 is not charged to the horse still here');
  assert.deepEqual(
    summary.horses.map((row) => row.horseId),
    ['a'],
  );
});

test('future-dated and impossible dates are left out of every figure', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      receipt({ amount: 100, receiptDate: daysAgo(4) }),
      receipt({ amount: 9999, receiptDate: '2026-07-15' }),
      receipt({ amount: 9999, receiptDate: '2026-02-30' }),
      receipt({ amount: 9999, receiptDate: 'not a date' }),
    ],
    now: NOW,
  });

  assert.equal(summary.windowTotal, 100);
  assert.equal(receiptDay('2026-02-30'), null);
  assert.equal(receiptDay(''), null);
});

test('with no horses there is no per-horse figure, but the burn is still real', () => {
  const summary = buildCostPerHorse({
    horses: [],
    receipts: [receipt({ amount: 300, receiptDate: daysAgo(9) })],
    now: NOW,
  });

  assert.equal(summary.perHorsePerDay, null);
  assert.ok(summary.groups.every((group) => group.perHorsePerDay === null));
  assert.equal(summary.monthlyBurn, 30 * DAYS_PER_MONTH);
  assert.deepEqual(summary.horses, []);
  assert.ok(summary.trend.every((point) => point.perHorsePerDay === null));
});

test('with no receipts nothing is invented', () => {
  const summary = buildCostPerHorse({ horses: [horse('a')], receipts: [], now: NOW });

  assert.equal(summary.trackedDays, 0);
  assert.equal(summary.perHorsePerDay, null);
  assert.equal(summary.monthlyBurn, 0);
  assert.equal(summary.trendChangePercent, null);
  assert.deepEqual(summary.horses, []);
});

test('categories roll up into feed, care, vet and general, and the shares add to one', () => {
  assert.equal(costGroupFor('Feed'), 'Feed');
  assert.equal(costGroupFor('Supplements'), 'Feed');
  assert.equal(costGroupFor('Bedding'), 'Feed');
  assert.equal(costGroupFor('Farrier'), 'Care');
  assert.equal(costGroupFor('Wormer'), 'Care');
  assert.equal(costGroupFor('Dental Float'), 'Care');
  assert.equal(costGroupFor('Vet Care'), 'Vet');
  assert.equal(costGroupFor('Travel'), 'General');
  assert.equal(costGroupFor('Something new'), 'General', 'an unknown category is still counted');

  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      receipt({ amount: 60, receiptDate: daysAgo(9), category: 'Feed' }),
      receipt({ amount: 20, receiptDate: daysAgo(9), category: 'Farrier' }),
      receipt({ amount: 20, receiptDate: daysAgo(9), category: 'Vet Care' }),
    ],
    now: NOW,
  });
  const feed = summary.groups.find((group) => group.group === 'Feed');
  assert.equal(feed?.total, 60);
  assert.equal(feed?.share, 0.6);
  assert.equal(feed?.perHorsePerDay, 6);
  assertClose(
    summary.groups.reduce((sum, group) => sum + group.share, 0),
    1,
  );
});

test('the trend has a point per week and leaves weeks before the first receipt empty', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [receipt({ amount: 70, receiptDate: daysAgo(3) })],
    now: NOW,
  });

  assert.equal(summary.trend.length, TREND_WEEKS);
  assert.equal(summary.trend[TREND_WEEKS - 1]?.total, 70);
  assert.equal(summary.trend[TREND_WEEKS - 1]?.weekStart, daysAgo(6));
  // Records began 3 days ago, so the last week covers 4 days, not 7.
  assert.equal(summary.trend[TREND_WEEKS - 1]?.perHorsePerDay, 70 / 4);
  assert.ok(
    summary.trend.slice(0, TREND_WEEKS - 1).every((point) => point.perHorsePerDay === null),
    'weeks with no history are missing, not $0',
  );
});

test('the 30-day change needs 60 days of history and compares daily rates', () => {
  const short = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [receipt({ amount: 100, receiptDate: daysAgo(40) })],
    now: NOW,
  });
  assert.equal(short.trendChangePercent, null);

  const long = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      receipt({ amount: 600, receiptDate: daysAgo(89) }), // 60 earlier days → $10/day
      receipt({ amount: 450, receiptDate: daysAgo(5) }), // last 30 days → $15/day
    ],
    now: NOW,
  });
  assert.equal(long.trendChangePercent, 50);
});

test('a supplier price rise is flagged against that supplier’s own last deliveries', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      receipt({ amount: 800, quantity: 100, unit: 'bale', receiptDate: daysAgo(120) }), // $8.00, outside baseline
      receipt({ amount: 360, quantity: 40, unit: 'bale', receiptDate: daysAgo(80) }), // $9.00
      receipt({ amount: 360, quantity: 40, unit: 'bale', receiptDate: daysAgo(50) }), // $9.00
      receipt({ amount: 360, quantity: 40, unit: 'bale', receiptDate: daysAgo(20), vendor: ' valley  FEED ' }), // $9.00
      receipt({ amount: 400, quantity: 40, unit: 'Bale', receiptDate: daysAgo(2) }), // $10.00
    ],
    now: NOW,
  });

  assert.equal(summary.priceRises.length, 1);
  const rise = summary.priceRises[0]!;
  assert.equal(rise.baselineUnitPrice, 9, 'baseline is the last three deliveries, not all history');
  assert.equal(rise.latestUnitPrice, 10);
  assert.equal(rise.risePercent, 11);
  assert.equal(rise.extraCost, 40, '$1 over baseline on 40 bales');
  assert.equal(rise.comparedPurchases, 3);
});

test('price rises are not invented from unlike purchases, stale deliveries or small moves', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      // Different units from one supplier are different products.
      receipt({ amount: 300, quantity: 1, unit: 'ton', receiptDate: daysAgo(30) }),
      receipt({ amount: 100, quantity: 10, unit: 'bag', receiptDate: daysAgo(5) }),
      // Below the threshold.
      receipt({ amount: 100, quantity: 10, unit: 'sack', receiptDate: daysAgo(30), vendor: 'Coop' }),
      receipt({ amount: 104, quantity: 10, unit: 'sack', receiptDate: daysAgo(5), vendor: 'Coop' }),
      // A rise that happened last year.
      receipt({ amount: 100, quantity: 10, unit: 'bale', receiptDate: daysAgo(300), vendor: 'Old Mill' }),
      receipt({ amount: 200, quantity: 10, unit: 'bale', receiptDate: daysAgo(200), vendor: 'Old Mill' }),
      // No quantity: no unit price at all.
      receipt({ amount: 100, receiptDate: daysAgo(30), vendor: 'Loose Hay' }),
      receipt({ amount: 900, receiptDate: daysAgo(5), vendor: 'Loose Hay' }),
      // Not a feed purchase.
      receipt({
        amount: 100,
        quantity: 1,
        unit: 'visit',
        receiptDate: daysAgo(30),
        category: 'Farrier',
        vendor: 'Shoer',
      }),
      receipt({
        amount: 200,
        quantity: 1,
        unit: 'visit',
        receiptDate: daysAgo(5),
        category: 'Farrier',
        vendor: 'Shoer',
      }),
    ],
    now: NOW,
  });

  assert.equal(PRICE_RISE_THRESHOLD, 0.05);
  assert.deepEqual(summary.priceRises, []);
  assert.equal(summary.unpricedFeedPurchases, 2, 'the two Loose Hay receipts cannot be compared');
});

test('feed suppliers are summarised with their latest price per unit', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      receipt({ amount: 360, quantity: 40, unit: 'bale', receiptDate: daysAgo(20) }),
      receipt({ amount: 400, quantity: 40, unit: 'bale', receiptDate: daysAgo(2) }),
      receipt({ amount: 50, receiptDate: daysAgo(3), vendor: 'Coop', category: 'Supplements' }),
    ],
    now: NOW,
  });

  assert.deepEqual(
    summary.feedSuppliers.map((supplier) => [supplier.vendor, supplier.purchases, supplier.spend]),
    [
      ['Valley Feed', 2, 760],
      ['Coop', 1, 50],
    ],
  );
  assert.equal(summary.feedSuppliers[0]?.latestUnitPrice, 10);
  assert.equal(summary.feedSuppliers[0]?.unit, 'bale');
  assert.equal(summary.feedSuppliers[1]?.latestUnitPrice, null);
  assert.equal(unitPriceOf({ amount: 100, quantity: 0, unit: 'bale' }), null);
  assert.equal(unitPriceOf({ amount: 100, quantity: 4, unit: ' ' }), null);
});

test('subscription payback compares the plan to what each horse already costs', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a'), horse('b')],
    receipts: [
      receipt({ amount: 360, quantity: 40, unit: 'bale', receiptDate: daysAgo(89) }),
      receipt({ amount: 400, quantity: 40, unit: 'bale', receiptDate: daysAgo(2) }),
    ],
    now: NOW,
  });
  const payback = buildSubscriptionPayback(summary, 79);

  assert.equal(payback.planPerHorsePerDay, 79 / DAYS_PER_MONTH / 2);
  assertClose(payback.shareOfDailyCost, 79 / DAYS_PER_MONTH / 2 / (760 / 90 / 2));
  assert.equal(payback.priceRiseOverpay, 40);
  assert.equal(payback.planMonthsCovered, 40 / 79);

  const noPlan = buildSubscriptionPayback(summary, 0);
  assert.equal(noPlan.planPerHorsePerDay, null);
  assert.equal(noPlan.planMonthsCovered, null);

  const noHorses = buildSubscriptionPayback(buildCostPerHorse({ horses: [], receipts: [], now: NOW }), 79);
  assert.equal(noHorses.planPerHorsePerDay, null);
  assert.equal(noHorses.shareOfDailyCost, null);
  assert.equal(noHorses.priceRiseOverpay, 0);
});

test('a receipt quantity is saved only with its unit', () => {
  const base: ExpenseReceiptInput = {
    title: 'Hay',
    category: 'Feed',
    vendor: 'Valley Feed',
    amount: 400,
    receiptDate: '2026-06-28',
    uploadedBy: 'Ranch manager',
  };

  assert.equal(validateExpenseReceiptInput(base), null, 'neither is fine');
  assert.equal(validateExpenseReceiptInput({ ...base, quantity: 40, unit: 'bale' }), null);
  assert.match(validateExpenseReceiptInput({ ...base, quantity: 40 }) ?? '', /unit/i);
  assert.match(validateExpenseReceiptInput({ ...base, unit: 'bale' }) ?? '', /Quantity/);
  assert.match(validateExpenseReceiptInput({ ...base, quantity: 0, unit: 'bale' }) ?? '', /Quantity/);
  assert.match(validateExpenseReceiptInput({ ...base, quantity: Number.NaN, unit: 'bale' }) ?? '', /Quantity/);
});

test('an old receipt for a sold horse does not stretch the per-horse window', () => {
  const sold = { id: 'lead-1', horseId: 'gone', outcome: 'Won' } as SalesLead;
  const summary = buildCostPerHorse({
    horses: [horse('a'), horse('gone')],
    receipts: [
      receipt({ amount: 900, receiptDate: daysAgo(89), horseId: 'gone' }),
      receipt({ amount: 100, receiptDate: daysAgo(0) }),
    ],
    salesLeads: [sold],
    now: NOW,
  });

  assert.equal(summary.trackedDays, 90, 'the burn still spans every receipt');
  assert.equal(summary.monthlyBurn, (1000 / 90) * DAYS_PER_MONTH);
  assert.equal(summary.perHorseDays, 1, 'the herd’s own history started today');
  assert.equal(summary.perHorsePerDay, 100, 'today’s $100 over one day, not over 90');
  assert.ok(
    summary.trend.slice(0, TREND_WEEKS - 1).every((point) => point.perHorsePerDay === null),
    'no zero-history weeks before the herd’s first receipt',
  );
});

test('two products from one supplier are two prices, not a rise', () => {
  const summary = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      receipt({ title: 'Grass hay', amount: 360, quantity: 40, unit: 'bale', receiptDate: daysAgo(30) }),
      receipt({ title: 'Alfalfa', amount: 560, quantity: 40, unit: 'bale', receiptDate: daysAgo(2) }),
    ],
    now: NOW,
  });
  assert.deepEqual(summary.priceRises, [], 'buying the dearer hay is not a price rise');

  const same = buildCostPerHorse({
    horses: [horse('a')],
    receipts: [
      receipt({ title: 'Grass hay', amount: 360, quantity: 40, unit: 'bale', receiptDate: daysAgo(30) }),
      receipt({ title: 'Grass hay - 40 bales', amount: 400, quantity: 40, unit: 'bale', receiptDate: daysAgo(2) }),
    ],
    now: NOW,
  });
  assert.equal(same.priceRises.length, 1, 'counts and unit words do not make a new product');
  assert.equal(same.priceRises[0]?.product, 'Grass hay - 40 bales');
  assert.equal(productKeyOf({ title: 'Senior feed, 4 x 50 lb bags', unit: '50 lb bag' }), 'senior feed x');
});

test('a typed quantity is read as written or refused, never rewritten', () => {
  assert.equal(parseReceiptQuantity(''), undefined);
  assert.equal(parseReceiptQuantity('  '), undefined);
  assert.equal(parseReceiptQuantity('40'), 40);
  assert.equal(parseReceiptQuantity('2.5'), 2.5);
  assert.equal(parseReceiptQuantity('.5'), 0.5);
  assert.equal(parseReceiptQuantity('1,200'), 1200);
  for (const malformed of ['-5', '1/2', '12 bales', '1,2', 'forty', '4e2']) {
    assert.ok(Number.isNaN(parseReceiptQuantity(malformed)), `${malformed} is refused`);
  }
  // And the store refuses what the parser refused.
  const base = {
    title: 'Hay',
    category: 'Feed' as const,
    vendor: 'Valley Feed',
    amount: 400,
    receiptDate: '2026-06-28',
    uploadedBy: 'Ranch manager',
    unit: 'bale',
  };
  assert.match(validateExpenseReceiptInput({ ...base, quantity: parseReceiptQuantity('-5') }) ?? '', /Quantity/);
});
