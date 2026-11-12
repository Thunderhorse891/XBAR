import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = process.cwd();

// New sales require only the two public monthly prices. Legacy IDs remain optional.

const MONTHLY_VARS = {
  STRIPE_SECRET_KEY: 'sk_test_preflight',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_preflight',
  STRIPE_PRICE_ID_STARTER: 'price_starter_monthly',
  STRIPE_PRICE_ID_PROFESSIONAL: 'price_pro_monthly',
  STRIPE_PRICE_ID_RANCH_OPS: 'price_ranchops_monthly',
  STRIPE_PRICE_ID_ENTERPRISE: 'price_ent_monthly',
};

const ANNUAL_VARS = {
  STRIPE_PRICE_ID_STARTER_ANNUAL: 'price_starter_annual',
  STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL: 'price_pro_annual',
  STRIPE_PRICE_ID_RANCH_OPS_ANNUAL: 'price_ranchops_annual',
  STRIPE_PRICE_ID_ENTERPRISE_ANNUAL: 'price_ent_annual',
};

const ANNUAL_NAMES = Object.keys(ANNUAL_VARS);

function runPreflight(env) {
  return execFileSync('node', [path.join('scripts', 'preflight.mjs')], {
    encoding: 'utf8',
    cwd: repoRoot,
    env: { PATH: process.env.PATH, ...env },
  });
}

test('public monthly catalog is configured without retired or annual IDs', () => {
  const output = runPreflight({ ...MONTHLY_VARS, STRIPE_PRICE_ID_STARTER: '', STRIPE_PRICE_ID_ENTERPRISE: '' });
  assert.ok(output.includes('Online billing (Stripe) — CONFIGURED (UNVERIFIED)'));
  assert.ok(output.includes('New annual checkout is disabled'));
  for (const name of ANNUAL_NAMES) assert.ok(output.includes(`○ unset  ${name}`));
});

test('each missing public monthly price blocks configuration', () => {
  for (const name of ['STRIPE_PRICE_ID_PROFESSIONAL', 'STRIPE_PRICE_ID_RANCH_OPS']) {
    const output = runPreflight({ ...MONTHLY_VARS, ...ANNUAL_VARS, [name]: '' });
    assert.ok(output.includes('Online billing (Stripe) — NOT CONFIGURED'));
    assert.ok(output.includes(`✗ missing  ${name}`));
  }
});

test('historical annual and retired prices remain reported as optional recognition configuration', () => {
  const output = runPreflight({ ...MONTHLY_VARS, ...ANNUAL_VARS });
  assert.ok(output.includes('Online billing (Stripe) — CONFIGURED (UNVERIFIED)'));
  for (const name of ANNUAL_NAMES) assert.ok(output.includes(`✓ set  ${name}`));
  assert.ok(output.includes('legacy annual subscriber recognition only'));
});
