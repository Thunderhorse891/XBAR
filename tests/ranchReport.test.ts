import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildRanchReport, type RanchReportInput } from '../src/lib/ranchReport.js';
import { ranchReportFileName, ranchReportSections, ranchReportToCsv } from '../src/lib/ranchReportExport.js';
import { monthKeyOf, trailingMonthKeys } from '../src/lib/receiptMonths.js';
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

/** A sale profile with the fields these tests do not care about filled in. */
function sale(overrides: Partial<HorseRecord['sale']>): HorseRecord['sale'] {
  return {
    askPrice: 0,
    listingState: 'Draft',
    buyerConfidence: 0,
    inquiryCount: 0,
    watchlistCount: 0,
    socialReady: false,
    ...overrides,
  } as HorseRecord['sale'];
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
        receipt({ id: 'r1', amount: 900, receiptDate: '2026-07-02' }),
        // Two years old. Part of invested-to-date, but not of what the
        // operation costs to run right now.
        receipt({ id: 'r2', amount: 50_000, receiptDate: '2024-03-01' }),
        // This month, which is still in progress. Counted as spend, but not
        // averaged against whole months — see the burn tests below.
        receipt({ id: 'r3', amount: 4_000, receiptDate: '2026-08-19' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.investedToDate, 54_900);
  assert.equal(report.money.investedThisMonth, 4_000);
  assert.equal(report.money.monthlyBurn, 300, '900 over three complete months');
});

/*
 * A draft or rejected offer is not money on the table.
 *
 * The Sales editor moves stage and offer status independently, so a lead can
 * sit in 'Offer' with a status of 'Draft' — never sent — or 'Rejected' — dead.
 * Counting either quotes a pipeline figure to a banker that no buyer ever
 * agreed to.
 *
 * The rule is buildRanchFinancials's, imported rather than restated: a report
 * that disagrees with the Money screen about the same number is worse than
 * either being wrong alone.
 */
