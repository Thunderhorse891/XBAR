import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';

// A scrubbed synthetic environment proves neither production config nor Stripe I/O.
const REQUIRED = {
  STRIPE_SECRET_KEY: 'sk_test_preflight',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_preflight',
  STRIPE_ACCOUNT_ID: 'acct_preflight',
  STRIPE_PRICE_ID_PROFESSIONAL: 'price_pro_monthly',
  STRIPE_PRICE_ID_RANCH_OPS: 'price_ranchops_monthly',
};

function runPreflight(env) {
  return execFileSync('node', ['scripts/preflight.mjs'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
}

test('monthly launch checkout needs only the two approved new-sale prices and account pin', () => {
  const output = runPreflight(REQUIRED);
  assert.match(output, /Online billing \(Stripe\) — CONFIGURED \(UNVERIFIED\)/);
  assert.doesNotMatch(output, /missing\s+STRIPE_PRICE_ID_.*_ANNUAL/);
  assert.match(output, /unset\s+STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL/);
  for (const value of Object.values(REQUIRED)) assert.ok(!output.includes(value));
});

test('missing monthly prices or a missing account pin block reported configuration', () => {
  for (const name of ['STRIPE_ACCOUNT_ID', 'STRIPE_PRICE_ID_PROFESSIONAL', 'STRIPE_PRICE_ID_RANCH_OPS']) {
    const env = { ...REQUIRED };
    delete env[name];
    const output = runPreflight(env);
    assert.match(output, /Online billing \(Stripe\) — NOT CONFIGURED/);
    assert.ok(output.includes(`✗ missing  ${name}`));
  }
});
