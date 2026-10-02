import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';
import { marketingPlans } from '../../scripts/marketing/pricing-data.mjs';

/*
 * The same tiers are defined in three places that cannot import one another:
 *
 *   src/lib/xbarRuntime.ts          the app (TypeScript, bundler-resolved)
 *   scripts/marketing/pricing-data  the public /pricing page (plain ESM)
 *   api/_lib/subscription-plans.js  server-side enforcement (plain ESM)
 *
 * tests/marketingSite.test.ts already pins the app against marketing. Nothing
 * pinned the server copy, which is the one that decides what a paying customer
 * can actually do — so a price or a limit could have been changed in two places
 * and quietly left wrong in the third, and the visible symptom would be a
 * customer billed for one thing and given another.
 *
 * The app's config is read as text rather than imported: xbarRuntime.ts uses
 * .js-suffixed TypeScript imports that Node cannot resolve outside the bundler,
 * which is the same reason the marketing data is a hand-maintained mirror.
 */

const repoRoot = process.cwd();

function appTierConfigSource() {
  return readFileSync(path.join(repoRoot, 'src/lib/xbarRuntime.ts'), 'utf8');
}

const marketingByTier = Object.fromEntries(marketingPlans.map((plan) => [plan.tier, plan]));
const TIERS = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

test('all three sources define exactly the same tiers', () => {
  assert.deepEqual(Object.keys(subscriptionPlans), TIERS);
  assert.deepEqual(
    marketingPlans.map((plan) => plan.tier),
    TIERS,
  );

  const source = appTierConfigSource();
  for (const tier of TIERS) {
    const key = tier.includes(' ') ? `'${tier}'` : tier;
    assert.ok(source.includes(`${key}: {`), `${tier} is missing from the app tier config`);
  }
});

for (const tier of TIERS) {
  test(`${tier}: server price and limits match the published ones`, () => {
    const server = subscriptionPlans[tier];
    const marketing = marketingByTier[tier];

    assert.equal(
      server.monthlyRate,
      marketing.monthlyRate,
      `${tier} is billed at ${server.monthlyRate} but advertised at ${marketing.monthlyRate}`,
    );
    assert.equal(
      server.annualRate,
      marketing.annualRate,
      `${tier} annual is billed at ${server.annualRate} but advertised at ${marketing.annualRate}`,
    );

    // deepEqual both ways: a limit present on one side and absent on the other
    // is drift too, not just a differing number.
    assert.deepEqual(server.limits, marketing.limits, `${tier} server limits differ from the ones on the pricing page`);
  });

  test(`${tier}: the numbers in the feature copy match the enforced limits`, () => {
    // Not string equality. The three feature lists are marketing prose and are
    // worded differently on purpose ("Proof vault" vs "Documents"), so
    // requiring them to be byte-identical would force churn without protecting
    // anything.
    //
    // What must not drift is the numbers inside that prose. A plan advertising
    // "1,000 documents" while the server enforces 500 is a promise the product
    // breaks the moment a customer relies on it, and it reads as correct in
    // every file taken on its own.
    const { limits, featureFlags } = subscriptionPlans[tier];
    const sources = {
      server: featureFlags.join(' '),
      marketing: marketingByTier[tier].features.join(' '),
    };

    const advertised = [
      [limits.documentLimit, 'document limit'],
      [limits.storageLimitGb, 'storage limit'],
      [limits.seatLimit, 'team seat limit'],
    ];

    for (const [where, copy] of Object.entries(sources)) {
      for (const [value, label] of advertised) {
        // Both plain and comma-grouped, since the copy writes 1,000 not 1000.
        const plain = String(value);
        const grouped = value.toLocaleString('en-US');
        assert.ok(
          copy.includes(plain) || copy.includes(grouped),
          `${tier} ${where} copy never mentions its ${label} of ${grouped}: ${copy}`,
        );
      }
    }
  });
}

test('every limit the server enforces is a positive number', () => {
  // A missing or zero limit silently becomes "nothing is allowed" or, worse,
  // reads as falsy in a comparison and stops applying.
  for (const tier of TIERS) {
    for (const [name, value] of Object.entries(subscriptionPlans[tier].limits)) {
      assert.equal(typeof value, 'number', `${tier}.${name} is not a number`);
      assert.ok(Number.isFinite(value), `${tier}.${name} is not finite`);

      // sharedAccessSeatLimit is deliberately 0 on Starter: that tier includes
      // no Horse Owner / Client accounts at all.
      if (!(tier === 'Starter' && name === 'sharedAccessSeatLimit')) {
        assert.ok(value > 0, `${tier}.${name} is ${value}`);
      }
    }
  }
});

