import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRanchReport, type RanchReportInput } from '../src/lib/ranchReport.js';
import { ranchReportFileName, ranchReportSections, ranchReportToCsv } from '../src/lib/ranchReportExport.js';
import type { ExpenseReceipt, HorseRecord, SalesLead } from '../src/types/xbar.js';

/*
 * The report is what a rancher hands to a banker, so the numbers in it have to
 * be defensible and the file has to survive the round trip into a spreadsheet.
 *
 * The arithmetic itself lives in businessIntelligence.ts and is tested there.
 * What is tested here is the composition: that the herd-level totals add up
 * from the same records, that an empty workspace produces a report instead of
 * NaN, and that the CSV escapes what real horse names contain.
 */

const NOW = new Date('2026-08-21T12:00:00Z');

function horse(overrides: Partial<HorseRecord> & { id: string; name: string }): HorseRecord {
  return {
    status: 'Active',
    readiness: { score: 80 },
    ...overrides,
  } as unknown as HorseRecord;
}

function receipt(overrides: Partial<ExpenseReceipt> & { id: string; amount: number }): ExpenseReceipt {
  return {
    title: 'Receipt',
    category: 'Feed',
    vendor: 'Co-op',
    receiptDate: '2026-08-10',
    uploadedAt: '2026-08-10',
    uploadedBy: 'owner',
    ...overrides,
  } as ExpenseReceipt;
}

function lead(overrides: Partial<SalesLead> & { id: string }): SalesLead {
  return {
    name: 'Buyer',
    channel: 'Referral',
    horseId: 'h1',
    stage: 'Offer',
    lastTouch: '2026-08-01',
    savedListing: false,
    shareReady: false,
    ...overrides,
  } as SalesLead;
}

function input(overrides: Partial<RanchReportInput> = {}): RanchReportInput {
  return { horses: [], documents: [], expenseReceipts: [], salesLeads: [], ownershipRecords: [], ...overrides };
}

test('an empty workspace produces a report, not NaN', () => {
  const report = buildRanchReport(input(), NOW);

  assert.equal(report.horseCount, 0);
  assert.equal(report.money.investedToDate, 0);
  assert.equal(report.money.monthlyBurn, 0);
  assert.equal(report.readiness.average, 0);
  assert.deepEqual(report.categories, []);

  // Every money field is a real number. A report that renders "NaN" or
  // "Infinity" to a banker is worse than one that renders nothing, and the
  // share calculation divides by the total spend — which is zero here.
  for (const [field, value] of Object.entries(report.money)) {
    assert.ok(Number.isFinite(value), `money.${field} is ${value}`);
  }
});

