import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRanchFinancials } from '../src/lib/profitIntelligence.js';
import type { ExpenseReceipt, HorseRecord, SalesLead } from '../src/types/xbar.js';

// buildRanchFinancials is the money engine behind the Money view. It must turn
// records a rancher already keeps — cost basis, expense receipts, real offers —
// into an honest P&L. These tests pin the one thing that makes it trustworthy:
// realized (money in) and unrealized (still at stake) are never conflated, and
// every dollar traces to a record, never to a guess.

const horse = (id: string, costBasis: number, askPrice: number, name = id): HorseRecord =>
  ({ id, name, costBasis, sale: { askPrice } }) as unknown as HorseRecord;

const receipt = (id: string, horseId: string | undefined, category: string, amount: number): ExpenseReceipt =>
  ({ id, horseId, category, amount }) as unknown as ExpenseReceipt;

const wonLead = (id: string, horseId: string, offerAmount: number, counterOfferAmount?: number): SalesLead =>
  ({
    id,
    horseId,
    outcome: 'Won',
    stage: 'Closed',
    offerAmount,
    counterOfferAmount,
    offerUpdatedAt: '2026-01-01',
  }) as unknown as SalesLead;

const activeLead = (id: string, horseId: string, offerAmount: number): SalesLead =>
  ({
    id,
    horseId,
    offerStatus: 'Accepted',
    stage: 'Offer',
    offerAmount,
    offerUpdatedAt: '2026-02-01',
  }) as unknown as SalesLead;

// A herd that exercises every classification path at once.
const horses: HorseRecord[] = [
  horse('a', 5000, 15000, 'Ace'), // sold winner
  horse('b', 8000, 7000, 'Bess'), // sold at a loss
  horse('c', 3000, 12000, 'Cody'), // active pipeline offer
  horse('d', 10000, 8000, 'Dot'), // held, listed below break-even
  horse('e', 2000, 7000, 'Echo'), // held, healthy margin
  horse('f', 0, 0, 'Fox'), // no cost, no price — a blind spot
];
const receipts: ExpenseReceipt[] = [
  receipt('r1', 'a', 'Feed', 1000),
  receipt('r2', 'c', 'Veterinary', 500),
  receipt('r3', 'e', 'Feed', 500),
  receipt('r4', undefined, 'Travel', 300), // overhead — tied to no animal
];
const leads: SalesLead[] = [
  wonLead('l1', 'a', 10000, 12000), // counter (12k) must beat the raw offer (10k)
  wonLead('l2', 'b', 6000),
  activeLead('l3', 'c', 9000),
];

const fin = buildRanchFinancials(horses, receipts, leads);

test('gross profit is on sold animals; net profit deducts operating overhead', () => {
  assert.equal(fin.soldCount, 2);
  // Ace 12,000 proceeds − 6,000 invested = 6,000; Bess 6,000 − 8,000 = −2,000.
  assert.equal(fin.realizedProceeds, 18000);
  assert.equal(fin.realizedCost, 14000);
  assert.equal(fin.grossProfitOnSales, 4000); // gross on sold animals
  assert.equal(fin.netProfit, 3700); // 4,000 gross − 300 travel overhead = the real bottom line
  assert.equal(fin.soldMissingPriceCount, 0);
  assert.equal(fin.soldMissingCostCount, 0);
  assert.ok(Math.abs(fin.realizedMarginPercent - (4000 / 18000) * 100) < 0.01);
});

test('totalInvested decomposes exactly into herd + sold + overhead', () => {
  assert.equal(fin.investedInSold, 6000 + 8000); // Ace + Bess break-evens
  assert.equal(fin.investedInHerd + fin.investedInSold + fin.overheadSpend, fin.totalInvested);
});

