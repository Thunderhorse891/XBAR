import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBreedingRevenueProfile } from '../src/lib/breedingRevenue.js';
import { buildBuyerDealRoomSummaries, hasSellerResponse, openBuyerRequests, publicShareEventToBuyerRoomEvent } from '../src/lib/buyerDealRoom.js';
import { buildUsageMeters, featureGate, usagePressure } from '../src/lib/commercialEngine.js';
import { buildHorseProfitProfile, buildOfferDecision } from '../src/lib/profitIntelligence.js';
import { buildPublicBuyerPacketArtifact } from '../src/lib/publicBuyerPacket.js';
import { buildSaleHold } from '../src/lib/saleTrustEngine.js';
import { subscriptionPlans } from '../src/lib/subscriptionPlans.js';
import type { BuyerRoomEvent, DocumentRecord, ExpenseReceipt, HorseRecord, OwnershipRecord, SubscriptionProfile } from '../src/types/xbar.js';

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

test('offer decision guardrail blocks losses and protects margin', () => {
  const loss = buildOfferDecision(horse, [receipt], 11000);
  assert.equal(loss.status, 'loss');
  assert.equal(loss.acceptanceBlocked, true);
  assert.equal(loss.safeSalePrice, 13800);

  const thinMargin = buildOfferDecision(horse, [receipt], 12500);
  assert.equal(thinMargin.status, 'thin-margin');
  assert.equal(thinMargin.overrideRequired, true);

  const protectedMargin = buildOfferDecision(horse, [receipt], 14000);
  assert.equal(protectedMargin.status, 'protected-margin');
  assert.equal(protectedMargin.acceptanceBlocked, false);
  assert.equal(protectedMargin.overrideRequired, false);
});

test('offer decision guardrail requires cost proof before relying on margin', () => {
  const noCostHorse = { ...horse, costBasis: 0 } as HorseRecord;
  const decision = buildOfferDecision(noCostHorse, [], 14000);
  assert.equal(decision.status, 'missing-costs');
  assert.equal(decision.overrideRequired, true);
});

test('public buyer proof requests become actionable deal-room events', () => {
  const event = publicShareEventToBuyerRoomEvent({
    id: 'share-event-1',
    listing_id: 'listing-1',
    horse_id: horse.id,
    event_type: 'buyer-proof-requested',
    metadata: { buyerName: 'Buyer One', buyerEmail: 'buyer@example.com', message: 'Please send the current Coggins.' },
    viewed_at: '2026-06-11T14:00:00.000Z',
  });

  assert.equal(event?.kind, 'proof-requested');
  assert.equal(event?.actor, 'Buyer One');
  assert.match(event?.note ?? '', /current Coggins/);
  assert.equal(openBuyerRequests(event ? [event] : []).length, 1);

  const response = publicShareEventToBuyerRoomEvent({
    id: 'share-event-2',
    listing_id: 'listing-1',
    horse_id: horse.id,
    event_type: 'seller-response',
    metadata: { actor: 'sales@example.com', note: 'Coggins sent.', replyToEventId: event?.id },
    viewed_at: '2026-06-11T14:05:00.000Z',
  });
  assert.equal(response?.kind, 'seller-response');
  assert.equal(response?.replyToEventId, event?.id);
  assert.equal(hasSellerResponse([event, response].filter(Boolean) as BuyerRoomEvent[], event as BuyerRoomEvent), true);
});

test('buyer packet downloads dispatch seller follow-up pressure', () => {
  const download = {
    id: 'download-1',
    horseId: horse.id,
    kind: 'packet-downloaded',
    at: '2026-06-12T12:00:00.000Z',
    actor: 'Buyer One',
  } as BuyerRoomEvent;

  const summary = buildBuyerDealRoomSummaries({ horses: [horse], leads: [], events: [download] })[0];

  assert.equal(summary.packetDownloads, 1);
  assert.equal(summary.action.label, 'Follow up');
  assert.match(summary.action.reason, /packet download/);
});

test('public buyer packet includes approved summaries without internal record data', () => {
  const documents = [{
    id: 'doc-1',
    title: 'Current Coggins',
    type: 'Coggins',
    summary: 'Negative EIA test confirmed.',
    fileName: 'private-source-file.pdf',
    extractedTextPreview: 'PRIVATE OCR TEXT',
    entities: { ownerName: 'PRIVATE OWNER' },
  }] as unknown as Parameters<typeof buildPublicBuyerPacketArtifact>[0]['documents'];
  const horseWithPrivateData = {
    ...horse,
    name: 'Blue Moon',
    breed: 'Quarter Horse',
    sex: 'Mare',
    age: 6,
    color: 'Bay',
    registry: 'AQHA',
    registrationNumber: 'AQHA-123',
    aqhaNumber: '',
    sale: { ...horse.sale, askPrice: 25000, listingState: 'Market Ready' },
    readiness: { score: 92, packetStatus: 'Ready', blockers: [] },
    medicalNotes: 'PRIVATE MEDICAL NOTE',
  } as HorseRecord;

  const artifact = buildPublicBuyerPacketArtifact({
    horse: horseWithPrivateData,
    documents,
    generatedAt: new Date('2026-06-12T12:00:00.000Z'),
  });

  assert.equal(artifact.fileName, 'xbar-buyer-packet-blue-moon.html');
  assert.match(artifact.html, /Blue Moon/);
  assert.match(artifact.html, /Current Coggins/);
  assert.match(artifact.html, /Negative EIA test confirmed/);
  assert.doesNotMatch(artifact.html, /PRIVATE MEDICAL NOTE/);
  assert.doesNotMatch(artifact.html, /PRIVATE OCR TEXT/);
  assert.doesNotMatch(artifact.html, /PRIVATE OWNER/);
  assert.doesNotMatch(artifact.html, /private-source-file\.pdf/);
});

test('seller responses resolve only the intended buyer request', () => {
  const first = { id: 'request-1', horseId: horse.id, kind: 'question', at: '2026-06-11T14:00:00.000Z', actor: 'Buyer One' } as BuyerRoomEvent;
  const second = { id: 'request-2', horseId: horse.id, kind: 'proof-requested', at: '2026-06-11T14:01:00.000Z', actor: 'Buyer Two' } as BuyerRoomEvent;
  const response = { id: 'response-1', horseId: horse.id, kind: 'seller-response', at: '2026-06-11T14:02:00.000Z', actor: 'Sales Lead', replyToEventId: first.id } as BuyerRoomEvent;

  assert.equal(hasSellerResponse([first, second, response], first), true);
  assert.equal(hasSellerResponse([first, second, response], second), false);
  assert.deepEqual(openBuyerRequests([first, second, response]).map((event) => event.id), [second.id]);
});

test('sale hold blocks missing Coggins and ownership proof', () => {
  assert.equal(buildSaleHold(horse, [], undefined).held, true);
  const documents = [{ horseId: horse.id, type: 'Coggins', state: 'Ready', uploadedAt: new Date().toISOString(), entities: {} }, { horseId: horse.id, type: 'Registration', state: 'Ready', uploadedAt: new Date().toISOString(), entities: {} }] as DocumentRecord[];
  const ownership = { horseId: horse.id, transferStatus: 'Clear', confidence: 96, pendingDocuments: [] } as unknown as OwnershipRecord;
  assert.equal(buildSaleHold(horse, documents, ownership).held, false);
});
