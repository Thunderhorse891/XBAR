import assert from 'node:assert/strict';
import test from 'node:test';
import { startManagedCheckout, requestTrialStart, canUsePaymentLinkFallback } from '../src/lib/billingApi.js';

const identity = { workspaceId: 'workspace-a', accessToken: 'synthetic-token' };
async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

for (const kind of ['checkout', 'trial'] as const) {
  for (const phase of ['headers', 'body'] as const) {
    test(`${kind} recovers from a stalled ${phase} without bypassing billing guards`, async (context) => {
      context.mock.timers.enable({ apis: ['setTimeout'] });
      const originalFetch = globalThis.fetch;
      let signal: AbortSignal | null | undefined;
      globalThis.fetch = (async (_url, init) => {
        signal = init?.signal;
        const stalled = () =>
          new Promise<never>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
          });
        if (phase === 'headers') return stalled();
        return { ok: true, json: stalled } as unknown as Response;
      }) as typeof fetch;
      try {
        let result:
          Awaited<ReturnType<typeof startManagedCheckout>> | Awaited<ReturnType<typeof requestTrialStart>> | undefined;
        const pending =
          kind === 'checkout'
            ? startManagedCheckout({ ...identity, tier: 'Professional' })
            : requestTrialStart(identity);
        void pending.then((value) => {
          result = value;
        });
        await settle();
        context.mock.timers.tick(31_000);
        await settle();
        assert.ok(result, 'the request must settle rather than leave its button busy forever');
        assert.equal(result.ok, false);
        if (!result.ok) {
          assert.equal(result.code, 'request_timeout');
          assert.equal(canUsePaymentLinkFallback(result.code), false);
          assert.doesNotMatch(result.message, /nothing was charged|not changed|could not be started/i);
        }
        assert.equal(signal?.aborted, true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  }
}

test('successful checkout preserves cadence, authentication and response', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFetch = globalThis.fetch;
  let signal: AbortSignal | null | undefined;
  globalThis.fetch = (async (_url, init) => {
    signal = init?.signal;
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer synthetic-token');
    assert.equal(JSON.parse(init?.body as string).billingPeriod, 'annual');
    return new Response(JSON.stringify({ ok: true, url: 'https://checkout.stripe.com/c/pay/test' }));
  }) as typeof fetch;
  try {
    assert.deepEqual(await startManagedCheckout({ ...identity, tier: 'Professional', billingPeriod: 'annual' }), {
      ok: true,
      url: 'https://checkout.stripe.com/c/pay/test',
    });
    context.mock.timers.tick(31_000);
    assert.equal(signal?.aborted, false, 'successful requests must dispose their deadline');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
