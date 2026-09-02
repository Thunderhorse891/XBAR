import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRevenueAtRisk, detectSpendAnomalies } from '../src/lib/businessIntelligence.js';
import { CURRENT_COGGINS_DAYS, hasCurrentReadyDocument } from '../src/lib/documentCurrency.js';
import { createOwnershipRecord } from '../src/store/xbarStoreLogic.js';
import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord } from '../src/types/xbar.js';

const now = new Date('2026-06-10T12:00:00Z');

function horse(id: string, name: string, askPrice: number, status: HorseRecord['status'] = 'Sale Prep'): HorseRecord {
  return {
    id,
    name,
    status,
    owner: 'Erin',
    sale: { askPrice, listingState: 'Market Ready' },
  } as unknown as HorseRecord;
}

/*
 * The EXAM date varies; the upload is always today.
 *
 * That separation is the whole point. The assessment used to measure the
 * twelve months from `uploadedAt`, so a year-old Coggins uploaded this morning
 * read as current — and this fixture, which set only `uploadedAt`, could not
 * tell the two apart. Pinning the upload to today means every case below fails
 * if the window is ever measured from it again.
 */
function cogginsDoc(
  horseId: string,
  examDaysAgo: number | null,
  state: DocumentRecord['state'] = 'Ready',
): DocumentRecord {
  return {
    id: `doc-${horseId}-${examDaysAgo}-${state}`,
    horseId,
    type: 'Coggins',
    state,
    uploadedAt: now.toISOString(),
    entities:
      examDaysAgo === null ? {} : { examDate: new Date(now.getTime() - examDaysAgo * 86_400_000).toISOString() },
  } as DocumentRecord;
}

function clearRecord(horseId: string): OwnershipRecord {
  const record = createOwnershipRecord({ id: horseId, name: 'X', owner: 'Erin' } as HorseRecord);
  return {
    ...record,
    transferStatus: 'Clear',
    proofRequirements: record.proofRequirements?.map((item) => ({ ...item, status: 'verified' as const })),
  };
}

function receipt(category: ExpenseReceipt['category'], amount: number, monthsAgo: number): ExpenseReceipt {
  const date = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 5);
  return {
    id: `r-${category}-${monthsAgo}-${amount}`,
    category,
    amount,
    receiptDate: date.toISOString(),
  } as ExpenseReceipt;
}

test('listed horse with verified proof and current Coggins is sale-ready', () => {
  const result = assessRevenueAtRisk([horse('h1', 'Spirit', 18500)], [clearRecord('h1')], [cogginsDoc('h1', 90)], now);
  assert.equal(result.totalListedValue, 18500);
  assert.equal(result.valueAtRisk, 0);
  assert.equal(result.items.length, 0);
});

test('unverified ownership documents price the listing as blocked with a fix action', () => {
  const record = createOwnershipRecord({ id: 'h1', name: 'Spirit', owner: 'Erin' } as HorseRecord);
  const result = assessRevenueAtRisk([horse('h1', 'Spirit', 18500)], [record], [cogginsDoc('h1', 90)], now);
  assert.equal(result.valueAtRisk, 18500);
  assert.equal(result.items.length, 1);
  assert.match(result.items[0]!.blockers[0] ?? '', /documents unverified/);
  assert.match(result.items[0]!.actionLabel, /Verify documents for Spirit/);
  assert.equal(result.items[0]!.actionRoute, '/ownership');
});

test('a Coggins whose EXAM is stale blocks the sale, however recent the upload', () => {
  // Uploaded today, drawn 400 days ago. Measured from the upload this was
  // "current" and the horse's full ask counted as ready to close.
  const result = assessRevenueAtRisk([horse('h1', 'Spirit', 12000)], [clearRecord('h1')], [cogginsDoc('h1', 400)], now);
  assert.equal(result.valueAtRisk, 12000);
  assert.match(result.items[0]!.blockers[0] ?? '', /no current exam date/);
  assert.equal(result.items[0]!.actionRoute, '/documents?horse=h1');
});

test('a Coggins nobody has reviewed is not proof of anything', () => {
  for (const state of ['Queued', 'Needs Review', 'Matched'] as const) {
    const result = assessRevenueAtRisk(
      [horse('h1', 'Spirit', 12000)],
      [clearRecord('h1')],
      [cogginsDoc('h1', 30, state)],
      now,
    );
    assert.equal(result.valueAtRisk, 12000, `${state} must not count as a current Coggins`);
    assert.equal(result.readyValue, 0, `${state} must not move the ask into ready`);
  }
});

test('a reviewed Coggins with no exam date at all is not current', () => {
  const result = assessRevenueAtRisk(
    [horse('h1', 'Spirit', 12000)],
    [clearRecord('h1')],
    [cogginsDoc('h1', null)],
    now,
  );
  assert.equal(result.valueAtRisk, 12000);
  assert.match(result.items[0]!.blockers[0] ?? '', /no current exam date/);
});

