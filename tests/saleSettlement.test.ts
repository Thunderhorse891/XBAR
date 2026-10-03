import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildBankedHeadline, buildRanchFinancials, saleAmountReceived } from '../src/lib/profitIntelligence.js';
import { validateSalePayment } from '../src/lib/salePayment.js';
import type { ExpenseReceipt, HorseRecord, SalesLead } from '../src/types/xbar.js';

/*
 * Audit F08: "Profit banked" counted money that had not been received. Any lead
 * marked Won supplied its full amount as collected. The audit's controlled case
 * -- $10,000 cost, $25,000 offer still in Draft, $5,000 deposit still Due --
 * showed $25,000 collected and $15,000 profit, with the headline complete.
 *
 * Acceptance: an unpaid or partly paid sale cannot appear fully collected, and
 * the headline reconciles to what was recorded as received.
 */

const horse = (id: string, costBasis: number, name = id): HorseRecord =>
  ({ id, name, costBasis, sale: { askPrice: 0 } }) as unknown as HorseRecord;

const won = (horseId: string, offerAmount: number, extra: Partial<SalesLead> = {}): SalesLead =>
  ({
    id: `lead-${horseId}`,
    horseId,
    stage: 'Closed',
    outcome: 'Won',
    offerAmount,
    offerUpdatedAt: '2026-05-01',
    ...extra,
  }) as unknown as SalesLead;

const auditLead = (extra: Partial<SalesLead> = {}) =>
  won('h1', 25000, { offerStatus: 'Draft', depositAmount: 5000, depositStatus: 'Due', ...extra });

const financials = (lead: SalesLead) => buildRanchFinancials([horse('h1', 10000, 'Dun It Again')], [], [lead]);

test("the audit's unpaid sale is agreed, not collected, and the headline says so", () => {
  const fin = financials(auditLead());
  assert.equal(fin.closedSaleValue, 25000);
  assert.equal(fin.collectedFromSales, 0);
  assert.equal(fin.outstandingFromSales, 25000);
  assert.equal(fin.soldUnsettledCount, 1);
  // Nothing has been received, so nothing is banked: no $15,000 figure at all.
  assert.equal(fin.netProfit, 0);
  assert.equal(fin.grossProfitOnSales, 0);
  const headline = buildBankedHeadline(fin);
  assert.notEqual(headline.state, 'complete');
  assert.equal(headline.state, 'unknown');
  assert.equal(headline.netProfit, 0);
  assert.equal(headline.fixPhrase, 'record payments received');
  const owed = fin.insights.find((insight) => insight.id === 'sale-payment-outstanding');
  assert.equal(owed?.tone, 'risk');
  assert.equal(owed?.amount, 25000);
  assert.equal(owed?.horseId, 'h1');
});

test('a paid deposit counts as received, and only the deposit', () => {
  const fin = financials(auditLead({ depositStatus: 'Paid' }));
  assert.equal(fin.collectedFromSales, 5000);
  assert.equal(fin.outstandingFromSales, 20000);
  assert.notEqual(buildBankedHeadline(fin).state, 'complete');
  assert.equal(fin.netProfit, 0, 'a deposit is money in, but the sale is not banked until paid');
});

test('an unpaid sale adds nothing to banked profit, so overhead shows as the true floor', () => {
  const fin = buildRanchFinancials(
    [horse('h1', 10000, 'Dun It Again')],
    [{ id: 'rent', category: 'Other', amount: 300 } as unknown as ExpenseReceipt],
    [auditLead()],
  );
  assert.equal(fin.netProfit, -300, 'not +$14,700 from money nobody has paid');
  const headline = buildBankedHeadline(fin);
  assert.equal(headline.state, 'partial');
  assert.equal(headline.netProfit, -300);
  // Paid in full, the same sale is banked.
  const paid = buildRanchFinancials(
    [horse('h1', 10000, 'Dun It Again')],
    [{ id: 'rent', category: 'Other', amount: 300 } as unknown as ExpenseReceipt],
    [auditLead({ amountReceived: 25000, amountReceivedOn: '2026-05-20' })],
  );
  assert.equal(paid.netProfit, 14700);
  assert.equal(buildBankedHeadline(paid).state, 'complete');
});

test('a partly paid sale is partial; paid in full is complete', () => {
  const part = financials(auditLead({ amountReceived: 20000, amountReceivedOn: '2026-05-10' }));
  assert.equal(part.collectedFromSales, 20000);
  assert.equal(part.outstandingFromSales, 5000);
  assert.notEqual(buildBankedHeadline(part).state, 'complete');
  assert.equal(part.netProfit, 0, 'part-paid is not banked');

  const paid = financials(auditLead({ amountReceived: 25000, amountReceivedOn: '2026-05-20' }));
  assert.equal(paid.collectedFromSales, 25000);
  assert.equal(paid.outstandingFromSales, 0);
  assert.equal(paid.soldUnsettledCount, 0);
  const headline = buildBankedHeadline(paid);
  assert.equal(headline.state, 'complete');
  assert.equal(headline.netProfit, 15000);
  assert.equal(
    paid.insights.some((insight) => insight.id === 'sale-payment-outstanding'),
    false,
  );
});

