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
  const sql = readFileSync(path.join(migrationsDir, '20260821_reconcile_legacy_manual_billing.sql'), 'utf8');

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

test('every migration has a unique version prefix', () => {
  // Supabase takes the digits before the first underscore as the migration
  // version, so two files sharing a prefix are two migrations claiming one
  // version and `supabase db push` has nothing to order them by. The three
  // added here were all 20260820, which would have failed the documented apply
  // path before any of them ran.
  const versions = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => file.split('_')[0]);

  const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);
  assert.deepEqual(duplicates, [], `these migration versions are claimed more than once: ${duplicates.join(', ')}`);
  assert.ok(
    versions.every((version) => /^\d{8,14}$/.test(version)),
    'a migration version must be a timestamp Supabase can order',
  );
});

test('the reconciliation runs after the helper fix and before the grants', () => {
  // Ordering is behavioural, not cosmetic: reconciling before the helpers
  // understand 'Inactive' would downgrade the billing state without changing
  // what the triggers enforce.
  const applied = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const order = [
    '20260820_entitlement_helpers_honor_inactive.sql',
    '20260821_reconcile_legacy_manual_billing.sql',
    '20260822_restrict_anon_rpc_surface.sql',
  ].map((file) => applied.indexOf(file));

  assert.ok(
    order.every((position) => position !== -1),
    'all three migrations should be present under their documented names',
  );
  // Schema, then the data it enables, then the grants. Reconciling before the
  // helpers understand 'Inactive' would change the billing state without
  // changing what the triggers enforce.
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'the three must apply in the documented order',
  );
});

/*
 * The data reconciliation must not run just because a migration was applied.
 *
 * `supabase db push` applies every pending migration in one command, so a data
 * change that needs review cannot depend on the operator stopping in the
 * middle. And the predicate it uses — a populated stripe_subscription_id —
 * proves the workspace was billed through Stripe at some point, not that its
 * current 'Manual Billing' value came from the old mapper. An operator who
 * deliberately moved a paying customer to manual invoicing leaves the same
 * trace, and reconciling it would revoke entitlements they granted on purpose.
 *
 * So the UPDATE is gated on a session setting the operator has to set by hand,
 * with an exclusion list for the rows the dry-run shows are deliberate.
 * Verified on PostgreSQL 16: applied with no setting it reports
 * "reconciliation SKIPPED" and changes nothing; with the setting it reconciles
 * the Stripe-backed row and leaves an excluded one untouched; a malformed uuid
 * in the exclusion list aborts before any row is written.
 */
test('the reconciliation is inert unless an operator confirms it', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260821_reconcile_legacy_manual_billing.sql'), 'utf8');

  assert.match(sql, /current_setting\('xbar\.reconcile_confirmed', true\)/);
  assert.match(sql, /reconciliation SKIPPED/);

  // The guard must return before the UPDATE, not merely warn beside it.
  const guard = sql.indexOf("if confirmed <> 'yes' then");
  const update = sql.indexOf('update public.workspace_subscription_profiles');
  assert.ok(guard !== -1 && guard < update, 'the confirmation check must precede the update');

  // An exclusion list, applied inside the same statement.
  assert.match(sql, /current_setting\('xbar\.reconcile_exclude', true\)/);
  assert.match(sql, /not \(p\.workspace_id = any\(excluded\)\)/);

  // Cast rather than filtered: a typo'd exclusion must fail loudly, not
  // silently drop the row it was meant to protect.
  assert.match(sql, /trim\(value\)::uuid/);
});

/*
 * Every instruction that hands the operator a `set` must use the session form.
 *
 * `set local` is scoped to a transaction block. Both documented paths issue
 * these settings BEFORE the migration's own `begin` — the README passes them
 * with `psql -c`, and the in-file instruction is pasted above the file — where
 * PostgreSQL answers `WARNING: SET LOCAL can only be used in transaction
 * blocks` and applies nothing. The migration then reads an empty setting and
 * prints "reconciliation SKIPPED" while the operator believes they confirmed
 * it. Verified against PostgreSQL 16.
 *
 * Asserted by shape across the whole file and the README rather than at the
 * lines that were wrong: the instruction appeared in three places (a comment
 * block, a runtime `raise notice`, and the runbook) and fixing one is exactly
 * how the other two survived.
 */
test('no reconciliation instruction tells the operator to use set local', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260821_reconcile_legacy_manual_billing.sql'), 'utf8');
  const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

  // Prose may discuss `set local` to explain why it is wrong. An instruction
  // is the form that actually sets one of these two variables.
  const badInstruction = /set\s+local\s+xbar\.reconcile_(confirmed|exclude)/i;
  assert.ok(!badInstruction.test(sql), 'the migration must not instruct `set local`');
  assert.ok(!badInstruction.test(readme), 'the README must not instruct `set local`');

  // And the working form is present in both, including the runtime notice the
  // operator reads when the migration skips.
  assert.match(sql, /raise notice 'xbar: {3}set xbar\.reconcile_confirmed/);
  assert.match(readme, /set xbar\.reconcile_confirmed = 'yes'/);
});

/*
 * The post-apply check must agree with the exclusion list it just honored.
 *
 * An excluded row is by definition a Stripe-backed workspace left on
 * `Manual Billing` — that is what excluding it did. An earlier version of this
 * note told the operator that no surviving row should carry a
 * stripe_subscription_id, which declared the intended outcome invalid and
 * pointed them at revoking the grant they had deliberately kept.
 */
