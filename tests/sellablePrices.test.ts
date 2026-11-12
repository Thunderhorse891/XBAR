import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { loadSellablePrices } from '../src/lib/billingApi.js';

/*
 * Production offered annual billing with no annual price set (2026-10-02):
 * the toggle keyed off "managed billing is on", and a buyer who chose annual
 * was refused at the moment of paying. The billing screen now offers a cadence
 * only when the server confirms it can sell it, and anything short of a clear
 * answer offers monthly alone.
 */

type FetchStub = (input: unknown, init?: unknown) => Promise<Response>;

async function withFetch<T>(stub: FetchStub, action: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub as typeof fetch;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

test('a clear server answer is read as given', async () => {
  const prices = await withFetch(
    () =>
      json({
        ok: true,
        managed: true,
        sellable: { monthly: { Starter: true, Professional: true }, annual: { Starter: false, Professional: true } },
      }),
    loadSellablePrices,
  );
  assert.deepEqual(prices, {
    managed: true,
    monthly: { Starter: true, Professional: true },
    annual: { Starter: false, Professional: true },
  });
});

test('anything short of a clear answer offers nothing beyond monthly', async () => {
  const failures: FetchStub[] = [
    () => Promise.reject(new TypeError('Failed to fetch')),
    () => json({ ok: false, message: 'Method not allowed.' }, 405),
    () => Promise.resolve(new Response('<html>gateway</html>', { status: 200 })),
    () => json({ ok: true, managed: true }),
    () => json({ ok: true, managed: true, sellable: { monthly: {}, annual: 'yes' } }),
  ];
  for (const stub of failures) {
    assert.equal(await withFetch(stub, loadSellablePrices), null);
  }
  // Only a literal true sells a cadence.
  const loose = await withFetch(
    () => json({ ok: true, managed: 'true', sellable: { monthly: { Starter: 1 }, annual: { Starter: 'true' } } }),
    loadSellablePrices,
  );
  assert.deepEqual(loose, { managed: false, monthly: { Starter: false }, annual: { Starter: false } });
});

test('the billing screen never sells new annual subscriptions, even with legacy catalog mappings', async () => {
  const screen = await readFile('src/routes/Subscriptions.tsx', 'utf8');
  assert.match(screen, /const billingPeriod: 'monthly' \| 'annual' = 'monthly';/);
  assert.doesNotMatch(screen, /annualAvailable|annualManaged|setBillingPeriod|checkout-billing-toggle/);
  assert.match(screen, /subscription.billingPeriod === 'annual'/, 'existing annual accounts retain accurate cadence');
  const client = await readFile('src/lib/billingApi.ts', 'utf8');
  assert.match(client, /!isPublicPaidPlan\(params.tier\) \|\| params.billingPeriod === 'annual'/);
});