test('a horse with no Coggins is told to upload one, not to review one', () => {
  // Telling someone to review a document they never uploaded is how a report
  // stops being read.
  const result = assessRevenueAtRisk([horse('h1', 'Spirit', 12000)], [clearRecord('h1')], [], now);
  assert.match(result.items[0]!.blockers[0] ?? '', /No Coggins on file/);
  assert.equal(result.items[0]!.actionRoute, '/documents?upload=1&horse=h1');
});

test('the risk report and the sale-packet gate agree about the same horse', () => {
  /*
   * The finding in one assertion. They answered the same question differently,
   * so the gate held a horse back while the report counted its full ask as
   * ready — and the report is what reaches a spreadsheet and a PDF.
   */
  for (const [examDaysAgo, state] of [
    [30, 'Ready'],
    [400, 'Ready'],
    [30, 'Needs Review'],
    [null, 'Ready'],
  ] as const) {
    const documents = [cogginsDoc('h1', examDaysAgo, state)];
    const gate = hasCurrentReadyDocument(documents, CURRENT_COGGINS_DAYS, now);
    const report = assessRevenueAtRisk([horse('h1', 'Spirit', 12000)], [clearRecord('h1')], documents, now);
    assert.equal(
      gate,
      report.items.length === 0,
      `the gate and the risk report disagree for exam ${examDaysAgo} days ago in state ${state}`,
    );
  }
});

test('horses without sale intent are ignored', () => {
  const pastured = {
    id: 'h1',
    name: 'Pasture Pal',
    status: 'Pasture',
    owner: 'Erin',
    sale: { askPrice: 0, listingState: 'Private' },
  } as unknown as HorseRecord;
  const result = assessRevenueAtRisk([pastured], [], [], now);
  assert.equal(result.totalListedValue, 0);
  assert.equal(result.items.length, 0);
});

test('spend anomalies flag categories above trailing average with an action', () => {
  const receipts: ExpenseReceipt[] = [
    receipt('Feed', 900, 0),
    receipt('Feed', 500, 1),
    receipt('Feed', 520, 2),
    receipt('Feed', 480, 3),
    receipt('Farrier', 200, 0),
    receipt('Farrier', 210, 1),
    receipt('Farrier', 190, 2),
    receipt('Farrier', 200, 3),
  ];
  const anomalies = detectSpendAnomalies(receipts, now);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0]!.category, 'Feed');
  assert.equal(anomalies[0]!.deltaPercent, 80);
  assert.equal(anomalies[0]!.actionRoute, '/expenses');
});

test('trivial or trendless spend is not flagged', () => {
  assert.equal(detectSpendAnomalies([receipt('Feed', 30, 0)], now).length, 0);
  assert.equal(detectSpendAnomalies([receipt('Feed', 900, 0)], now).length, 0);
});

test('horse economics compute burn, break-even, and the safe discount floor', async () => {
  const { computeHorseEconomics } = await import('../src/lib/businessIntelligence.js');
  const receipts: ExpenseReceipt[] = [
    {
      id: 'e1',
      horseId: 'h1',
      category: 'Feed',
      amount: 300,
      receiptDate: new Date(now.getFullYear(), now.getMonth(), 2).toISOString(),
    } as ExpenseReceipt,
    {
      id: 'e2',
      horseId: 'h1',
      category: 'Vet Care',
      amount: 600,
      receiptDate: new Date(now.getFullYear(), now.getMonth() - 1, 2).toISOString(),
    } as ExpenseReceipt,
    {
      id: 'e3',
      horseId: 'h1',
      category: 'Farrier',
      amount: 1500,
      receiptDate: new Date(now.getFullYear() - 1, 0, 2).toISOString(),
    } as ExpenseReceipt,
    { id: 'e4', horseId: 'other', category: 'Feed', amount: 999, receiptDate: now.toISOString() } as ExpenseReceipt,
  ];
  const economics = computeHorseEconomics(horse('h1', 'Spirit', 12000), receipts, now);

  // Everything ever spent on this horse, whenever it was spent.
  assert.equal(economics.costToDate, 2400);

  // Burn averages the three COMPLETE months before this one, so only e2 ($600,
  // last month) is inside the window: 600 / 3 = 200. e1 is this month, which is
  // still in progress and is reported as current spend rather than averaged
  // against whole months; e3 is a year old.
  //
  // This previously read 300, which was the old defect in disguise: the window
  // ran from three months back to today, spanning four calendar months, and
  // divided by three — $900 over two months came out as $300 by coincidence.
  assert.equal(economics.monthlyBurn, 200);

  assert.equal(economics.breakEvenPrice, 2800, 'cost to date plus two months of carry');
  assert.equal(economics.safeDiscountFloor, 3220, 'break-even plus the 15% protected margin');
  assert.equal(economics.projectedMargin, 9200);
  assert.equal(economics.marginPercent, 77);
});

