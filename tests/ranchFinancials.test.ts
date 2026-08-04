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

test('realized profit counts only Won deals and never touches overhead', () => {
  assert.equal(fin.soldCount, 2);
  // Ace 12,000 proceeds − 6,000 invested = 6,000; Bess 6,000 − 8,000 = −2,000.
  assert.equal(fin.realizedProceeds, 18000);
  assert.equal(fin.realizedCost, 14000);
  assert.equal(fin.realizedProfit, 4000); // NOT 3,700 — the $300 travel overhead is excluded
  assert.ok(Math.abs(fin.realizedMarginPercent - (4000 / 18000) * 100) < 0.01);
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

test('a Won deal with no recorded amount falls back to the asking price, not a phantom loss', () => {
  const solo = buildRanchFinancials(
    [horse('g', 1000, 4000, 'Gus')],
    [],
    [{ id: 'lg', horseId: 'g', outcome: 'Won', stage: 'Closed', offerUpdatedAt: '2026-03-01' } as unknown as SalesLead],
  );
  assert.equal(solo.soldCount, 1);
  assert.equal(solo.realizedProceeds, 4000); // asking price stood in for the missing amount
  assert.equal(solo.realizedProfit, 3000);
});