test('a recorded amount replaces the deposit, and is never negative or more than the sale', () => {
  // The recorded total includes the deposit; it is not added on top of it.
  assert.equal(saleAmountReceived(auditLead({ depositStatus: 'Paid', amountReceived: 8000 }), 25000), 8000);
  assert.equal(saleAmountReceived(auditLead({ amountReceived: 30000 }), 25000), 25000);
  assert.equal(saleAmountReceived(auditLead({ amountReceived: -500 }), 25000), 0);
  // An unreadable figure (a restored backup can carry anything) is nothing received.
  assert.equal(saleAmountReceived(auditLead({ amountReceived: 'lots' as unknown as number }), 25000), 0);
  assert.equal(saleAmountReceived(auditLead({ depositStatus: 'Paid', depositAmount: undefined }), 25000), 0);
});

test('the headline reconciles: agreed = received + owed, row by row and in total', () => {
  const fin = buildRanchFinancials(
    [horse('a', 1000, 'Ace'), horse('b', 2000, 'Bess'), horse('c', 3000, 'Cody'), horse('d', 0, 'Dot')],
    [],
    [
      won('a', 9000, { amountReceived: 9000, amountReceivedOn: '2026-04-01' }),
      won('b', 12000, { depositAmount: 2000, depositStatus: 'Paid' }),
      won('c', 7000),
      won('d', 0), // no recorded amount: an integrity gap, not owed money
    ],
  );
  const sold = fin.perAnimal.filter((row) => row.status === 'sold');
  assert.equal(fin.closedSaleValue, 28000);
  assert.equal(fin.collectedFromSales, 11000);
  assert.equal(fin.outstandingFromSales, 17000);
  assert.equal(fin.closedSaleValue, fin.collectedFromSales + fin.outstandingFromSales);
  assert.equal(
    fin.collectedFromSales,
    sold.reduce((sum, row) => sum + row.received, 0),
  );
  for (const row of sold) assert.equal(row.received + row.outstanding, row.value, row.horseName);
  assert.equal(fin.soldUnsettledCount, 2);
  // Every gap is named, payment included.
  assert.equal(buildBankedHeadline(fin).fixPhrase, 'add sale prices and costs, and record payments received');
});

const TODAY = '2026-10-02';
const pay = (amount: string, receivedOn = '', saleValue = 25000) =>
  validateSalePayment({ amount, receivedOn, saleValue, today: TODAY });

test('the close-out form refuses a payment it cannot believe', () => {
  assert.deepEqual(pay(''), { ok: true });
  assert.deepEqual(pay('25000', '2026-09-30'), { ok: true, amountReceived: 25000, amountReceivedOn: '2026-09-30' });
  assert.deepEqual(pay('0'), { ok: true, amountReceived: 0 });
  const refused: Array<[string, ReturnType<typeof pay>, RegExp]> = [
    ['a date with no amount', pay('', '2026-09-30'), /amount received/i],
    ['a negative amount', pay('-50', '2026-09-30'), /\$0 or more/],
    ['text', pay('abc', '2026-09-30'), /\$0 or more/],
    ['more than the agreed price', pay('30000', '2026-09-30'), /more than the agreed sale price/],
    ['money against no recorded price', pay('5000', '2026-09-30', 0), /agreed sale amount/],
    ['a payment with no date', pay('5000'), /date the payment was received/],
    ['an impossible date', pay('5000', '2026-02-30'), /real calendar day/],
    ['a date not yet reached', pay('5000', '2026-10-03'), /future/],
  ];
  for (const [label, result, message] of refused) {
    assert.equal(result.ok, false, label);
    if (!result.ok) assert.match(result.message, message, label);
  }
});

test('the screens show money received as collected, and the form records it', async () => {
  const dashboard = await readFile('src/pages/Dashboard.tsx', 'utf8');
  assert.match(dashboard, /formatCompactCurrency\(financials\.collectedFromSales\)/);
  assert.match(dashboard, /still owed/);
  const money = await readFile('src/routes/Financials.tsx', 'utf8');
  assert.match(money, /formatCurrency\(fin\.collectedFromSales\)\} collected/);
  assert.match(money, /still owed/);
  const sales = await readFile('src/routes/Sales.tsx', 'utf8');
  assert.match(sales, /validateSalePayment\(\{/);
  // "Still owed" in the form is the engine's own figure, deposit fallback included.
  assert.match(sales, /const receivedPreview = saleAmountReceived\(/);
  assert.match(sales, /formatCompactCurrency\(agreedSaleValue - receivedPreview\)\} still owed/);
  assert.match(sales, /amountReceived: payment\.amountReceived, amountReceivedOn: payment\.amountReceivedOn/);
  assert.doesNotMatch(sales, /toISOString\(\)\.slice\(0, 10\)/, 'dates default to the local day');
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  assert.match(store, /patch\.amountReceived !== undefined &&/);
});
