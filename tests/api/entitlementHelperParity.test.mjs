import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { BILLING_STATES, BASELINE_TIER, entitledTierForBillingState } from '../../api/_lib/subscription-status.js';

/*
 * The database and the API must agree about who is still paying.
 *
 * api/_lib/subscription-status.js decides what each billing state grants, but
 * it is not what enforces seat, storage, and commercial-resource limits — the
 * triggers do, through xbar_subscription_limits and xbar_commercial_limits. Those
 * two helpers carry their own copy of the rule in SQL, and the copies drifted:
 * the helpers were written when 'Past Due' was the only non-paying state, so
 * they read
 *
 *     case when billing_state = 'Past Due' then 'Starter' else tier end
 *
 * and a workspace stored as 'Inactive' — canceled, paused, unpaid, incomplete,
 * or an unrecognized status — fell into `else tier` and kept its purchased
 * limits in the database while the API reported Starter. The database is the
 * authoritative side, so the API's answer was the one that lost.
 *
 * These tests derive the expected SQL from the JavaScript policy rather than
 * restating it, so adding a billing state on one side and not the other fails
 * here instead of silently granting paid limits to an account that stopped
 * paying.
 */

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');

const HELPERS = ['xbar_subscription_limits', 'xbar_commercial_limits'];

/** The last migration (in apply order) that defines `fn` — the definition that wins. */
function effectiveDefinition(fn) {
  const defining = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .filter((file) => readFileSync(path.join(migrationsDir, file), 'utf8').includes(`function public.${fn}(`));

  assert.ok(defining.length > 0, `no migration defines ${fn}`);

  const winner = defining[defining.length - 1];
  const sql = readFileSync(path.join(migrationsDir, winner), 'utf8');
  // Only the body of this function, so a sibling definition in the same file
  // cannot satisfy an assertion about this one.
  const start = sql.indexOf(`function public.${fn}(`);
  const end = sql.indexOf('$$;', start);
  assert.ok(end > start, `could not isolate the body of ${fn} in ${winner}`);

  return { migration: winner, body: sql.slice(start, end) };
}

/** Billing states the JavaScript policy says keep the purchased tier. */
const retainingStates = BILLING_STATES.filter(
  (state) => entitledTierForBillingState('Enterprise', state) === 'Enterprise',
);

test('the JavaScript policy retains a purchased tier for exactly Active and Manual Billing', () => {
  // Guards the premise of the SQL assertions below: if this set changes, the
  // migration has to change with it, and the next test is what enforces that.
  assert.deepEqual([...retainingStates].sort(), ['Active', 'Manual Billing']);

  for (const state of BILLING_STATES.filter((value) => !retainingStates.includes(value))) {
    assert.equal(
      entitledTierForBillingState('Enterprise', state),
      BASELINE_TIER,
      `${state} should fall back to ${BASELINE_TIER}`,
    );
  }
});

for (const fn of HELPERS) {
  test(`${fn} retains the purchased tier for the same states as the API`, () => {
    const { migration, body } = effectiveDefinition(fn);

    // Written as an allowlist on purpose. Listing what keeps access means a
    // billing state added later falls back to the baseline; the previous form
    // listed what loses access, so anything new inherited paid limits.
    const expected = `billing_state in (${retainingStates.map((state) => `'${state}'`).join(', ')})`;
    assert.ok(
      body.includes(expected),
      `${fn} (defined in ${migration}) should gate on \`${expected}\`, matching entitledTierForBillingState`,
    );

    assert.match(body, /else 'Starter'/, `${fn} should fall back to Starter for every other billing state`);
  });

  test(`${fn} no longer downgrades only Past Due`, () => {
    const { migration, body } = effectiveDefinition(fn);

    // The exact shape of the bug: 'Inactive' fell into `else tier`.
    assert.doesNotMatch(
      body,
      /when billing_state = 'Past Due' then 'Starter' else tier end/,
      `${fn} (defined in ${migration}) still treats Past Due as the only non-paying state`,
    );
  });
}

test('the corrective migration is not presented as already applied', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260820_entitlement_helpers_honor_inactive.sql'), 'utf8');
  assert.match(sql, /NOT YET APPLIED/);
  // create-or-replace with unchanged signatures is what makes a re-run harmless.
  assert.equal((sql.match(/create or replace function/g) ?? []).length, HELPERS.length);
  assert.doesNotMatch(sql, /drop function/i);
  assert.doesNotMatch(sql, /drop trigger/i);
});
