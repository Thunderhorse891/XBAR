import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBuyerDealRoomSummaries, openBuyerQuestions, sortBuyerRoomEvents } from '../src/lib/buyerDealRoom.js';
import type { BuyerRoomEvent, HorseRecord, SalesLead } from '../src/types/xbar.js';

const events: BuyerRoomEvent[] = [
  { id: 'view', horseId: 'horse-1', kind: 'packet-viewed', at: '2026-06-01T10:00:00Z', actor: 'Buyer' },
  { id: 'question', horseId: 'horse-1', kind: 'question', at: '2026-06-02T10:00:00Z', actor: 'Buyer' },
  { id: 'offer', horseId: 'horse-1', kind: 'offer', at: '2026-06-03T10:00:00Z', actor: 'Buyer', amount: 22500 },
];

const horse = { id: 'horse-1', name: 'XBAR Prospect', insuredValue: 20000, sale: { askPrice: 25000 } } as HorseRecord;
const lead = { id: 'lead-1', name: 'Buyer', channel: 'Referral', horseId: 'horse-1', stage: 'Offer', lastTouch: '2026-06-03', offerAmount: 21000, savedListing: true, shareReady: true } as SalesLead;

test('buyer room sorts newest events first', () => {
  assert.equal(sortBuyerRoomEvents(events)[0]?.id, 'offer');
});

test('buyer room detects open buyer questions until seller responds', () => {
  assert.equal(openBuyerQuestions(events).length, 1);
  assert.equal(openBuyerQuestions([...events, { id: 'response', horseId: 'horse-1', kind: 'seller-response', at: '2026-06-02T11:00:00Z', actor: 'Seller' }]).length, 0);
});

test('buyer room summarizes offer pressure for sale horses', () => {
  const summary = buildBuyerDealRoomSummaries({ horses: [horse], leads: [lead], events })[0]!;
  assert.equal(summary.horseId, 'horse-1');
  assert.equal(summary.openQuestions, 1);
  assert.equal(summary.highestOffer, 22500);
});