test('an active medical review prices the listing as blocked with disclosure required', () => {
  const held = {
    id: 'h1',
    name: 'Spirit',
    status: 'Medical Review',
    owner: 'Erin',
    sale: { askPrice: 9000, listingState: 'Market Ready' },
  } as unknown as HorseRecord;
  const result = assessRevenueAtRisk([held], [clearRecord('h1')], [cogginsDoc('h1', 30)], now);
  assert.equal(result.valueAtRisk, 9000);
  assert.match(result.items[0]!.blockers[0] ?? '', /medical review/);
  assert.equal(result.items[0]!.actionRoute, '/medical?horse=h1');
});

/*
 * The purchase price belongs in a horse's economics.
 *
 * computeHorseEconomics summed linked receipts only, so a horse bought for
 * $10,000 with nothing spent on it reported $0 to date — and this figure is
 * what safeDiscountFloor is built from. The sale-packet wizard shows that floor
 * to a seller as the lowest price worth taking, so a floor that ignores the
 * purchase price can talk somebody into an offer below their real break-even.
 */
test('horse economics include what the horse cost to buy', async () => {
  const { computeHorseEconomics } = await import('../src/lib/businessIntelligence.js');

  const bought = computeHorseEconomics(horse('h1', 'Bought', 20000), [], now);
  assert.equal(bought.costToDate, 0, 'the helper fixture has no cost basis');

  const withBasis = computeHorseEconomics({ ...horse('h1', 'Bought', 20000), costBasis: 10_000 } as never, [], now);
  assert.equal(withBasis.costToDate, 10_000);
  assert.equal(withBasis.breakEvenPrice, 10_000, 'no receipts, so no carry to add');
  assert.equal(withBasis.projectedMargin, 10_000, '20,000 asking less 10,000 break-even');
  assert.equal(withBasis.safeDiscountFloor, 11_500, 'break-even plus the 15% protected margin');

  // And it adds to spend rather than replacing it.
  const both = computeHorseEconomics(
    { ...horse('h1', 'Bought', 20000), costBasis: 10_000 } as never,
    [
      {
        id: 'e1',
        horseId: 'h1',
        category: 'Feed',
        amount: 600,
        receiptDate: new Date(now.getFullYear(), now.getMonth() - 1, 2).toISOString(),
      } as ExpenseReceipt,
    ],
    now,
  );
  assert.equal(both.costToDate, 10_600);

  // A negative basis must not reduce what a horse has cost.
  const negative = computeHorseEconomics({ ...horse('h1', 'Bought', 20000), costBasis: -500 } as never, [], now);
  assert.equal(negative.costToDate, 0);
});

test('document currency is not re-implemented outside its module', async () => {
  /*
   * The recurrence guard, and it sweeps rather than naming the two files that
   * drifted — enumerating known call sites is exactly how this defect survived.
   * Two modules each defined a `hasCurrentCoggins`, under the same name, with
   * different meanings, and nothing connected them.
   *
   * KNOWN EXCLUSION: src/lib/saleTrustEngine.ts holds a third one, which falls
   * back to `uploadedAt` when a Ready document carries no exam date. It is the
   * same class of defect and it gates a sale, but that file is not touched by
   * this change, so fixing it here would widen the diff into code this branch
   * does not own. It is listed rather than skipped so it cannot be mistaken
   * for something nobody noticed.
   *
   * Not swept: dashboardOps and documentTemplateLibrary also read
   * `entities.examDate ?? uploadedAt`, but to schedule a reminder and to sort
   * and print a date — neither decides whether a horse is ready, which is the
   * question that has to have one answer.
   */
  const { readdir, readFile } = await import('node:fs/promises');
  const knownExclusions = ['saleTrustEngine.ts'];

  const offenders: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (entry.name === 'documentCurrency.ts' || knownExclusions.includes(entry.name)) continue;

      const source = await readFile(full, 'utf8');
      // Strip comments: this file's own explanation of the fix names these.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      if (/function\s+(hasCurrentCoggins|hasCurrentReadyDocument|isCurrentDatedDocument)/.test(code)) {
        offenders.push(`${full} defines its own currency predicate`);
      }
      if (/365\s*\*\s*24/.test(code) || /COGGINS_VALID_DAYS/.test(code)) {
        offenders.push(`${full} measures its own twelve-month window`);
      }
    }
  };
  await walk('src');

  assert.deepEqual(offenders, [], `document currency must come from documentCurrency.ts:\n${offenders.join('\n')}`);
});

test('both readiness callers answer from the shared module', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['src/lib/businessIntelligence.ts', 'src/lib/xbarPhaseTwo.ts']) {
    const source = await readFile(file, 'utf8');
    assert.match(source, /from '\.\/documentCurrency\.js'/, `${file} must not answer this question itself`);
  }
});
