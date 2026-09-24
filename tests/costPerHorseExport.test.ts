import assert from 'node:assert/strict';
import test from 'node:test';
import { costPerHorseFileName, costPerHorseToCsv } from '../src/lib/costPerHorseExport.js';
import type { CostPerHorseSummary } from '../src/lib/costPerHorse.js';

// The Costs screen's export: the per-horse-per-day figures a rancher hands to
// a partner or an accountant. The CSV must carry the same numbers as the
// screen, and must survive Excel — quoted fields, doubled quotes, and the
// formula-injection guard, mirroring ranchReportExport.ts.

function summaryWith(overrides: Partial<CostPerHorseSummary> = {}): CostPerHorseSummary {
  return {
    horsesInCare: 2,
    trackedDays: 90,
    perHorseDays: 90,
    windowTotal: 1800,
    monthlyBurn: 610,
    perHorsePerDay: 10,
    groups: [
      { group: 'Feed', total: 1200, perHorsePerDay: 6.67, share: 0.667 },
      { group: 'Care', total: 600, perHorsePerDay: 3.33, share: 0.333 },
    ],
    horses: [
      { horseId: 'h1', horseName: 'Docs Best, Jr.', direct: 1000, sharedShare: 400, perDay: 15.56 },
      { horseId: 'h2', horseName: 'Bella', direct: 300, sharedShare: 400, perDay: 7.78 },
    ],
    trend: [],
    trendChangePercent: null,
    priceRises: [],
    priceComparisons: 0,
    feedSuppliers: [],
    unpricedFeedPurchases: 0,
    ...overrides,
  };
}

test('cost CSV carries the headline figures and one row per horse', () => {
  const csv = costPerHorseToCsv(summaryWith());
  const lines = csv.split('\n');

  assert.ok(lines.includes('"XBAR Cost Per Horse"'));
  assert.ok(lines.includes('"Cost per horse per day","10"'), 'headline per-horse-per-day figure');
  assert.ok(lines.includes('"Monthly burn","610"'));
  assert.ok(
    lines.includes('"Horse","Tagged to horse ($)","Ranch-wide share ($)","Per day ($)"'),
    'horse section headers',
  );
  assert.ok(lines.includes('"Docs Best, Jr.","1000","400","15.56"'), 'a comma in a horse name must not split the row');
  assert.ok(lines.includes('"Bella","300","400","7.78"'));
  assert.ok(lines.includes('"Category","Total ($)","Per horse per day ($)","Share (%)"'), 'category section headers');
  assert.ok(lines.includes('"Feed","1200","6.67","66.7"'));
});

test('cost CSV doubles quotes in names', () => {
  const csv = costPerHorseToCsv(
    summaryWith({ horses: [{ horseId: 'h1', horseName: 'Say "Howdy"', direct: 0, sharedShare: 0, perDay: 0 }] }),
  );
  assert.ok(csv.includes('"Say ""Howdy""","0","0","0"'));
});

test('cost CSV prints the per-horse day basis beside the daily figures', () => {
  // When an older receipt belongs to a sold horse, trackedDays and
  // perHorseDays intentionally differ: monthly burn uses the former while
  // every per-horse daily figure uses the latter. Printing only trackedDays
  // beside those figures lets an accountant infer the wrong denominator.
  const csv = costPerHorseToCsv(summaryWith({ trackedDays: 120, perHorseDays: 90 }));
  assert.ok(csv.includes('"Days of receipts","120"'), 'monthly-burn denominator');
  assert.ok(csv.includes('"Days used for per-horse figures","90"'), 'per-horse denominator');
});

test('cost CSV guards formula-looking horse names', () => {
  const csv = costPerHorseToCsv(
    summaryWith({
      horses: [
        { horseId: 'h1', horseName: '=HYPERLINK("https://evil.example")', direct: 0, sharedShare: 0, perDay: 0 },
      ],
    }),
  );
  // Spreadsheets treat a quoted leading `=` as a formula, so the name must be
  // prefixed with an apostrophe — the "treat the rest as text" marker.
  assert.ok(csv.includes(`"'=HYPERLINK(""https://evil.example"")","0","0","0"`));
  assert.ok(!csv.includes('"=HYPERLINK'));
});

test('cost CSV shows em-dash when there is no per-horse figure', () => {
  const csv = costPerHorseToCsv(summaryWith({ perHorsePerDay: null }));
  assert.ok(csv.includes('"Cost per horse per day","—"'));
});

test('cost CSV includes supplier price rises when present', () => {
  const csv = costPerHorseToCsv(
    summaryWith({
      priceRises: [
        {
          vendor: 'Triple Crown Feed',
          product: 'Alfalfa hay',
          category: 'Feed',
          unit: 'bale',
          latestUnitPrice: 24,
          baselineUnitPrice: 20,
          risePercent: 20,
          extraCost: 120,
          latestDate: '2026-09-01',
          latestQuantity: 30,
          comparedPurchases: 4,
          risingSince: '2026-08-15',
          deliveriesSinceRise: 2,
        },
      ],
    }),
  );
  assert.ok(csv.includes('"Supplier","Product","Rise (%)","Was ($/unit)","Now ($/unit)","Extra cost since rise ($)"'));
  assert.ok(csv.includes('"Triple Crown Feed","Alfalfa hay","20","20","24","120"'));
});

test('cost CSV filename is dated and sortable', () => {
  assert.equal(costPerHorseFileName('2026-09-24'), 'xbar-cost-per-horse-2026-09-24.csv');
  assert.match(costPerHorseFileName(), /^xbar-cost-per-horse-\d{4}-\d{2}-\d{2}\.csv$/);
});
