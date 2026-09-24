import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOperationalValuePulse } from '../src/lib/operationalValuePulse.js';

test('operational value pulse prioritizes source coverage before lower-risk work', () => {
  const pulse = buildOperationalValuePulse({
    horseCount: 4,
    linkedDocumentHorseCount: 2,
    reviewQueueCount: 0,
    transferGapCount: 0,
    careDueCount: 0,
    currentMonthReceiptCount: 3,
    activeLeadCount: 1,
  });

  assert.equal(pulse.nextAction.label, 'Add missing papers');
  assert.equal(pulse.nextAction.path, '/documents?upload=1');
  assert.equal(pulse.signals[0]?.value, '50%');
});

test('operational value pulse shows clear control only when core records and queues support it', () => {
  const pulse = buildOperationalValuePulse({
    horseCount: 4,
    linkedDocumentHorseCount: 4,
    reviewQueueCount: 0,
    transferGapCount: 0,
    careDueCount: 0,
    currentMonthReceiptCount: 3,
    activeLeadCount: 1,
  });

  assert.equal(pulse.score, 100);
  assert.equal(pulse.tone, 'clear');
  assert.equal(pulse.headline, 'Your record keeping is on track.');
});

test('operational value pulse recommends the largest operating gap without inventing value claims', () => {
  const pulse = buildOperationalValuePulse({
    horseCount: 2,
    linkedDocumentHorseCount: 2,
    reviewQueueCount: 2,
    transferGapCount: 1,
    careDueCount: 2,
    currentMonthReceiptCount: 0,
    activeLeadCount: 0,
  });

  assert.equal(pulse.tone, 'watch');
  assert.equal(pulse.nextAction.label, 'Finish ownership papers');
  assert.equal(pulse.summary, 'Some records still need attention. Start with the next step below.');
  assert.doesNotMatch(JSON.stringify(pulse), /hours saved|money saved/i);
});

test('operational value pulse guides an empty workspace to its first horse record', () => {
  const pulse = buildOperationalValuePulse({
    horseCount: 0,
    linkedDocumentHorseCount: 0,
    reviewQueueCount: 0,
    transferGapCount: 0,
    careDueCount: 0,
    currentMonthReceiptCount: 0,
    activeLeadCount: 0,
  });

  assert.equal(pulse.score, 0);
  assert.equal(pulse.nextAction.path, '/horses?new=1');
});