test('a sale with a price but no cost basis shows proceeds, never invented profit', () => {
  const solo = buildRanchFinancials(
    [horse('k', 0, 0, 'Koda')], // no cost basis, no asking price
    [], // and no linked expenses → cost is a blind spot
    [wonLead('lk', 'k', 10000)], // sold for a known 10,000
  );
  assert.equal(solo.realizedProceeds, 10000); // cash collected is known
  assert.equal(solo.grossProfitOnSales, 0); // but profit is NOT assumed from a zero cost
  assert.equal(solo.netProfit, 0);
  assert.equal(solo.soldMissingCostCount, 1);
  assert.equal(solo.realizedMarginPercent, 0);
  assert.equal(solo.insights.find((i) => i.id === 'blindspot-sold-cost')?.tone, 'info');
});

test('a workspace with expenses but no horses still has a (negative) P&L', () => {
  const overheadOnly = buildRanchFinancials([], [receipt('rent', undefined, 'Other', 5000)], []);
  assert.equal(overheadOnly.overheadSpend, 5000);
  assert.equal(overheadOnly.netProfit, -5000);
  assert.equal(overheadOnly.totalInvested, 5000);
  assert.equal(overheadOnly.perAnimal.length, 0);
});

test('a receipt whose horse no longer exists is not silently counted as overhead', () => {
  const orphaned = buildRanchFinancials([], [receipt('r', 'ghost-horse', 'Feed', 500)], []);
  assert.equal(orphaned.overheadSpend, 0); // only unlinked (no horseId) receipts are overhead
  assert.equal(orphaned.totalInvested, 0);
});

test('unrealized value is separated into pipeline and held, priced from real offers/asks', () => {
  assert.equal(fin.pipelineCount, 1); // Cody has a live offer
  assert.equal(fin.heldCount, 3); // Dot, Echo, Fox
  assert.equal(fin.investedInHerd, 3500 + 10000 + 2500 + 0);
  assert.equal(fin.projectedValue, 9000 + 8000 + 7000 + 0);
  // Only priced animals contribute: Cody +5,500, Dot −2,000, Echo +4,500. Fox (unpriced) is excluded.
  assert.equal(fin.projectedProfit, 8000);
});

test('whole-operation totals include overhead exactly once', () => {
  assert.equal(fin.overheadSpend, 300);
  const investedSum = 6000 + 8000 + 3500 + 10000 + 2500 + 0;
  assert.equal(fin.totalInvested, investedSum + 300);
});

test('integrity signals flag underwater listings, missing costs, and missing prices', () => {
  assert.equal(fin.underwaterCount, 1); // only Dot (listed 8,000 < 10,000 break-even)
  assert.equal(fin.costBlindSpotCount, 1); // only Fox (no cost basis, no expenses)
  assert.equal(fin.unpricedHeldCount, 1); // only Fox (held with no ask)
});

test('per-animal rows sort sold first, then pipeline, then held', () => {
  const statuses = fin.perAnimal.map((row) => row.status);
  const firstHeld = statuses.indexOf('held');
  const lastSold = statuses.lastIndexOf('sold');
  const lastPipeline = statuses.lastIndexOf('pipeline');
  assert.ok(lastSold < statuses.indexOf('pipeline'), 'sold rows precede pipeline');
  assert.ok(lastPipeline < firstHeld, 'pipeline rows precede held');
  const dot = fin.perAnimal.find((row) => row.horseId === 'd');
  assert.equal(dot?.underwater, true);
  assert.equal(dot?.profit, -2000);
  assert.equal(dot?.safeSalePrice, 11500); // ceil(10,000 * 1.15 / 100) * 100
});

test('cost categories aggregate across the whole herd, largest first', () => {
  assert.deepEqual(fin.topCostCategories[0], { category: 'Feed', amount: 1500 });
  assert.equal(fin.topCostCategories.find((c) => c.category === 'Travel')?.amount, 300);
});

