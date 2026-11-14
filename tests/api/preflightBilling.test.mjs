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

const STORAGE_VARS = {
  SUPABASE_URL: 'https://synthetic.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-secret',
  SUPABASE_STORAGE_S3_REGION: 'synthetic-region',
  SUPABASE_STORAGE_S3_ACCESS_KEY_ID: 'synthetic-access-secret',
  SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY: 'synthetic-storage-secret',
};

test('preflight reports missing controlled upload prerequisites without exposing credentials', () => {
  for (const name of Object.keys(STORAGE_VARS)) {
    const output = runPreflight({ ...STORAGE_VARS, [name]: '' });
    assert.ok(output.includes('Controlled original-file uploads — NOT CONFIGURED'), name);
    assert.ok(output.includes(`✗ missing  ${name}`), name);
    for (const secret of ['synthetic-service-secret', 'synthetic-access-secret', 'synthetic-storage-secret']) {
      assert.ok(!output.includes(secret));
    }
  }
});

test('configured storage remains explicitly unverified and requires hosted recovery checks', () => {
  const output = runPreflight(STORAGE_VARS);
  assert.ok(output.includes('Controlled original-file uploads — CONFIGURED (UNVERIFIED)'));
  assert.ok(
    output.includes(
      'provider limits, CORS, migrations, old upload-capability draining and interrupted-upload recovery remain unverified',
    ),
  );
});
