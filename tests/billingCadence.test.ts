import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { subscriptionFromCloudRow } from '../src/lib/cloudSubscription.js';
import { paybackPlan } from '../src/lib/costPerHorse.js';

/*
 * Audit F14: the server records which cadence a purchase is billed on (the
 * billing_period column and the payload) and the annual price, but the
 * cloud-to-client mapper dropped both. An annual subscriber's billing screen
 * opened on monthly prices, its checkout summary said "Monthly", and the
 * payback card measured the plan at the monthly list rate.
 */

const activePro = { tier: 'Professional', billing_state: 'Active', monthly_rate: 29 };

test('the purchased cadence and annual price reach the client profile', () => {
  const annual = subscriptionFromCloudRow({ ...activePro, billing_period: 'annual', payload: { annualRate: 290 } });
  assert.equal(annual?.billingPeriod, 'annual');
  assert.equal(annual?.annualRate, 290);

  const monthly = subscriptionFromCloudRow({ ...activePro, billing_period: 'monthly', payload: {} });
  assert.equal(monthly?.billingPeriod, 'monthly');
});

test('the column wins over the payload, and the payload covers rows read without it', () => {
  const column = subscriptionFromCloudRow({
    ...activePro,
    billing_period: 'annual',
    payload: { billingPeriod: 'monthly' },
  });
  assert.equal(column?.billingPeriod, 'annual');
  const payloadOnly = subscriptionFromCloudRow({ ...activePro, payload: { billingPeriod: 'annual' } });
  assert.equal(payloadOnly?.billingPeriod, 'annual');
});

test('an unknown cadence stays unknown -- it is never read as monthly', () => {
  for (const value of [null, undefined, '', 'yearly', 12]) {
    const profile = subscriptionFromCloudRow({
      ...activePro,
      billing_period: value,
      payload: { billingPeriod: value },
    });
    assert.equal(profile?.billingPeriod, undefined, `${String(value)} is not a cadence`);
  }
  const noRate = subscriptionFromCloudRow({ ...activePro, payload: { annualRate: 'lots' } });
  assert.equal(noRate?.annualRate, undefined);
});

test('an annual subscriber is measured at a twelfth of what they pay a year', () => {
  const annual = subscriptionFromCloudRow({ ...activePro, billing_period: 'annual', payload: { annualRate: 290 } });
  assert.ok(annual);
  assert.deepEqual(paybackPlan(annual), { tier: 'Professional', monthlyRate: 24.17, paying: true });

  const monthly = subscriptionFromCloudRow({ ...activePro, billing_period: 'monthly', payload: { annualRate: 290 } });
  assert.ok(monthly);
  assert.equal(paybackPlan(monthly).monthlyRate, 29, 'a monthly subscriber pays the monthly rate');
});

test('the billing screen opens on the cadence already paid and names it at checkout', async () => {
  const screen = await readFile('src/routes/Subscriptions.tsx', 'utf8');
  assert.match(screen, /useState<'monthly' \| 'annual'>\(subscription\.billingPeriod \?\? 'monthly'\)/);
  assert.match(
    screen,
    /<span>Billing<\/span>\s*<strong>\{billingPeriod === 'annual' \? 'Annual' : 'Monthly'\}<\/strong>/,
  );
  assert.doesNotMatch(screen, /<strong>Monthly<\/strong>/, 'no hardcoded cadence');

  // Both reads of the subscription row carry the column the mapper prefers.
  const cloud = await readFile('src/lib/cloudWorkspace.ts', 'utf8');
  const selects = cloud.match(/\.from\('workspace_subscription_profiles'\)\s*\.select\('([^']*)'\)/g) ?? [];
  assert.equal(selects.length, 2);
  for (const select of selects) assert.match(select, /billing_period/);
});