test('insights surface the winner, the underwater risk with a safe price, and the loss', () => {
  const byId = (id: string) => fin.insights.find((i) => i.id === id);
  assert.equal(byId('win-a')?.tone, 'win');
  assert.equal(byId('loss-b')?.tone, 'risk');
  const underwater = byId('underwater-d');
  assert.equal(underwater?.tone, 'risk');
  assert.match(underwater?.detail ?? '', /\$11,500/); // tells the rancher the exact price to fix it
  // Risks always rank ahead of wins, wins ahead of opportunities, opportunities ahead of info.
  const tones = fin.insights.map((i) => i.tone);
  assert.ok(tones.indexOf('risk') < tones.indexOf('win'), 'risks lead');
  assert.ok(tones.lastIndexOf('win') < tones.indexOf('info'), 'info trails');
});

test('a rejected offer is not counted as live pipeline value', () => {
  const solo = buildRanchFinancials(
    [horse('r', 2000, 6000, 'Rebel')], // asking 6,000
    [],
    [
      {
        id: 'lr',
        horseId: 'r',
        stage: 'Offer',
        offerStatus: 'Rejected',
        offerAmount: 9000, // a rejected 9,000 must not stand in as a live offer
        offerUpdatedAt: '2026-02-01',
      } as unknown as SalesLead,
    ],
  );
  assert.equal(solo.pipelineCount, 0);
  assert.equal(solo.heldCount, 1);
  const row = solo.perAnimal.find((r) => r.horseId === 'r');
  assert.equal(row?.status, 'held');
  assert.equal(row?.value, 6000); // falls back to the asking price, not the rejected 9,000
});

test('a cost-blind held horse is never sold as a sure upside', () => {
  const solo = buildRanchFinancials(
    [horse('u', 0, 5000, 'Uno')], // asking 5,000 but no cost basis and no expenses
    [],
    [],
  );
  assert.equal(solo.costBlindSpotCount, 1);
  assert.equal(solo.projectedProfit, 0); // profit unknown without a cost
  assert.equal(
    solo.insights.some((i) => i.id.startsWith('opportunity-')),
    false,
    'no upside insight should claim its asking price as profit',
  );
});

test('overhead can flip a positive gross into a net loss, and it is surfaced', () => {
  // A $10,000 per-animal gain with $20,000 of overhead is a $10,000 operation loss.
  const solo = buildRanchFinancials(
    [horse('h', 5000, 20000, 'Halo')],
    [receipt('rent', undefined, 'Other', 20000)],
    [wonLead('lh', 'h', 15000)], // 15,000 − 5,000 = 10,000 gross
  );
  assert.equal(solo.grossProfitOnSales, 10000);
  assert.equal(solo.overheadSpend, 20000);
  assert.equal(solo.netProfit, -10000); // the true bottom line is a loss
  assert.equal(solo.insights.find((i) => i.id === 'overhead-drag')?.tone, 'risk');
});

test('a Won deal with no recorded amount is an integrity gap, never invented revenue', () => {
  const solo = buildRanchFinancials(
    [horse('g', 1000, 4000, 'Gus')],
    [],
    [{ id: 'lg', horseId: 'g', outcome: 'Won', stage: 'Closed', offerUpdatedAt: '2026-03-01' } as unknown as SalesLead],
  );
  assert.equal(solo.soldCount, 1);
  assert.equal(solo.soldMissingPriceCount, 1);
  // The asking price is NEVER treated as proceeds collected.
  assert.equal(solo.realizedProceeds, 0);
  assert.equal(solo.grossProfitOnSales, 0);
  assert.equal(solo.netProfit, 0);
  const row = solo.perAnimal.find((r) => r.horseId === 'g');
  assert.equal(row?.status, 'sold');
  assert.equal(row?.saleValueUnknown, true);
  assert.equal(row?.value, 0);
  // Surfaced as an integrity insight so the rancher records the real price.
  assert.equal(solo.insights.find((i) => i.id === 'blindspot-sale-price')?.tone, 'info');
});
