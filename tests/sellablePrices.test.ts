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

test("the billing screen offers annual only on the server's word, and quotes only what it can sell", async () => {
  const screen = await readFile('src/routes/Subscriptions.tsx', 'utf8');
  // Managed billing being on is no longer enough on its own.
  assert.doesNotMatch(screen, /const annualAvailable = billingEnabled \|\|/);
  assert.match(
    screen,
    /const annualManaged =\s*billingEnabled && Boolean\(sellable\?\.managed && tiers\.some\(\(tier\) => sellable\.annual\[tier\] === true\)\);/,
  );
  // Every price, label and checkout reads the derived cadence.
  assert.match(screen, /const billingPeriod: 'monthly' \| 'annual' = annualAvailable \? chosenPeriod : 'monthly';/);
  assert.match(
    screen,
    /void loadSellablePrices\(\)\.then\(\(prices\) => \{\s*if \(!cancelled\) setSellable\(prices\);/,
  );
});
