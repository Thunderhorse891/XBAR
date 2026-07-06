import assert from 'node:assert/strict';
import test from 'node:test';
import { assessRevenueAtRisk, detectSpendAnomalies } from '../src/lib/businessIntelligence.js';
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

function cogginsDoc(horseId: string, daysAgo: number): DocumentRecord {
  return {
    id: `doc-${horseId}-${daysAgo}`,
    horseId,
    type: 'Coggins',
    state: 'Ready',
    uploadedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
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

test('stale Coggins blocks the sale and routes to a pre-filled upload', () => {
  const result = assessRevenueAtRisk([horse('h1', 'Spirit', 12000)], [clearRecord('h1')], [cogginsDoc('h1', 400)], now);
  assert.equal(result.valueAtRisk, 12000);
  assert.match(result.items[0]!.blockers[0] ?? '', /Coggins/);
  assert.equal(result.items[0]!.actionRoute, '/documents?upload=1&horse=h1');
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
  assert.equal(economics.costToDate, 2400);
  assert.equal(economics.monthlyBurn, 300);
  assert.equal(economics.breakEvenPrice, 3000);
  assert.equal(economics.safeDiscountFloor, 3450);
  assert.equal(economics.projectedMargin, 9000);
  assert.equal(economics.marginPercent, 75);
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
