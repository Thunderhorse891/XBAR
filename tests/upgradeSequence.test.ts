import assert from 'node:assert/strict';
import test from 'node:test';
import { queueUpgradeDecline, waitForUpgradeDecline } from '../src/lib/upgradeSequence.js';

test('rapid reopening waits for the previous decline before making a second attempt', async () => {
  let release!: (saved: boolean) => void;
  let continued = false;
  queueUpgradeDecline(
    'account:feature',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const next = waitForUpgradeDecline('account:feature').then((saved) => {
    continued = saved;
  });
  await Promise.resolve();
  assert.equal(continued, false);
  assert.equal(await waitForUpgradeDecline('other-account:feature'), true);
  release(true);
  await next;
  assert.equal(continued, true);
});

test('failed dismissal is retried once before the next attempt and is not overwritten by closing a failed quote', async () => {
  let calls = 0;
  queueUpgradeDecline('retry-account:feature', async () => {
    calls += 1;
    return calls >= 3;
  });
  assert.equal(await waitForUpgradeDecline('retry-account:feature'), false);
  queueUpgradeDecline('retry-account:feature', async () => true);
  assert.equal(await waitForUpgradeDecline('retry-account:feature'), true);
  assert.equal(calls, 3);
});
