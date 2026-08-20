import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import {
  BILLING_STATES,
  BASELINE_TIER,
  ENTITLED_STRIPE_STATUSES,
  INACTIVE_STRIPE_STATUSES,
  PAST_DUE_STRIPE_STATUSES,
  billingStateForStripeStatus,
  entitledTierForBillingState,
} from '../../api/_lib/subscription-status.js';

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

/*
 * The schema fix alone leaves existing deployments unchanged.
 *
 * The mapper this branch replaces ended with `return 'Manual Billing'`, so
 * canceled, paused, incomplete and unrecognized statuses are already stored as
 * an entitled state. The helper migration correctly keeps 'Manual Billing'
 * entitled — it is a deliberate operator grant — so those rows keep full paid
 * limits until some later webhook updates them, and a canceled workspace may
 * never receive another webhook at all.
 */

test('no Stripe status can produce Manual Billing, which is what makes the reconciliation one-time', () => {
  const statuses = [
    ...ENTITLED_STRIPE_STATUSES,
    ...PAST_DUE_STRIPE_STATUSES,
    ...INACTIVE_STRIPE_STATUSES,
    'some_future_status',
    '',
    null,
    undefined,
  ];

  for (const status of statuses) {
    assert.notEqual(
      billingStateForStripeStatus(status),
      'Manual Billing',
      `${String(status)} must not be able to recreate the state the reconciliation clears`,
    );
  }
});

test('the legacy reconciliation is documented as a reviewed, data-changing step', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260820_reconcile_legacy_manual_billing.sql'), 'utf8');

  assert.match(sql, /NOT YET APPLIED/);
  assert.match(sql, /DRY RUN/, 'a migration that changes entitlements for real workspaces needs a dry run');

  // It moves the mislabelled rows to the state the current mapper would give
  // them, and leaves the purchased tier alone so nothing is lost.
  assert.match(sql, /set billing_state = 'Inactive'/);
  assert.match(sql, /p\.billing_state = 'Manual Billing'/);
  assert.doesNotMatch(sql, /set\s+tier\s*=/, 'the purchased tier must survive the reconciliation');
  assert.doesNotMatch(sql, /delete from/i);

  // Only demonstrably Stripe-backed rows. A Manual Billing profile with no
  // Stripe subscription behind it was created deliberately — by hand or by an
  // invoicing arrangement — and the comp allowlist is not a substitute for it,
  // because the database limit triggers never see the allowlist.
  assert.match(
    sql,
    /stripe_subscription_id, ''\) <> ''/,
    'the reconciliation must not downgrade manual accounts that Stripe never created',
  );

  // The client gates on the payload, not on the column, so the payload's
  // billing state has to move with it or the UI keeps granting the paid tier.
  assert.match(sql, /jsonb_set\(/);
  assert.match(sql, /'\{billingState\}'/);
});

test('the reconciliation runs after the helper fix and before the grants', () => {
  // Ordering is behavioural, not cosmetic: reconciling before the helpers
  // understand 'Inactive' would downgrade the billing state without changing
  // what the triggers enforce.
  const applied = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  assert.ok(
    applied.indexOf('20260820_entitlement_helpers_honor_inactive.sql') <
      applied.indexOf('20260820_reconcile_legacy_manual_billing.sql'),
    'the helper fix must apply before the data reconciliation',
  );
});
