import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = process.cwd();

/*
 * The preflight "Online billing (Stripe)" group used to require only the four
 * monthly STRIPE_PRICE_ID_* variables. A deployment with no annual price ids
 * configured — where every annual checkout would refuse at runtime — still
 * reported billing as CONFIGURED. The group must not call billing fully
 * configured while the annual prices are missing.
 *
 * The script is executed as a subprocess with a scrubbed environment so the
 * developer's own shell cannot leak values into the result.
 */

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

test('billing is NOT reported configured when the annual price ids are missing', () => {
  const output = runPreflight(MONTHLY_VARS);

  assert.ok(
    output.includes('Online billing (Stripe) — NOT CONFIGURED'),
    `expected the billing group to be NOT CONFIGURED, got:\n${output}`,
  );

  for (const name of ANNUAL_NAMES) {
    assert.ok(output.includes(`✗ missing  ${name}`), `expected ${name} to be reported missing, got:\n${output}`);
  }
});

test('each missing annual price id is reported individually', () => {
  // One annual id present and three absent must still fail the group: a
  // partially configured annual catalog is not a configured one.
  const output = runPreflight({ ...MONTHLY_VARS, STRIPE_PRICE_ID_STARTER_ANNUAL: 'price_starter_annual' });

  assert.ok(output.includes('Online billing (Stripe) — NOT CONFIGURED'));
  assert.ok(output.includes('✓ set  STRIPE_PRICE_ID_STARTER_ANNUAL'));
  assert.ok(output.includes('✗ missing  STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL'));
});

test('billing IS reported configured when all eight price ids are set', () => {
  const output = runPreflight({ ...MONTHLY_VARS, ...ANNUAL_VARS });

  assert.ok(
    output.includes('Online billing (Stripe) — CONFIGURED (UNVERIFIED)'),
    `expected the billing group to be CONFIGURED, got:\n${output}`,
  );

  for (const name of ANNUAL_NAMES) {
    assert.ok(output.includes(`✓ set  ${name}`), `expected ${name} to be reported set, got:\n${output}`);
  }
});