test('the post-apply check classifies excluded rows as preserved, not as errors', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260821_reconcile_legacy_manual_billing.sql'), 'utf8');
  const after = sql.slice(sql.indexOf('-- AFTER APPLYING\n-- --------------'));
  assert.ok(after.length > 0, 'the AFTER APPLYING section must exist');

  // It reads the same setting the UPDATE honored, so a preserved row is
  // recognisable rather than indistinguishable from a missed one.
  assert.match(after, /current_setting\('xbar\.reconcile_exclude', true\)/);
  assert.match(after, /preserved on purpose/);

  // Only a Stripe-backed, non-excluded row is a problem.
  assert.match(after, /UNEXPECTED/);

  // The retracted instruction must not come back in any form.
  assert.ok(
    !/None should carry a stripe_subscription_id/i.test(after),
    'an excluded row is supposed to keep its stripe_subscription_id',
  );

  // The setting does not survive a new psql invocation, so the check has to say
  // to restate it; without that it reports every preserved row as UNEXPECTED.
  assert.match(after, /restate/i);
});

test('the runbook does not tell an operator to push all three at once', async () => {
  const readme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');

  // `supabase db push` may be named — it is named to warn against it — but not
  // as the command to run, which would apply the data migration unreviewed.
  assert.match(readme, /one at a time/);
  assert.match(readme, /xbar\.reconcile_confirmed/);
  assert.match(readme, /xbar\.reconcile_exclude/);
});

/*
 * Reconciling a legacy row must say whether Stripe can still bill it.
 *
 * The migration moves a row to 'Inactive', which answers what it is ENTITLED
 * to. It does not answer whether a subscription is still live, and those come
 * apart exactly here: the old mapper sent `canceled` (over) and `paused` /
 * `incomplete` (resumable) to the same 'Manual Billing' value, so the stored
 * data cannot tell them apart and workspace_billing_customers has no status
 * column to consult.
 *
 * Subscriptions.tsx reads an absent `subscriptionRecoverable` as "no live
 * subscription" and enables checkout, so writing 'Inactive' without the field
 * would offer a second subscription to a workspace whose paused one is about
 * to resume — the duplicate billing the client-side guard was just added to
 * prevent, reintroduced through the database.
 *
 * Verified on PostgreSQL 16: a reconciled row is written recoverable, a
 * workspace listed in xbar.reconcile_terminal is written not-recoverable, and
 * an excluded row is not touched at all.
 */
test('reconciliation records whether Stripe can still bill the workspace', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260821_reconcile_legacy_manual_billing.sql'), 'utf8');

  // The field is written, in the same statement that writes billingState —
  // not left to a webhook that a canceled subscription may never send.
  assert.match(sql, /\{subscriptionRecoverable\}/);

  const update = sql.indexOf('update public.workspace_subscription_profiles');
  const recoverable = sql.indexOf('{subscriptionRecoverable}');
  const billingState = sql.indexOf('{billingState}', update);
  assert.ok(update !== -1 && recoverable > update, 'the field must be written by the update itself');
  assert.ok(billingState > update, 'both payload fields are written together');

  // Defaults to recoverable. The operator opts a workspace OUT by confirming
  // in Stripe that it is over — the reverse default would silently enable
  // checkout on a live subscription.
  assert.match(sql, /to_jsonb\(not \(p\.workspace_id = any\(terminal\)\)\)/);

  // Parsed like the exclusion list, with the same loud failure on a typo: a
  // mistyped id must not quietly flip a workspace to purchasable.
  assert.match(sql, /current_setting\('xbar\.reconcile_terminal', true\)/);
  const terminalParse = sql.slice(sql.indexOf('terminal := coalesce'));
  assert.match(terminalParse.slice(0, 300), /trim\(value\)::uuid/);
});

test('the operator is told about the terminal list wherever the others are named', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260821_reconcile_legacy_manual_billing.sql'), 'utf8');

  // In the runtime notice, not only in a comment block. The notice is what an
  // operator actually reads when the migration skips, and a setting that is
  // only documented in a header is a setting nobody sets.
  assert.match(sql, /raise notice 'xbar: {3}set xbar\.reconcile_terminal/);

  // And reset alongside the others, so it cannot colour a later run.
  assert.match(sql, /reset xbar\.reconcile_terminal;/);
});

/*
 * The runbook's shortlist query must match what the webhook actually stores.
 *
 * api/stripe/webhook.js stores `event.data.object` — the subscription itself —
 * not the enclosing Stripe event. A query reaching for `{data,object,status}`
 * therefore returns null for every row, the shortlist comes back empty, and an
 * operator has no way to identify which subscriptions are terminal. Reconciled
 * rows default to recoverable, and a canceled subscription sends no further
 * webhook to correct that, so those customers stay blocked from buying
 * indefinitely. Verified against PostgreSQL 16 with a payload of the shape the
 * webhook writes.
 */
test('the terminal-status shortlist reads the payload shape the webhook writes', () => {
  const sql = readFileSync(path.join(migrationsDir, '20260821_reconcile_legacy_manual_billing.sql'), 'utf8');
  const webhook = readFileSync(path.join(repoRoot, 'api/stripe/webhook.js'), 'utf8');

  // The premise, asserted rather than assumed: the row stores the subscription
  // object. If this ever changes, this test should be what notices.
  assert.match(webhook, /const payload = event\.data\.object;/);

  assert.match(sql, /payload ->> 'status'/, 'status is at the top level of the stored payload');
  assert.ok(
    !sql.includes("payload #>> '{data,object,status}'"),
    'that path returns null for every row the webhook writes',
  );
});
