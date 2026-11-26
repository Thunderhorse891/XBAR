import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectStripeSandbox } from '../../scripts/stripe-sandbox-preflight.mjs';

const pairs = [
  { name: 'STRIPE_PRICE_ID_PROFESSIONAL', id: 'price_fixture_PROFESSIONAL', amount: 1999, interval: 'month' },
  { name: 'STRIPE_PRICE_ID_RANCH_OPS', id: 'price_fixture_RANCH_OPS', amount: 4999, interval: 'month' },
];

const fixture = (overrides = {}) => {
  const env = {
    STRIPE_SECRET_KEY: 'rk_test_fixture',
    STRIPE_ACCOUNT_ID: 'acct_fixture',
    ...Object.fromEntries(pairs.map(({ name, id }) => [name, id])),
  };
  const calls = [];
  const stripe = {
    accounts: {
      async retrieve() {
        calls.push('account');
        return { id: 'acct_fixture' };
      },
    },
    prices: {
      async retrieve(id, options) {
        calls.push(id);
        assert.deepEqual(options, { expand: ['product'] });
        const pair = pairs.find((candidate) => candidate.id === id);
        return {
          id,
          active: true,
          livemode: false,
          type: 'recurring',
          currency: 'usd',
          unit_amount: pair.amount,
          billing_scheme: 'per_unit',
          recurring: { interval: pair.interval, interval_count: 1, usage_type: 'licensed' },
          product: { active: true },
          ...overrides[id],
        };
      },
    },
  };
  const createStripe = (secret) => {
    assert.equal(secret, env.STRIPE_SECRET_KEY);
    return stripe;
  };
  return { env, stripe, calls, createStripe };
};

test('sandbox preflight reads the pinned account once and every checkout price', async () => {
  const { env, calls, createStripe } = fixture();
  const result = await inspectStripeSandbox(env, createStripe);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ['account', ...pairs.map(({ id }) => id)]);
  assert.equal(result.checked, 2);
  assert.doesNotMatch(JSON.stringify(result), /fixture/);
});

test('refuses live, production, missing pin, incomplete config, and aliased prices before Stripe I/O', async () => {
  const factory = () => assert.fail('provider should not be used');
  for (const [overrides, reason] of [
    [{ STRIPE_SECRET_KEY: 'sk_live_fixture' }, 'test_key_required'],
    [{ VERCEL_ENV: 'production' }, 'production_environment_refused'],
    [{ STRIPE_ACCOUNT_ID: '' }, 'account_pin_required'],
    [{ STRIPE_PRICE_ID_PROFESSIONAL: 'unexpected' }, 'price_configuration_invalid_or_aliased'],
    [{ STRIPE_PRICE_ID_STARTER: 'price_fixture_PROFESSIONAL' }, 'price_configuration_invalid_or_aliased'],
  ]) {
    const { env } = fixture();
    assert.deepEqual(await inspectStripeSandbox({ ...env, ...overrides }, factory), {
      ok: false,
      reason,
      checked: 0,
    });
  }
});

test('stops on wrong account without reading prices and omits provider exception data', async () => {
  const { env, stripe, calls, createStripe } = fixture();
  stripe.accounts.retrieve = async () => ({ id: 'acct_other' });
  assert.deepEqual(await inspectStripeSandbox(env, createStripe), {
    ok: false,
    reason: 'account_mismatch',
    checked: 0,
  });
  stripe.accounts.retrieve = async () => {
    throw new Error('secret exception payload');
  };
  assert.deepEqual(await inspectStripeSandbox(env, createStripe), {
    ok: false,
    reason: 'account_read_failed',
    checked: 0,
  });
  assert.deepEqual(calls, []);
});

test('flags test mode and app-catalog discrepancies, never returning provider price objects', async () => {
  const id = 'price_fixture_PROFESSIONAL';
  for (const change of [{ livemode: true }, { unit_amount: 2900 }, { product: { active: false } }]) {
    const { env, createStripe } = fixture({ [id]: change });
    assert.deepEqual(await inspectStripeSandbox(env, createStripe), {
      ok: false,
      reason: 'price_verification_failed',
      checked: 0,
      pair: 'Professional/monthly',
    });
  }
});