test('spend totals add up from the receipts, split by what is tied to a horse', () => {
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best' })],
      expenseReceipts: [
        receipt({ id: 'r1', amount: 400, horseId: 'h1' }),
        receipt({ id: 'r2', amount: 250, horseId: 'h1', category: 'Vet Care' }),
        // No horseId: general ranch spend. Counted in the total, excluded from
        // the horse-tied figure.
        receipt({ id: 'r3', amount: 100 }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.investedToDate, 750);
  assert.equal(report.money.investedInHorses, 650);
  assert.equal(report.money.investedThisMonth, 750);

  // Categories are sorted by spend, largest first, and shares are whole
  // percents of the total.
  assert.deepEqual(
    report.categories.map((row) => [row.category, row.total, row.share]),
    [
      ['Feed', 500, 67],
      ['Vet Care', 250, 33],
    ],
  );
});

test('receipts outside the trailing window do not inflate monthly burn', () => {
  const report = buildRanchReport(
    input({
      expenseReceipts: [
        receipt({ id: 'r1', amount: 900, receiptDate: '2026-08-02' }),
        // Two years old. Part of invested-to-date, but not of what the
        // operation costs to run right now.
        receipt({ id: 'r2', amount: 50_000, receiptDate: '2024-03-01' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.investedToDate, 50_900);
  assert.equal(report.money.monthlyBurn, 300, '900 over three months');
});

test('only open offers count as pipeline, and only paid deposits as held', () => {
  const report = buildRanchReport(
    input({
      salesLeads: [
        lead({ id: 'l1', stage: 'Offer', offerAmount: 12_000, depositAmount: 2_000, depositStatus: 'Paid' }),
        lead({ id: 'l2', stage: 'Qualified', offerAmount: 8_000, depositStatus: 'Due', depositAmount: 1_000 }),
        // Closed and lost deals are not money still in play. Counting either
        // would overstate the pipeline to whoever reads this.
        lead({ id: 'l3', stage: 'Closed', offerAmount: 25_000 }),
        lead({ id: 'l4', stage: 'Offer', offerAmount: 30_000, outcome: 'Lost' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 20_000);
  assert.equal(report.money.depositsHeld, 2_000);
});

test('horses are ordered by what they have cost', () => {
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'cheap', name: 'Cheap' }), horse({ id: 'dear', name: 'Dear' })],
      expenseReceipts: [
        receipt({ id: 'r1', amount: 100, horseId: 'cheap' }),
        receipt({ id: 'r2', amount: 5_000, horseId: 'dear' }),
      ],
    }),
    NOW,
  );

  assert.deepEqual(
    report.horses.map((row) => row.horseName),
    ['Dear', 'Cheap'],
  );
  assert.equal(report.horses[0].investedToDate, 5_000);
});

test('readiness buckets split at the thresholds the screen colours on', () => {
  const report = buildRanchReport(
    input({
      horses: [
        horse({ id: 'a', name: 'A', readiness: { score: 95 } as HorseRecord['readiness'] }),
        horse({ id: 'b', name: 'B', readiness: { score: 94 } as HorseRecord['readiness'] }),
        horse({ id: 'c', name: 'C', readiness: { score: 75 } as HorseRecord['readiness'] }),
        horse({ id: 'd', name: 'D', readiness: { score: 74 } as HorseRecord['readiness'] }),
      ],
    }),
    NOW,
  );

  // Boundaries, not midpoints: 95 is ready and 94 is not, 75 is getting there
  // and 74 is not.
  assert.deepEqual(report.readiness, { average: 85, ready: 1, gettingThere: 2, notReady: 1 });
});

test('the spreadsheet escapes what real names contain', () => {
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best, Jr. "Doc"' })],
      expenseReceipts: [receipt({ id: 'r1', amount: 100, horseId: 'h1' })],
    }),
    NOW,
  );

  const csv = ranchReportToCsv(report);

  // A comma in a name must not become a new column, and a quote must be
  // doubled rather than ending the field. Either one shifts every following
  // column and makes the sheet silently wrong.
  assert.match(csv, /"Docs Best, Jr\. ""Doc"""/);

  // Header and a row for the horse, with the invested figure present.
  assert.match(csv, /"Horse","Status","Invested to date"/);
  assert.match(csv, /"100"/);
});

test('the file name sorts chronologically', () => {
  const report = buildRanchReport(input(), NOW);
  assert.equal(ranchReportFileName(report, 'csv'), 'xbar-ranch-report-2026-08-21.csv');
  assert.equal(ranchReportFileName(report, 'pdf'), 'xbar-ranch-report-2026-08-21.pdf');
});

/*
 * The PDF renders `Label: value` lines as aligned rows, and treats a label with
 * an empty value as a blank to fill in. A zero that arrived as an empty string
 * would therefore print as a ruled line — reading as "unknown" on a document
 * where it means "none".
 */
test('every PDF line carries a value, including zeros', () => {
  const report = buildRanchReport(input({ horses: [horse({ id: 'h1', name: 'Docs Best' })] }), NOW);
  const sections = ranchReportSections(report);

  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.ok(section.heading, 'every section is titled');
    for (const line of section.lines) {
      const [label, ...rest] = line.split(':');
      assert.ok(label.trim(), `"${line}" has no label`);
      assert.ok(rest.join(':').trim(), `"${line}" has an empty value and would render as a blank line`);
    }
  }

  // Specifically: an operation with no receipts still prints $0, not nothing.
  const money = sections.find((section) => section.heading === 'Where the money is');
  assert.ok(money);
  assert.ok(
    money.lines.some((line) => line.includes('$0')),
    'a zero total must be written as $0',
  );
});

test('sections that have no rows are left out rather than printed empty', () => {
  const quiet = ranchReportSections(buildRanchReport(input({ horses: [horse({ id: 'h1', name: 'A' })] }), NOW));
  const headings = quiet.map((section) => section.heading);

  // No receipts and nothing blocked, so neither section belongs on the page.
  assert.ok(!headings.includes('Spend by category'));
  assert.ok(!headings.includes('What is holding up a sale'));
  assert.ok(!headings.includes('Running above trend'));

  // The two that are always meaningful stay.
  assert.ok(headings.includes('Where the money is'));
  assert.ok(headings.includes('Sale readiness'));
});

/*
 * No report line may rely on indentation to group anything.
 *
 * `fieldsInLine` splits a line on runs of two or more spaces and treats each
 * piece as its own label/value column, so leading indent is consumed as a
 * column break and never drawn. The horse section was written as four indented
 * rows per horse and rendered as one flat list — a reader could not tell where
 * one horse's figures ended and the next began, on the page whose entire job is
 * to say what each animal costs.
 *
 * Asserted across every section rather than on the one that was wrong: any
 * future section written with indentation fails the same way, silently.
 */
test('no PDF line uses indentation or multi-space runs to group values', () => {
  const report = buildRanchReport(
    input({
      horses: [
        horse({ id: 'h1', name: 'Docs Best Chex', sale: { askPrice: 42_000 } } as never),
        horse({ id: 'h2', name: 'Smart Little Kitty' }),
      ],
      expenseReceipts: [receipt({ id: 'r1', amount: 4_000, horseId: 'h1' })],
      salesLeads: [lead({ id: 'l1', offerAmount: 39_000, depositAmount: 5_000, depositStatus: 'Paid' })],
    }),
    NOW,
  );

  for (const section of ranchReportSections(report)) {
    for (const line of section.lines) {
      assert.equal(line, line.trimStart(), `"${line}" is indented, which the renderer discards`);
      assert.ok(!/\s{2,}/.test(line), `"${line}" contains a multi-space run, which splits it into columns`);
    }
  }
});

test('each horse is one row, so two horses cannot be read as one', () => {
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'First Horse' }), horse({ id: 'h2', name: 'Second Horse' })],
      expenseReceipts: [receipt({ id: 'r1', amount: 100, horseId: 'h1' })],
    }),
    NOW,
  );

  const section = ranchReportSections(report).find((entry) => entry.heading === 'Cost and margin by horse');
  assert.ok(section);
  assert.equal(section.lines.length, 2, 'one line per horse, not one per figure');

  // Every line starts with a horse name, so the label column reads as a list of
  // horses rather than a list of unattributed figures.
  const names = report.horses.map((row) => row.horseName);
  for (const line of section.lines) {
    const label = line.slice(0, line.indexOf(':'));
    assert.ok(names.includes(label), `"${label}" is not a horse name`);
  }

  // A horse with no asking price says so rather than showing a $0 margin.
  const unlisted = section.lines.find((line) => line.startsWith('Second Horse'));
  assert.match(unlisted ?? '', /not listed for sale/);
});