test('draft and rejected offers are not pipeline value', () => {
  const report = buildRanchReport(
    input({
      salesLeads: [
        lead({ id: 'live', stage: 'Offer', offerAmount: 12_000, offerStatus: 'Submitted' }),
        lead({ id: 'draft', stage: 'Offer', offerAmount: 40_000, offerStatus: 'Draft' }),
        lead({ id: 'rejected', stage: 'Offer', offerAmount: 50_000, offerStatus: 'Rejected' }),
        // No status at all: a legacy lead, which still counts through its stage.
        lead({ id: 'legacy', stage: 'Qualified', offerAmount: 3_000 }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 15_000);
});

test('a countered offer contributes the counter, not the original ask', () => {
  // Once a buyer has countered, the counter is what is on the table. Reporting
  // the original would overstate the pipeline — and would disagree with the
  // Money screen, which already uses the counter.
  const report = buildRanchReport(
    input({
      salesLeads: [
        lead({ id: 'c1', stage: 'Offer', offerAmount: 39_000, counterOfferAmount: 30_000, offerStatus: 'Countered' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 30_000);
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

test('the listed count agrees with the risk population it sits beside', () => {
  const report = buildRanchReport(
    input({
      horses: [
        horse({ id: 'priced', name: 'Priced', sale: sale({ askPrice: 42_000 }) }),
        // Sale inventory with no price entered yet. `assessRevenueAtRisk`
        // counts these — getting a horse ready to sell starts long before
        // anyone decides what to ask — so a headline count testing `askPrice >
        // 0` reported a smaller herd than the blockers list underneath it.
        horse({ id: 'prep', name: 'In Prep', status: 'Sale Prep', sale: sale({}) }),
        horse({ id: 'ready', name: 'Market Ready', sale: sale({ listingState: 'Market Ready' }) }),
        horse({ id: 'review', name: 'Buyer Review', sale: sale({ listingState: 'Buyer Review' }) }),
        // Genuinely not for sale: out at pasture, no price, no listing state.
        horse({ id: 'keeper', name: 'Keeper', status: 'Pasture', sale: sale({}) }),
      ],
    }),
    NOW,
  );

  assert.equal(report.listedCount, 4);
  assert.equal(report.risk.items.length, 4, 'the two figures must describe the same horses');
});

test('a deposit on a completed sale is no longer held', () => {
  const report = buildRanchReport(
    input({
      salesLeads: [
        // Still open: the ranch is holding this money and owes it back if the
        // deal falls through.
        lead({ id: 'open', stage: 'Offer', depositAmount: 2_000, depositStatus: 'Paid' }),
        // Won: the Sales editor leaves depositStatus 'Paid' in place after the
        // sale closes, so counting that field alone kept the deposit on the
        // books forever — in the UI, the CSV and the banker-facing PDF.
        lead({ id: 'won', stage: 'Closed', outcome: 'Won', depositAmount: 5_000, depositStatus: 'Paid' }),
        // Lost is deliberately still counted: that money is usually sitting in
        // the ranch's account pending a refund decision.
        lead({ id: 'lost', stage: 'Offer', outcome: 'Lost', depositAmount: 750, depositStatus: 'Paid' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.depositsHeld, 2_750);
});

test('the report is dated by the local calendar, not by UTC', () => {
  // 6pm on the 24th in a negative-UTC zone is already the 25th in UTC. The
  // monthly figures on this report are computed in the local calendar, so a
  // UTC-derived date printed tomorrow beside today's totals — on the page and
  // in the exported filename.
  const evening = new Date(2026, 7, 24, 18, 30, 0);
  const report = buildRanchReport(input({}), evening);

  assert.equal(report.generatedOn, '2026-08-24');
  assert.equal(ranchReportFileName(report, 'pdf'), 'xbar-ranch-report-2026-08-24.pdf');
  // The instant is still available for anything that needs ordering.
  assert.equal(report.generatedAt, evening.toISOString());
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

/*
 * A receipt date is calendar data, not an instant.
 *
 * `new Date('2026-08-01')` is parsed as UTC midnight per the date-only form, so
 * in any negative-UTC zone — which is every US ranch — it lands on July 31
 * locally. Reading `.getMonth()` off it filed receipts dated the 1st under the
 * previous month, dropping them from "spent this month" and from each
 * category's monthly total.
 */
test('the month comes from the date string, not from a parsed instant', () => {
  assert.equal(monthKeyOf('2026-08-01'), '2026-08');
  assert.equal(monthKeyOf('2026-08-31'), '2026-08');
  assert.equal(monthKeyOf('2026-01-01'), '2026-01');
  // A value carrying a time is an instant, not a calendar date, so it is read
  // in the local zone — the month the person looking at it would name.
  assert.equal(monthKeyOf('2026-08-15T12:00:00Z'), '2026-08');

  // The value the old code consulted. In a US zone this is July, which is the
  // whole defect; the helper never looks at it.
  const throughDate = new Date('2026-08-01');
  assert.equal(`${throughDate.getUTCFullYear()}-08`, '2026-08', 'sanity: the string really does say August');

  // Unusable input is skipped rather than silently filed under some month.
  assert.equal(monthKeyOf(''), null);
  assert.equal(monthKeyOf('not a date'), null);
});

test('a receipt dated the first of the month counts as this month', () => {
  const report = buildRanchReport(
    input({ expenseReceipts: [receipt({ id: 'r1', amount: 500, receiptDate: '2026-08-01' })] }),
    NOW,
  );

  assert.equal(report.money.investedThisMonth, 500);
  assert.equal(report.categories[0].thisMonth, 500);
});

/*
 * Three months, divided by three.
 *
 * The window ran from three months back to today, which spans FOUR calendar
 * months — May, June, July and part of August on the 21st — and divided by
 * three. An operation spending $300 a month reported $400, in the UI, the CSV
 * and the banker-facing PDF alike.
 */
test('monthly burn averages exactly the three complete months before this one', () => {
  assert.deepEqual(trailingMonthKeys(NOW, 3), ['2026-07', '2026-06', '2026-05']);

  // The reviewer's case: $300 in each of the four months the old window
  // touched. The answer is $300, not $400.
  const report = buildRanchReport(
    input({
      expenseReceipts: [
        receipt({ id: 'r1', amount: 300, receiptDate: '2026-05-15' }),
        receipt({ id: 'r2', amount: 300, receiptDate: '2026-06-15' }),
        receipt({ id: 'r3', amount: 300, receiptDate: '2026-07-15' }),
        receipt({ id: 'r4', amount: 300, receiptDate: '2026-08-15' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.monthlyBurn, 300);
  // The August receipt is still counted where it belongs.
  assert.equal(report.money.investedToDate, 1_200);
  assert.equal(report.money.investedThisMonth, 300);
});

test('a quiet month lowers the burn rather than being dropped from the divisor', () => {
  // Guards the fix: averaging only "months that had receipts" would report
  // $600 here and overstate what the operation costs to run.
  const report = buildRanchReport(
    input({
      expenseReceipts: [
        receipt({ id: 'r1', amount: 600, receiptDate: '2026-06-10' }),
        receipt({ id: 'r2', amount: 600, receiptDate: '2026-07-10' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.monthlyBurn, 400, '1200 over three months, May included as a real quiet month');
});

test('per-horse monthly burn uses the same window as the herd figure', () => {
  // The two were computed in different files with the same defect. A report
  // whose per-horse column and herd total disagree is worse than either being
  // wrong alone, because it looks like an arithmetic error to the reader.
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Only Horse' })],
      expenseReceipts: [
        receipt({ id: 'r1', amount: 300, horseId: 'h1', receiptDate: '2026-05-15' }),
        receipt({ id: 'r2', amount: 300, horseId: 'h1', receiptDate: '2026-06-15' }),
        receipt({ id: 'r3', amount: 300, horseId: 'h1', receiptDate: '2026-07-15' }),
        receipt({ id: 'r4', amount: 300, horseId: 'h1', receiptDate: '2026-08-15' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.horses[0].monthlyBurn, 300);
  assert.equal(report.horses[0].monthlyBurn, report.money.monthlyBurn);
});

/*
 * A spreadsheet handed to a banker must not run code on their machine.
 *
 * Quoting a CSV field does not stop Excel, LibreOffice or Sheets parsing a
 * leading `=`, `+`, `-` or `@` as a formula. This report is explicitly built to
 * be exported and passed on, and it carries user-entered and imported horse
 * names, so a crafted name is a live payload on the recipient's machine.
 *
 * The carriers matter as much as the formula character. Whitespace and control
 * characters ahead of it are stepped over by the spreadsheet but defeat a check
 * that only looks at position zero, so each one below is a real bypass of the
 * first version of this guard rather than a variation on the same case.
 */
test('names that look like formulas are neutralized in the spreadsheet', () => {
  const payloads = [
    '=HYPERLINK("http://evil.test","click")',
    '+1+1',
    '-2+3',
    '@SUM(A1:A9)',
    // Carried past position zero. A hand-edited backup preserves every one of
    // these inside a horse name, and the spreadsheet skips them before parsing.
    '\t=1+1',
    '\r=1+1',
    '\n=1+1',
    '\r\n@SUM(A1:A9)',
    '\v+1+1',
    '\f-2+3',
    ' =1+1',
    '   =1+1',
    '\n \t=1+1',
  ];

  const report = buildRanchReport(
    input({
      horses: payloads.map((name, index) => horse({ id: `h${index}`, name })),
      expenseReceipts: [receipt({ id: 'r1', amount: 100 })],
    }),
    NOW,
  );
  const csv = ranchReportToCsv(report);

  for (const payload of payloads) {
    // Compared against the escaped form: quotes inside the value are doubled by
    // CSV escaping, so the raw payload never appears verbatim.
    const escaped = payload.replace(/"/g, '""');
    // Present, and prefixed so the cell is read as text rather than evaluated.
    assert.ok(csv.includes(`"'${escaped}`), `"${payload}" must be neutralized`);
    // And never opening a cell unguarded.
    assert.ok(!csv.includes(`,"${escaped}`), `"${payload}" must not start a cell unguarded`);
  }
});

/*
 * The other direction: skipping the leading run must not make the guard greedy.
 *
 * Prefixing anything that merely starts with whitespace would put an apostrophe
 * in front of ordinary names — the same corruption of a banker-facing file,
 * arrived at from the opposite side. The formula character has to be the first
 * thing that is not a carrier.
 */
test('leading whitespace alone does not make a name into escaped text', () => {
  const benign = [' Sunny Doc', '\tDocs Best Chex', '\n Sunny Doc', 'Doc = Best'];

  const report = buildRanchReport(
    input({
      horses: benign.map((name, index) => horse({ id: `h${index}`, name })),
      expenseReceipts: [receipt({ id: 'r1', amount: 100 })],
    }),
    NOW,
  );
  const csv = ranchReportToCsv(report);

  for (const name of benign) {
    assert.ok(csv.includes(`"${name}"`), `"${name}" must survive unchanged`);
    assert.ok(!csv.includes(`"'${name}`), `"${name}" must not be prefixed`);
  }
});

test('ordinary names and negative numbers survive the spreadsheet unchanged', () => {
  // Guards the fix twice over. Prefixing everything would corrupt every cell,
  // and prefixing numbers would turn a negative margin into the text '-500 and
  // break every sum in the sheet.
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best Chex', sale: { askPrice: 1_000 } } as never)],
      // Spend far above the asking price, so the projected margin is negative.
      expenseReceipts: [receipt({ id: 'r1', amount: 9_000, horseId: 'h1' })],
    }),
    NOW,
  );
  const csv = ranchReportToCsv(report);

  assert.ok(csv.includes('"Docs Best Chex"'), 'an ordinary name is untouched');
  assert.ok(!csv.includes('"\'Docs'), 'an ordinary name is not prefixed');

  assert.ok(report.horses[0].projectedMargin < 0, 'the fixture must actually produce a negative number');
  assert.ok(
    csv.includes(`"${report.horses[0].projectedMargin}"`),
    'a negative number stays a number rather than becoming text',
  );
});

/*
 * What a horse cost to buy is money the operation put in.
 *
 * The report summed receipts alone, so a horse bought for $10,000 with nothing
 * spent on it yet appeared as $0 invested — with a break-even that ignored the
 * purchase and a margin overstated by the whole of it. `buildHorseProfitProfile`
 * has always defined break-even as `costBasis + spend`; this now agrees.
 */
test('a purchase price counts as invested even with no receipts', () => {
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Bought Outright', costBasis: 10_000 } as never)],
    }),
    NOW,
  );

  assert.equal(report.money.acquisitionCost, 10_000);
  assert.equal(report.money.investedToDate, 10_000);
  assert.equal(report.money.investedInHorses, 10_000);
  assert.equal(report.horses[0].investedToDate, 10_000, 'the per-horse row must agree with the herd total');

  // Break-even carries it too, which is what the "do not go below" floor is
  // built from — the figure a seller negotiates against.
  assert.ok(report.horses[0].breakEvenPrice >= 10_000);
  assert.ok(report.horses[0].safeDiscountFloor > report.horses[0].breakEvenPrice);
});

test('invested to date is purchases plus spend, and says which is which', () => {
  const report = buildRanchReport(
    input({
      horses: [
        horse({ id: 'h1', name: 'A', costBasis: 8_000 } as never),
        horse({ id: 'h2', name: 'B', costBasis: 2_000 } as never),
      ],
      expenseReceipts: [
        receipt({ id: 'r1', amount: 500, horseId: 'h1' }),
        // Ranch overhead, tied to no horse.
        receipt({ id: 'r2', amount: 300 }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.acquisitionCost, 10_000);
  assert.equal(report.money.receiptSpend, 800);
  assert.equal(report.money.investedToDate, 10_800);
  assert.equal(report.money.investedInHorses, 10_500, 'purchases plus horse-tied receipts, not overhead');

  // A purchase has no date, so it cannot be attributed to a month. Counting it
  // would put a horse bought two years ago in whatever month the report ran.
  assert.equal(report.money.investedThisMonth, 800);
  assert.equal(report.money.monthlyBurn, 0, 'an acquisition is not a recurring cost');
});

test('category shares stay percentages of spend, not of invested to date', () => {
  // Guards the fix: dividing by a total that includes acquisitions would leave
  // the categories summing to well under 100% with nothing on the page
  // explaining the gap — on a document handed to a banker.
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'A', costBasis: 90_000 } as never)],
      expenseReceipts: [
        receipt({ id: 'r1', amount: 750, horseId: 'h1', category: 'Feed' }),
        receipt({ id: 'r2', amount: 250, horseId: 'h1', category: 'Vet Care' }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.investedToDate, 91_000);
  assert.deepEqual(
    report.categories.map((row) => [row.category, row.share]),
    [
      ['Feed', 75],
      ['Vet Care', 25],
    ],
  );
  assert.equal(
    report.categories.reduce((total, row) => total + row.share, 0),
    100,
  );
});

test('a negative or missing cost basis contributes nothing', () => {
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'No basis' }), horse({ id: 'h2', name: 'Bad basis', costBasis: -500 } as never)],
      expenseReceipts: [receipt({ id: 'r1', amount: 100 })],
    }),
    NOW,
  );

  assert.equal(report.money.acquisitionCost, 0, 'a negative basis must not reduce what was invested');
  assert.equal(report.money.investedToDate, 100);
});

test('a horse the report counts as listed is never labelled unlisted', async () => {
  const source = await readFile('src/routes/Reports.tsx', 'utf8');

  /*
   * The summary counts Sale Prep, Market Ready and Buyer Review as inventory
   * (`listedCount` uses `isSaleInventory`), while the table re-derived the same
   * question as `askPrice > 0`. So a horse in Sale Prep with no asking price was
   * counted as listed by the summary and labelled "Not listed for sale" by the
   * row underneath it — the same report contradicting itself.
   */
  assert.match(
    source,
    /horse\.saleInventory \? 'Asking price not set' : 'Not listed for sale'/,
    'the row must distinguish "no price yet" from "not for sale"',
  );

  /*
   * The count and the rows must agree — asserted on the OUTPUT rather than on
   * the expression, which is what this used to match. A textual pin broke the
   * moment the predicate legitimately gained a term (won leads leaving the
   * inventory) and said nothing about whether the two had actually diverged;
   * this fails only when they really do contradict each other.
   */
  const mixed = buildRanchReport(
    input({
      horses: [
        horse({ id: 'h1', name: 'Priced', sale: sale({ askPrice: 30_000 }) }),
        // In Sale Prep with no asking price: inventory, and the case the
        // second derivation (`askPrice > 0`) used to get wrong.
        horse({ id: 'h2', name: 'No Price Yet', status: 'Sale Prep' }),
        horse({ id: 'h3', name: 'Sold', sale: sale({ askPrice: 20_000 }) }),
        horse({ id: 'h4', name: 'Not For Sale' }),
      ],
      salesLeads: [lead({ id: 'l1', horseId: 'h3', outcome: 'Won', stage: 'Closed', offerAmount: 19_000 })],
    }),
    NOW,
  );

  assert.equal(
    mixed.listedCount,
    mixed.horses.filter((row) => row.saleInventory).length,
    'the summary count and the rows underneath it must never contradict each other',
  );
  assert.equal(mixed.listedCount, 2, 'the priced horse and the Sale Prep one, not the sold or unlisted ones');
});

test('the exported report agrees with the screen about what is for sale', async () => {
  const exporter = await readFile('src/lib/ranchReportExport.ts', 'utf8');

  // This export is what goes to a banker, so a page saying "not listed for
  // sale" beneath its own listed count is the version that does real damage.
  assert.match(
    exporter,
    /horse\.saleInventory \? 'asking price not set' : 'not listed for sale'/,
    'the export must make the same distinction the screen does, from the same predicate',
  );
});

test('the blocked-value figure is not labelled after one of its causes', async () => {
  const reports = await readFile('src/routes/Reports.tsx', 'utf8');
  const exporter = await readFile('src/lib/ranchReportExport.ts', 'utf8');
  const intelligence = await readFile('src/lib/businessIntelligence.ts', 'utf8');

  /*
   * `valueAtRisk` adds a horse's asking price when `blockers.length` is
   * non-zero, and the blockers include an active medical review and a transfer
   * that is merely unmarked — neither is a missing document. Calling the total
   * "Waiting on documents" sent the reader after paperwork that is not missing,
   * and the same number is printed for a lender in the PDF.
   */
  assert.match(
    intelligence,
    /if \(blockers\.length\) \{\s*valueAtRisk \+= askPrice;/,
    'the total is any-blocker by construction, which is what the label has to match',
  );
  assert.match(intelligence, /blockers\.push\('Active medical review/, 'a non-document blocker feeds the same total');

  // Both surfaces, because the misleading copy was in two places and fixing
  // only the screen leaves it in front of the banker.
  for (const [name, source] of [
    ['the Reports card', reports],
    ['the PDF', exporter],
  ] as const) {
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''),
      /Waiting on documents/,
      `${name} must not name the total after one of its causes`,
    );
  }

  assert.match(reports, /label="Held up"/, 'the card and the hero must use one word for one number');
  assert.match(exporter, /Held up by blockers: \$\{money\(report\.money\.valueAtRisk\)\}/);
});

test('a horse sold on a won lead leaves the sale inventory', () => {
  /*
   * Closing a lead as Won leaves the horse's `askPrice` and `listingState`
   * untouched — the Sales editor changes the lead, not the horse — so the old
   * asking price kept appearing under "Listed" long after the money came in,
   * while buildRanchFinancials already counted the same animal as sold. The
   * Money screen and the banker-facing report disagreed about one horse.
   */
  const sold = horse({ id: 'h1', name: 'Sold Horse', sale: sale({ askPrice: 50_000, listingState: 'Market Ready' }) });
  const listed = horse({
    id: 'h2',
    name: 'Still Listed',
    sale: sale({ askPrice: 30_000, listingState: 'Market Ready' }),
  });

  const before = buildRanchReport(input({ horses: [sold, listed] }), NOW);
  assert.equal(before.listedCount, 2, 'precondition: both horses are sale inventory while no lead is won');

  const after = buildRanchReport(
    input({
      horses: [sold, listed],
      salesLeads: [lead({ id: 'l1', horseId: 'h1', outcome: 'Won', stage: 'Closed', offerAmount: 48_000 })],
    }),
    NOW,
  );

  assert.equal(after.listedCount, 1, 'a sold horse is not listed inventory');
  assert.equal(after.horseCount, 2, 'but it is still part of the herd — only the sale figures change');

  const soldRow = after.horses.find((row) => row.horseId === 'h1');
  const listedRow = after.horses.find((row) => row.horseId === 'h2');
  assert.equal(soldRow?.saleInventory, false, 'the row must not claim the horse is still for sale');
  assert.equal(listedRow?.saleInventory, true, 'and the unsold one must be untouched');

  /*
   * The listed value is the number a banker reads as "what is still on the
   * shelf". Carrying a sold horse's asking price in it overstates the
   * operation's position by the whole sale price.
   */
  assert.ok(
    after.money.listedValue < before.money.listedValue,
    'the sold horse must drop out of listed value, not merely out of the count',
  );
  assert.equal(after.money.listedValue, 30_000, 'leaving exactly the horse that is still for sale');
});

test('a lost lead does not remove a horse from the sale inventory', () => {
  // The counter-case, because the stage moves independently of the outcome: a
  // lead can sit in 'Closed' having been LOST, and that horse is still for
  // sale. Filtering on the stage rather than the outcome would quietly write
  // off every animal whose deal fell through.
  const listed = horse({ id: 'h1', name: 'Deal Fell Through', sale: sale({ askPrice: 30_000 }) });
  const report = buildRanchReport(
    input({
      horses: [listed],
      salesLeads: [lead({ id: 'l1', horseId: 'h1', outcome: 'Lost', stage: 'Closed' })],
    }),
    NOW,
  );

  assert.equal(report.listedCount, 1, 'a lost deal leaves the horse on the market');
  assert.equal(report.money.listedValue, 30_000);
});

test('a won lead never counts as open pipeline, even back in an Offer stage', () => {
  /*
   * `captureBuyerRoomOffer` reuses an existing lead matched on the buyer and
   * moves it to `Offer`. If that lead had already been won and its outcome was
   * left in place, the report read the same record both ways at once:
   * `soldHorseIds` counted the horse as sold while the new amount landed in
   * open pipeline — one animal, two contradictory figures, in the CSV and the
   * banker-facing PDF as much as on screen.
   */
  const horse1 = horse({ id: 'h1', name: 'Sold Horse', sale: sale({ askPrice: 50_000 }) });

  const contradictory = buildRanchReport(
    input({
      horses: [horse1],
      salesLeads: [
        lead({
          id: 'l1',
          horseId: 'h1',
          outcome: 'Won',
          stage: 'Offer',
          offerStatus: 'Submitted',
          offerAmount: 48_000,
        }),
      ],
    }),
    NOW,
  );

  assert.equal(contradictory.money.pipelineValue, 0, 'a closed deal is not money still on the table');
  assert.equal(contradictory.listedCount, 0, 'and the same record must not read as sold AND live');

  // The live case still counts, or the figure would be uselessly conservative.
  const live = buildRanchReport(
    input({
      horses: [horse1],
      salesLeads: [lead({ id: 'l1', horseId: 'h1', stage: 'Offer', offerStatus: 'Submitted', offerAmount: 48_000 })],
    }),
    NOW,
  );
  assert.equal(live.money.pipelineValue, 48_000, 'an open offer is still pipeline');
});

/*
 * A string in a money field concatenates rather than adds.
 *
 * `captureBuyerRoomOffer` gated on `event.amount && event.amount > 0`, which
 * the STRING "1000" satisfies by coercion, and wrote it straight into
 * `SalesLead.offerAmount`. `sum` then reduced with `+`, so two such offers made
 * the pipeline figure 10002000 instead of 3000 — wrong by a factor of three
 * thousand, on the page handed to a banker, with nothing on screen to say so.
 *
 * This is the reporting backstop. The writers are guarded separately.
 */
test('a money field that is not a number cannot inflate a banker-facing total', () => {
  const leads = [
    lead({ id: 'l1', horseId: 'h1', stage: 'Offer', offerAmount: '1000' as never }),
    lead({ id: 'l2', horseId: 'h1', stage: 'Offer', offerAmount: '2000' as never }),
  ];
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best Chex' })],
      salesLeads: leads,
      expenseReceipts: [receipt({ id: 'r1', amount: 100 })],
    }),
    NOW,
  );

  assert.ok(Number.isFinite(report.money.pipelineValue), 'the figure must stay a number');
  assert.notEqual(report.money.pipelineValue, 10002000, 'concatenation is the bug this exists to stop');
  assert.equal(report.money.pipelineValue, 0, 'a value the report cannot trust contributes nothing');
});

/*
 * And a real offer beside an untrusted one still counts. Dropping every value
 * once one is bad would be the over-correction: it would empty the pipeline
 * figure rather than merely refusing the part it cannot read.
 */
test('an untrusted amount does not take the trustworthy ones down with it', () => {
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best Chex' })],
      salesLeads: [
        lead({ id: 'l1', horseId: 'h1', stage: 'Offer', offerAmount: '1000' as never }),
        lead({ id: 'l2', horseId: 'h1', stage: 'Offer', offerAmount: 4_000 }),
      ],
      expenseReceipts: [receipt({ id: 'r1', amount: 100 })],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 4_000, 'the good offer survives');
});

/*
 * The root cause, at the writer. Asserted against the source because the store
 * action needs React plumbing this suite does not have.
 */
test('a buyer-room offer is captured only when its amount is really a number', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const code = store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  // Both bounds measured from the SAME anchor.
  const start = code.indexOf('captureBuyerRoomOffer');
  const capture = code.slice(start, code.indexOf('captureBuyerRoomFollowUp', start));
  assert.ok(capture.length > 0, 'the capture action must be findable');

  assert.match(capture, /Number\.isFinite\(event\.amount\)/, 'truthiness lets the string "1000" through');
  assert.doesNotMatch(capture, /offerAmount: event\.amount,/, 'the unchecked value must not be what reaches the lead');
});

test('reopening a closed lead clears its outcome', async () => {
  /*
   * The report guard above is the banker-facing backstop; this is the reason
   * the state should not arise in the first place. A buyer submitting a fresh
   * offer means the deal is live again, so a stale `outcome` no longer
   * describes it.
   *
   * Asserted against the source because the store action needs React plumbing
   * this suite does not have.
   */
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const code = store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const capture = code.slice(code.indexOf('captureBuyerRoomOffer'));
  // Both bounds measured from the SAME anchor: searching for the closing brace
  // from the start of the slice finds an earlier one and yields nothing.
  const updateAt = capture.indexOf('updateSalesLead(');
  const update = capture.slice(updateAt, capture.indexOf('});', updateAt));

  assert.match(update, /stage: 'Offer',/, 'this is the reopen that used to leave the outcome behind');
  assert.match(update, /outcome: undefined,/, 'and it must clear it');
});

test('an offer on a horse that has already sold is not money still in play', () => {
  /*
   * A horse can carry several leads, and winning one does not close the
   * others: `updateSalesLead` patches only the lead whose id it was given. So
   * the sibling still sitting in Offer has no outcome of its own, passes every
   * liveness test, and was counted in `pipelineValue` — while `soldHorseIds`
   * counted the same animal as sold. The report contradicted itself about one
   * horse, and it is the banker-facing PDF that says it.
   */
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best' }), horse({ id: 'h2', name: 'Peppy Rey' })],
      salesLeads: [
        lead({ id: 'l1', horseId: 'h1', stage: 'Closed', outcome: 'Won', offerAmount: 30000 }),
        // The sibling. Live by its own fields, on an animal that has left.
        lead({ id: 'l2', horseId: 'h1', stage: 'Offer', offerAmount: 28000 }),
        // A genuinely open offer on a horse nobody has bought.
        lead({ id: 'l3', horseId: 'h2', stage: 'Offer', offerAmount: 15000 }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 15000, 'only the unsold horse’s offer is still in play');
});

test('the sold-horse exclusion does not swallow ordinary open offers', () => {
  /*
   * The over-rejection direction, and the one that would quietly understate
   * what the ranch has coming in. A lead with no horse attached cannot be on a
   * sold animal, and a horse whose only lead was LOST has not sold at all.
   */
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best' }), horse({ id: 'h2', name: 'Peppy Rey' })],
      salesLeads: [
        // Lost, not Won — the horse is still in the herd and still for sale.
        lead({ id: 'l1', horseId: 'h1', stage: 'Closed', outcome: 'Lost', offerAmount: 9000 }),
        lead({ id: 'l2', horseId: 'h1', stage: 'Offer', offerAmount: 12000 }),
        // No horse attached: a general enquiry, unaffected by any sale.
        lead({ id: 'l3', horseId: undefined, stage: 'Offer', offerAmount: 5000 }),
        lead({ id: 'l4', horseId: 'h2', stage: 'Offer', offerAmount: 15000 }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 32000, 'a lost sibling and an unattached lead stay in the pipeline');
});

test('a deposit on a sold horse’s losing sibling is still held', () => {
  /*
   * Deliberately NOT given the same correction, and the difference is the
   * point. Pipeline value is money expected to COME IN, which a horse that has
   * left the herd cannot produce. A deposit is money already sitting in the
   * ranch's account, and the losing buyer's is genuinely still held until it is
   * refunded or forfeited.
   */
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best' })],
      salesLeads: [
        lead({ id: 'l1', horseId: 'h1', stage: 'Closed', outcome: 'Won', offerAmount: 30000 }),
        lead({ id: 'l2', horseId: 'h1', stage: 'Offer', depositStatus: 'Paid', depositAmount: 2500 }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 0, 'the sibling offer is not pipeline');
  assert.equal(report.money.depositsHeld, 2500, 'but its deposit is still on the books');
});

test('a negative lead amount cannot understate the money figures', () => {
  /*
   * `|| 0` and `?? 0` catch a missing amount and pass a negative one straight
   * through, and these two figures were the only readers that summed the lead
   * amounts raw. The Sales screen stored `Number(value)` on a bare truthiness
   * test, so `-500` was a figure a rancher could type and save — and it then
   * subtracted from the money in play on the report handed to a banker.
   */
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best' }), horse({ id: 'h2', name: 'Peppy Rey' })],
      salesLeads: [
        lead({ id: 'l1', horseId: 'h1', stage: 'Offer', offerAmount: -10000 }),
        lead({ id: 'l2', horseId: 'h2', stage: 'Offer', offerAmount: 15000 }),
        lead({ id: 'l3', horseId: 'h2', stage: 'Offer', depositStatus: 'Paid', depositAmount: -2500 }),
      ],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 15000, 'a negative offer must not subtract from the pipeline');
  assert.equal(report.money.depositsHeld, 0, 'nor a negative deposit from what is held');
});

test('clamping a negative offer does not discard the real one beside it', () => {
  /*
   * The over-rejection direction. A counteroffer supersedes the offer, so a
   * damaged counteroffer must fall back to the offer rather than zeroing the
   * lead — otherwise one bad field silently removes a live deal from the
   * pipeline, which is the same understatement from the other side.
   */
  const report = buildRanchReport(
    input({
      horses: [horse({ id: 'h1', name: 'Docs Best' })],
      salesLeads: [lead({ id: 'l1', horseId: 'h1', stage: 'Offer', offerAmount: 20000, counterOfferAmount: -1 })],
    }),
    NOW,
  );

  assert.equal(report.money.pipelineValue, 20000, 'the real offer still counts');
});

test('category shares always add up to exactly 100', () => {
  /*
   * Rounding each share independently misses 100 about a third of the time,
   * landing anywhere from 98% to 102%. The figure is printed beside every
   * category on screen, written to the CSV, read out as "N% of spend" in the
   * banker-facing PDF, and used as a BAR WIDTH — so the error shows four ways
   * at once, and percentages that do not add up cost a lender's confidence in
   * every other number on the page.
   *
   * The four amounts below are the shape that fails under naive rounding:
   * 2100/5450, 2000/5450, 1050/5450, 300/5450 round to 39 + 37 + 19 + 6 = 101.
   */
  const report = buildRanchReport(
    input({
      expenseReceipts: [
        receipt({ id: 'r1', amount: 2100, category: 'Vet Care' }),
        receipt({ id: 'r2', amount: 2000, category: 'Bedding' }),
        receipt({ id: 'r3', amount: 1050, category: 'Feed' }),
        receipt({ id: 'r4', amount: 300, category: 'Farrier' }),
      ],
    }),
    NOW,
  );

  assert.equal(
    report.categories.reduce((total, row) => total + row.share, 0),
    100,
    `shares were ${report.categories.map((row) => `${row.category} ${row.share}%`).join(', ')}`,
  );

  // And each share stays within a point of its exact value — the total is not
  // reached by inflating one category to cover the rest.
  const spend = report.money.receiptSpend;
  for (const row of report.categories) {
    const exact = (row.total / spend) * 100;
    assert.ok(
      Math.abs(row.share - exact) < 1,
      `${row.category} reported ${row.share}% for an exact ${exact.toFixed(2)}%`,
    );
  }
});

test('one category owns the whole spend, and no receipts means no percentages', () => {
  // The two ends. A single category is 100%, not 99% or 101%; and with nothing
  // spent there is nothing to apportion, rather than a row reading "NaN%".
  const only = buildRanchReport(
    input({ expenseReceipts: [receipt({ id: 'r1', amount: 333, category: 'Feed' })] }),
    NOW,
  );
  assert.deepEqual(
    only.categories.map((row) => [row.category, row.share]),
    [['Feed', 100]],
  );

  const none = buildRanchReport(input({ expenseReceipts: [] }), NOW);
  assert.deepEqual(none.categories, []);

  // A receipt logged with a zero amount is the case that actually reaches the
  // apportionment with nothing to divide: the category row exists, so the empty
  // list above never exercises the guard, but total spend is 0. Without the
  // guard every share is 0/0 -- and NaN reaches four places that all render it
  // verbatim: the on-screen "NaN%", the bar's style width: NaN%, the CSV
  // column, and the banker PDF's "NaN% of spend".
  const zero = buildRanchReport(input({ expenseReceipts: [receipt({ id: 'r1', amount: 0, category: 'Feed' })] }), NOW);
  assert.deepEqual(
    zero.categories.map((row) => [row.category, row.share]),
    [['Feed', 0]],
  );
  for (const row of zero.categories) {
    assert.ok(Number.isFinite(row.share), `share must be a real number, got ${row.share}`);
  }
});

test('a corrupt receipt amount cannot make a category report more than all the spend', () => {
  // Both writers refuse these amounts -- the entry form and the restore
  // preflight each require a finite amount greater than zero -- so this is the
  // backstop the rest of the module's money totals already have, applied to the
  // one total that did not have it. The category loop used `+=` on the raw
  // amount while every other figure went through `sum`, so the two could
  // disagree about the same receipts.
  //
  // The consequence was not a wrong figure but an impossible one: a share of
  // 200% or -100%, printed beside the category and drawn as a bar whose width
  // is that number.
  const corrupt = (amount: unknown) =>
    buildRanchReport(
      input({
        expenseReceipts: [
          { ...receipt({ id: 'r1', amount: 0, category: 'Feed' }), amount } as ExpenseReceipt,
          receipt({ id: 'r2', amount: 500, category: 'Farrier' }),
        ],
      }),
      NOW,
    );

  // A string concatenates rather than adding: '0' + '1000' is '01000', which
  // then divides and renders as though it were money.
  for (const amount of ['1000', {}, Number.NaN, Number.POSITIVE_INFINITY, -500]) {
    const report = corrupt(amount);
    const shares = report.categories.map((row) => row.share);
    assert.ok(
      shares.every((share) => Number.isInteger(share) && share >= 0 && share <= 100),
      `amount ${JSON.stringify(amount)} produced shares ${JSON.stringify(shares)}`,
    );
    assert.equal(
      shares.reduce((total, share) => total + share, 0),
      100,
      `amount ${JSON.stringify(amount)} produced shares summing to something other than 100`,
    );

    // The share is only half of what the row prints. `total` is rendered as a
    // dollar figure beside it, so a category holding the string '01000' shows a
    // wrong amount of money even where the percentage came out sane.
    for (const row of report.categories) {
      assert.ok(
        typeof row.total === 'number' && Number.isFinite(row.total),
        `amount ${JSON.stringify(amount)} left ${row.category} holding ${JSON.stringify(row.total)}`,
      );
      assert.ok(
        typeof row.thisMonth === 'number' && Number.isFinite(row.thisMonth),
        `amount ${JSON.stringify(amount)} left ${row.category} holding ${JSON.stringify(row.thisMonth)} this month`,
      );
    }

    // And the categories account for the recorded spend exactly. These are the
    // same receipts counted two ways; a reader who adds the category column up
    // must land on the spend figure printed above it.
    assert.equal(
      report.categories.reduce((total, row) => total + row.total, 0),
      report.money.receiptSpend,
      `amount ${JSON.stringify(amount)}: the category rows do not add up to recorded spend`,
    );
  }
});

test('equal spend resolves the leftover point by name, not by chance', () => {
  // Three categories at exactly a third each floor to 33, leaving one point
  // over and three equally deserving claimants. Which one takes it must not
  // depend on the order the receipts happened to arrive in, or the same ranch
  // data prints a different report on a different day.
  const first = buildRanchReport(
    input({
      expenseReceipts: [
        receipt({ id: 'r1', amount: 100, category: 'Vet Care' }),
        receipt({ id: 'r2', amount: 100, category: 'Bedding' }),
        receipt({ id: 'r3', amount: 100, category: 'Farrier' }),
      ],
    }),
    NOW,
  );
  const second = buildRanchReport(
    input({
      expenseReceipts: [
        receipt({ id: 'r1', amount: 100, category: 'Farrier' }),
        receipt({ id: 'r2', amount: 100, category: 'Vet Care' }),
        receipt({ id: 'r3', amount: 100, category: 'Bedding' }),
      ],
    }),
    NOW,
  );

  assert.deepEqual(
    first.categories.map((row) => [row.category, row.share]),
    second.categories.map((row) => [row.category, row.share]),
    'the same spend must produce the same report whatever order the receipts arrived in',
  );
  // Named, not merely stable: ties break alphabetically, so Bedding takes the
  // spare point in both runs.
  assert.deepEqual(
    first.categories.map((row) => [row.category, row.share]),
    [
      ['Bedding', 34],
      ['Farrier', 33],
      ['Vet Care', 33],
    ],
  );
  assert.equal(
    first.categories.reduce((total, row) => total + row.share, 0),
    100,
  );
});