test('limits never decrease as tiers get more expensive', () => {
  // A cheaper plan that grants more of something is a pricing bug, and it is
  // the kind that survives review because each tier looks fine on its own.
  const limitNames = Object.keys(subscriptionPlans.Starter.limits);

  for (let index = 1; index < TIERS.length; index += 1) {
    const lower = subscriptionPlans[TIERS[index - 1]];
    const higher = subscriptionPlans[TIERS[index]];

    assert.ok(higher.monthlyRate > lower.monthlyRate, `${TIERS[index]} is not priced above ${TIERS[index - 1]}`);

    for (const name of limitNames) {
      assert.ok(
        higher.limits[name] >= lower.limits[name],
        `${TIERS[index]} grants less ${name} (${higher.limits[name]}) than ${TIERS[index - 1]} (${lower.limits[name]})`,
      );
    }
  }
});

test('the server carries no entitlement field that nothing enforces', () => {
  // brandedListings lived here, was copied into every stored subscription
  // profile, and was read by nothing in src/ or api/. A field like that reads
  // as a capability the plan grants while gating nothing at all.
  //
  // Anything added to a plan definition should either be enforced somewhere or
  // not be here; this asserts the specific one that was removed stays removed.
  const serverSource = readFileSync(path.join(repoRoot, 'api/_lib/subscription-plans.js'), 'utf8');
  assert.doesNotMatch(serverSource, /brandedListings/);

  for (const tier of TIERS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(subscriptionPlans[tier], 'brandedListings'),
      false,
      `${tier} still carries brandedListings`,
    );
  }
});

test('plans are not sold as buyer seats, which no limit actually counts', () => {
  // sharedAccessSeatLimit caps Horse Owner / Client accounts, enforced by the
  // xbar_enforce_workspace_seat_limits trigger and mirrored in
  // src/lib/workspaceAccess.ts. Buyers open a share link with no account, so
  // nothing limits how many of them view a listing — advertising "buyer seats"
  // described a restriction that does not exist while hiding the one that does.
  // scripts/marketing/pages.mjs is in this list because leaving it out is how
  // the phrase survived: the three DATA files were cleaned and the template
  // that RENDERS the public pricing table still headed that column "Buyer
  // seats". The wrong label was live on /pricing while every test here passed.
  const sources = [
    'api/_lib/subscription-plans.js',
    'src/lib/xbarRuntime.ts',
    'scripts/marketing/pricing-data.mjs',
    'scripts/marketing/pages.mjs',
  ];

  for (const file of sources) {
    const contents = readFileSync(path.join(repoRoot, file), 'utf8');
    assert.doesNotMatch(contents, /buyer seats/i, `${file} still advertises buyer seats`);
  }
});

/*
 * Audit F05: the last reserved seat on a plan could not be accepted.
 *
 * Accepting an invitation inserts the active membership while that invitation
 * is still pending, and the membership check counted every pending invitation
 * -- the reservation AND the seat it reserved. 4 members + 1 reservation on a
 * 5-seat plan evaluated 4 + 1 + 1 and refused the invited fifth person.
 * supabase/checks/seat-reservation.sql proves the behaviour against the real
 * database; this pins the two lines it depends on in both copies of the
 * function, so a schema rewrite cannot quietly put the double count back.
 */
test('accepting a reserved seat consumes the reservation instead of counting it twice', () => {
  const migration = readFileSync(
    path.join(repoRoot, 'supabase/migrations/20261002090000_seat_reservation_consumed_on_accept.sql'),
    'utf8',
  );
  const schema = readFileSync(path.join(repoRoot, 'supabase/production-schema.sql'), 'utf8');
  const functionOf = (source) => {
    const start = source.indexOf('create or replace function public.xbar_enforce_workspace_seat_limits()');
    assert.ok(start > -1, 'the seat function must be defined');
    return source.slice(start, source.indexOf('$$;', start) + 3);
  };

  const fromMigration = functionOf(migration);
  assert.equal(functionOf(schema), fromMigration, 'production-schema.sql must carry the migrated function verbatim');

  const membershipBranch = fromMigration.slice(fromMigration.indexOf("elsif TG_TABLE_NAME = 'workspace_memberships'"));
  const pendingCounts = membershipBranch.match(/from public\.workspace_invitations[\s\S]*?;/g) ?? [];
  assert.equal(pendingCounts.length, 2, 'seat and shared-access counts');
  for (const count of pendingCounts) {
    assert.match(
      count,
      /lower\(btrim\(email\)\) <> lower\(btrim\(coalesce\(new\.email, ''\)\)\)/,
      'the pending invitation for the accepting email is the seat being taken, not another one',
    );
  }
  assert.match(
    fromMigration,
    /perform pg_advisory_xact_lock\(hashtextextended\('xbar-seats:' \|\| target_workspace_id::text, 0\)\);/,
    'seat checks are serialized per workspace, so concurrent acceptances cannot overfill',
  );
});
