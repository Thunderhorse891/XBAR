import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/*
 * The trial policy exists twice: src/lib/trialSubscription.ts (client gates)
 * and api/_lib/trial-status.js (server enforcement). Two copies of an
 * entitlement rule that disagree is worse than either being wrong, so the
 * constants and the record shape are pinned together here.
 */

const client = readFileSync('src/lib/trialSubscription.ts', 'utf8');
const server = readFileSync('api/_lib/trial-status.js', 'utf8');

function constant(source, name) {
  const match = source.match(new RegExp(`${name}[^=\\n]*=\\s*['"]?([\\w]+)['"]?`));
  assert.ok(match, `${name} not found`);
  return match[1];
}

test('client and server agree on the trial plan', () => {
  assert.equal(constant(client, 'TRIAL_PLAN_TIER'), 'Professional');
  assert.equal(constant(server, 'TRIAL_PLAN_TIER'), 'Professional');
});

test('client and server agree on the trial length', () => {
  assert.equal(constant(client, 'TRIAL_LENGTH_DAYS'), '14');
  assert.equal(constant(server, 'TRIAL_LENGTH_DAYS'), '14');
});

test('client and server read the trial from the same record shape', () => {
  for (const source of [client, server]) {
    assert.match(source, /trialStart|trial\.startedAt/, 'trial start field');
    assert.match(source, /trialEndDate|trial\.endsAt/, 'trial end field');
  }
  // The window is half-open on both sides: active from the start instant,
  // expired at the end instant.
  assert.match(client, /nowMs < trialEndDate\(start\)\.getTime\(\)/);
  assert.match(server, /now < trial\.endsAt\.getTime\(\)/);
});

/*
 * The database triggers enforce limits too, through xbar_subscription_limits
 * and xbar_commercial_limits — the client writes horses and documents straight
 * through RLS, so a trial the SQL helpers ignore would pass every gate and
 * then be refused by the trigger. The winning migration (the last one that
 * defines each helper) must carry the same trial rule.
 */
test('the effective SQL helpers honor an active trial as Professional', () => {
  const migrationsDir = path.join(process.cwd(), 'supabase', 'migrations');

  for (const fn of ['xbar_subscription_limits', 'xbar_commercial_limits']) {
    const defining = readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .filter((file) => readFileSync(path.join(migrationsDir, file), 'utf8').includes(`function public.${fn}(`));
    assert.ok(defining.length > 0, `no migration defines ${fn}`);
    const winner = defining[defining.length - 1];
    const sql = readFileSync(path.join(migrationsDir, winner), 'utf8');
    const start = sql.indexOf(`function public.${fn}(`);
    const body = sql.slice(start, sql.indexOf('$$;', start));

    assert.match(
      body,
      /when public\.xbar_trial_active\(payload\) then 'Professional'/,
      `${fn} (${winner}) does not grant Professional for an active trial`,
    );
    // The billing-state allowlist still wins over the trial, and everything
    // else still falls to Starter — the trial only ever raises the baseline.
    assert.match(body, /billing_state in \('Active', 'Manual Billing'\)/);
    assert.match(body, /else 'Starter'/);
  }
});
