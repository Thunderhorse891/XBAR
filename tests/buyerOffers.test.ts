import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildBuyerOfferPatch, createBuyerOfferDraft } from '../src/lib/buyerOffers.js';
import type { SalesLead } from '../src/types/xbar.js';

const baseLead: SalesLead = {
  id: 'lead-1',
  name: 'Buyer',
  channel: 'Referral',
  horseId: 'horse-1',
  stage: 'New',
  lastTouch: '2026-06-01',
  savedListing: false,
  shareReady: true,
};

test('buyer offer form builds an explicit persisted offer patch', () => {
  const result = buildBuyerOfferPatch(
    {
      amount: '18,500',
      status: 'Countered',
      buyerNote: 'Buyer wants PPE before deposit.',
      counterOffer: '20000',
      depositAmount: '2500',
      depositStatus: 'Due',
      followUpDate: '2026-07-07',
      existingNotes: 'Initial call went well.',
    },
    new Date('2026-07-03T12:00:00Z'),
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.amount, 18500);
  assert.deepEqual(result.patch, {
    stage: 'Offer',
    lastTouch: '2026-07-03',
    offerAmount: 18500,
    offerStatus: 'Countered',
    depositStatus: 'Due',
    counterOfferAmount: 20000,
    depositAmount: 2500,
    nextFollowUp: '2026-07-07',
    notes: 'Initial call went well.\n\nOffer note: Buyer wants PPE before deposit.',
  });
});

test('buyer offer form rejects missing or invalid money fields', () => {
  assert.deepEqual(buildBuyerOfferPatch(createBuyerOfferDraft(baseLead)), {
    ok: false,
    message: 'Offer amount is required.',
  });
  assert.deepEqual(buildBuyerOfferPatch({ ...createBuyerOfferDraft(baseLead), amount: '0' }), {
    ok: false,
    message: 'Offer amount must be greater than $0.',
  });
  assert.deepEqual(buildBuyerOfferPatch({ ...createBuyerOfferDraft(baseLead), amount: '12000', depositAmount: '-1' }), {
    ok: false,
    message: 'Deposit amount must be greater than $0.',
  });
});

test('buyer follow-up offer action does not hard-code a fake amount', async () => {
  const source = await readFile('src/routes/BuyerDealRoom.tsx', 'utf8');
  assert.doesNotMatch(source, /22000|22,000|\$22,000/);
});

test('the Sales screen refuses the money the deal room already refuses', async () => {
  const screen = await readFile('src/routes/Sales.tsx', 'utf8');

  /*
   * Two doors into the same three fields, and only one of them was locked.
   * `buildBuyerOfferPatch` sends every amount through `parsePositiveMoney`, but
   * the Sales lead form stored `Number(value)` on a bare truthiness test — so
   * `-500` was a figure a rancher could type and save, and it landed in
   * `pipelineValue` on the report handed to a banker. The deposit rule that was
   * there only fires when a deposit is due, and the offer and counteroffer had
   * no rule at all.
   */
  const submitAt = screen.indexOf('const result = updateSalesLead(selectedLead.id, {');
  assert.ok(submitAt > -1, 'the lead submit handler must be findable');
  const guards = screen.slice(0, submitAt);

  for (const field of ['leadOfferAmount', 'leadCounterOfferAmount', 'leadDepositAmount']) {
    assert.match(
      guards,
      new RegExp(`\\['[^']+', ${field}\\]`),
      `${field} must be checked before the lead is written, not just when a deposit is due`,
    );
  }
  assert.match(guards, /!\(Number\(raw\) > 0\)/, 'zero and negative must both be refused');

  // And an EMPTY field must stay optional — an offer with no counteroffer or
  // deposit is the ordinary case, and demanding one would block real updates.
  assert.match(guards, /raw && !\(Number\(raw\) > 0\)/, 'an unfilled amount must not be treated as invalid');
});
