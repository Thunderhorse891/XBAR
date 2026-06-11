import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBreedingRevenueProfile } from '../src/lib/breedingRevenue.js';
import { buildUsageMeters, featureGate, usagePressure } from '../src/lib/commercialEngine.js';
import { buildHorseProfitProfile } from '../src/lib/profitIntelligence.js';
import { buildSaleHold } from '../src/lib/saleTrustEngine.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';
import type { DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord, SubscriptionProfile } from '../src/types/xbar.js';

function subscription(tier: SubscriptionProfile['tier'], used = 0): SubscriptionProfile {
  const config = subscriptionPlans[tier];
  return {
    tier,
    monthlyRate: config.monthlyRate,
    renewalDate: '',
    billingState: 'Active',
    sharedAccessEnabled: config.sharedAccessEnabled,
    featureFlags: config.featureFlags,
    usage: {
      horsesUsed: used,
      seatsUsed: used,
      documentsProcessed: used,
      salePacketsGenerated: used,
      sharedAccessSeatsUsed: 0,
      storageUsedGb: 0,
      ...config.limits,
    },
  };
}

const horse = {
  id: 'horse-1',
  name: 'Revenue Horse',
  status: 'Active',
  segment: 'Stud',
  costBasis: 10000,
  breedingEconomics: { studFee: 1500, bookedMares: 4, breedingCosts: 500, mareProductionValue: 0, foalProjectedValue: 2000 },
  sale: { askPrice: 18000 },
  alerts: [],
} as unknown as HorseRecord;
const receipt = { id: 'receipt-1', horseId: horse.id, category: 'Feed', amount: 2000 } as ExpenseReceipt;

test('usage pressure moves through warning, upgrade, and hard gate thresholds', () => {
  assert.equal(usagePressure(79, 100), 'clear');
  assert.equal(usagePressure(80, 100), 'warning');
  assert.equal(usagePressure(90, 100), 'upgrade');
  assert.equal(usagePressure(100, 100), 'blocked');
  assert.equal(buildUsageMeters(subscription('Starter', 5))[0].pressure, 'blocked');
});

test('commercial features unlock at their intended plans', () => {
  assert.match(featureGate(subscription('Starter'), 'buyerDealRoom') ?? '', /Professional/);
  assert.equal(featureGate(subscription('Professional'), 'buyerDealRoom'), null);
  assert.match(featureGate(subscription('Professional'), 'profitIntelligence') ?? '', /Ranch Ops/);
});

test('profit and breeding intelligence tie spend to revenue decisions', () => {
  const profit = buildHorseProfitProfile(horse, [receipt], []);
  assert.equal(profit.breakEven, 12000);
  assert.equal(profit.safeSalePrice, 13800);
  const breeding = buildBreedingRevenueProfile(horse, [receipt]);
  assert.equal(breeding.stallionRevenue, 6000);
  assert.equal(Math.round(breeding.roi), 220);
});

test('sale hold blocks missing Coggins and ownership proof', () => {
  assert.equal(buildSaleHold(horse, [], undefined).held, true);
  const documents = [{ horseId: horse.id, type: 'Coggins', state: 'Ready', uploadedAt: new Date().toISOString(), entities: {} }, { horseId: horse.id, type: 'Registration', state: 'Ready', uploadedAt: new Date().toISOString(), entities: {} }] as DocumentRecord[];
  const ownership = { horseId: horse.id, transferStatus: 'Clear', confidence: 96, pendingDocuments: [] } as unknown as OwnershipRecord;
  assert.equal(buildSaleHold(horse, documents, ownership).held, false);
});
