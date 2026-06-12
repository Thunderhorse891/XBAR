import assert from 'node:assert/strict';
import test from 'node:test';
import { completeFollowUp, followUpTiming, schedulePacketDownloadFollowUp, sortFollowUps } from '../src/lib/salesFollowUp.js';
import type { BuyerRoomEvent, SalesLead } from '../src/types/xbar.js';

const now = new Date('2026-06-05T12:00:00');
const base: SalesLead = { id: 'lead', name: 'Buyer', channel: 'Referral', horseId: 'horse', stage: 'New', lastTouch: '2026-06-01', savedListing: false, shareReady: false };
test('follow-up timing distinguishes overdue and today', () => { assert.equal(followUpTiming({ ...base, nextFollowUp: '2026-06-04' }, now), 'Overdue'); assert.equal(followUpTiming({ ...base, nextFollowUp: '2026-06-05' }, now), 'Today'); });
test('completing an offer follow-up keeps a tight cadence', () => { const patch = completeFollowUp({ ...base, stage: 'Offer' }, now); assert.equal(patch.lastTouch, '2026-06-05'); assert.equal(patch.nextFollowUp, '2026-06-07'); });
test('follow-up queue puts overdue buyers before unscheduled and upcoming buyers', () => { const leads = sortFollowUps([{ ...base, id: 'upcoming', nextFollowUp: '2026-06-20' }, { ...base, id: 'unscheduled' }, { ...base, id: 'overdue', nextFollowUp: '2026-06-01' }], now); assert.deepEqual(leads.map((lead) => lead.id), ['overdue', 'unscheduled', 'upcoming']); });
test('packet downloads schedule a same-day follow-up without changing sales stage', () => {
  const event = { id: 'download-1', horseId: base.horseId, kind: 'packet-downloaded', at: now.toISOString(), actor: 'Buyer', note: 'Reviewing with trainer.' } as BuyerRoomEvent;
  const patch = schedulePacketDownloadFollowUp(base, event, now);
  assert.equal(patch?.nextFollowUp, '2026-06-05');
  assert.equal(patch?.shareReady, true);
  assert.match(patch?.notes ?? '', /Reviewing with trainer/);
  assert.equal('stage' in (patch ?? {}), false);
  assert.equal(schedulePacketDownloadFollowUp({ ...base, notes: patch?.notes }, event, now)?.notes, patch?.notes);
});
