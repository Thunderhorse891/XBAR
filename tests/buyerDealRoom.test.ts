import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBuyerDealRoomSummaries, highestBuyerOffer, openBuyerQuestions, sortBuyerRoomEvents } from '../src/lib/buyerDealRoom.js';
import type { BuyerRoomEvent, HorseRecord, SalesLead } from '../src/types/xbar.js';

const events: BuyerRoomEvent[] = [
  { id: 'view', horseId: 'horse-1', kind: 'packet-viewed', at: '2026-06-01T10:00:00Z', actor: 'Buyer' },
  { id: 'question', horseId: 'horse-1', kind: 'question', at: '2026-06-02T10:00:00Z', actor: 'Buyer', note: 'Is Coggins current?' },
  { id: 'offer-low', horseId: 'horse-1', kind: 'offer', at: '2026-06-03T10:00:00Z', actor: 'Buyer', amount: 18000 },
  { id: 'offer-high', horseId: 'horse-1', kind: 'offer', at: '2026-06-04T10:00:00Z', actor: 'Buyer', amount: 22500 },
];

const horse = {
  id: 'horse-1',
  name: 'XBAR Prospect',
  insuredValue: 20000,
  sale: { askPrice: 25000 },
} as HorseRecord;

const lead = {
  id: 'lead-1',
  name: 'Buyer',
  channel: 'Referral',
  horseId: 'horse-1',
  stage: 'Offer',
  lastTouch: '2026-06-04',
  nextFollowUp: '2026-06-06',
  offerAmount: 21000,
  savedListing: true,
  shareReady: true,
} as SalesLead;

test('buyer room sorts newest and highest-intent events first', () => {
  assert.deepEqual(sortBuyerRoomEvents(events).map((event) => event.id), ['offer-high', 'offer-low', 'question', 'view']);
});

test('buyer room detects unanswered buyer questions', () => {
  assert.deepEqual(openBuyerQuestions(events).map((event) => event.id), ['question']);
  assert.equal(openBuyerQuestions([...events, { id: 'response', horseId: 'horse-1', kind: 'seller-response', at: '2026-06-02T11:00:00Z', actor: 'Seller' }]).length, 0);
});

test('buyer room finds the highest offer from event history', () => {
  assert.equal(highestBuyerOffer(events), 22500);
});

test('buyer deal room summary prioritizes unanswered questions before offers', () => {
  const summary = buildBuyerDealRoomSummaries({ horses: [horse], leads: [lead], events })[0]!;
  assert.equal(summary.horseId, 'horse-1');
  assert.equal(summary.openQuestions, 1);
  assert.equal(summary.highestOffer, 22500);
  assert.equal(summary.status, 'offer');
  assert.equal(summary.action.label, 'Answer buyer');
});
