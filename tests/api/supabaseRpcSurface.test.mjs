import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const SECURITY_MIGRATION = '20260822_restrict_anon_rpc_surface.sql';

/*
 * The anon RPC surface.
 *
 * Supabase's publishable key ships in the browser bundle by design, so anything
 * the `anon` role may execute is effectively public. SECURITY DEFINER functions
 * run with the definer's privileges and bypass RLS, which makes an accidental
 * anon grant on one considerably worse than it looks.
 *
 * These assertions are static, and they are deliberately about *intent* rather
 * than about the live grants: the executable check requires a PostgreSQL
 * instance, which is not available in every environment this suite runs in. The
 * migration itself was verified end to end against PostgreSQL 16 with this
 * repository's schema loaded — anon-executable SECURITY DEFINER functions went
 * from 10 to 2, `authenticated` kept all five functions it needs, and
 * `service_role` kept storage accounting. What is pinned here is the thing that
 * can silently regress in a text file: a new public grant appearing, or the
 * migration losing one of the two revokes it needs.
 */

function readMigration(name) {
  return readFileSync(path.join(migrationsDir, name), 'utf8');
}

const allMigrations = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql'));

test('the security migration is present', () => {
  assert.ok(allMigrations.includes(SECURITY_MIGRATION), `${SECURITY_MIGRATION} is missing`);
});

test('the set of functions granted to anon is exactly the known set', () => {
  // A closed set, not a filter. Any *new* anon grant appearing in the schema
  // fails this test, which is the regression that matters: a function added
  // later with `to anon` tacked on would otherwise pass unnoticed.
  const expectedAnonGrants = {
    // Buyer opens a share link with no account (src/lib/publicShare.ts).
    xbar_resolve_public_listing: 'intentional — buyer share flow',
    xbar_track_public_share_view: 'intentional — buyer share flow',
    // Granted by the base schema, revoked by the security migration: it is
    // referenced nowhere in src/ or api/, so it is a second unmaintained anon
    // entry point to the same listing data.
    xbar_resolve_public_listing_legacy: 'legacy — revoked by the security migration',
  };

  const sqlFiles = [
    path.join(repoRoot, 'supabase', 'production-schema.sql'),
    // The security migration is excluded on purpose: its grants are dynamic
    // SQL built with format(), so scanning it for literal statements matches
    // the template rather than a real grant. Its behavior is pinned by the
    // keep-list and revoke assertions below instead.
    ...allMigrations.filter((file) => file !== SECURITY_MIGRATION).map((file) => path.join(migrationsDir, file)),
  ];

  const found = new Set();

  for (const file of sqlFiles) {
    const sql = readFileSync(file, 'utf8');
    const grants = sql.match(/grant\s+execute\s+on\s+function\s+[^;]*?\bto\b[^;]*;/gi) ?? [];

    for (const grant of grants) {
      if (!/\banon\b/i.test(grant)) continue;

      const name = grant.match(/public\.([a-z0-9_]+)\s*\(/i)?.[1];
      assert.ok(name, `could not read a function name from:\n${grant}`);

      // Exact name, not substring: "xbar_resolve_public_listing" is a prefix of
      // "xbar_resolve_public_listing_legacy", so a substring check would let
      // the legacy resolver pass as the intentional one.
      assert.ok(
        Object.prototype.hasOwnProperty.call(expectedAnonGrants, name),
        `${path.basename(file)} grants execute to anon on ${name}, which is not a known public RPC`,
      );
      found.add(name);
    }
  }

  // The two buyer-flow functions must actually be granted; an assertion that
  // only rejects unknown names would still pass if the share flow lost its
  // grant entirely and quietly broke for every buyer.
  assert.ok(found.has('xbar_resolve_public_listing'), 'the buyer share resolver lost its anon grant');
  assert.ok(found.has('xbar_track_public_share_view'), 'the buyer share view tracker lost its anon grant');
});

test('the migration revokes from PUBLIC and from anon, not one or the other', () => {
  const sql = readMigration(SECURITY_MIGRATION);

  // Both are required and neither substitutes for the other. Revoking only
  // anon leaves the PUBLIC grant that anon inherits. Revoking only PUBLIC
  // leaves explicit anon grants untouched — this schema issues three, so a
  // PUBLIC-only revoke would have left those functions open. That was a real
  // defect in an earlier draft of this migration, caught by running it.
  assert.match(sql, /revoke execute on function %s from public/);
  assert.match(sql, /revoke execute on function %s from anon/);
});

test('the migration re-grants every function the application calls', () => {
  const sql = readMigration(SECURITY_MIGRATION);

  // Losing any of these breaks something specific:
  //   the two RLS helpers  -> every signed-in read fails on policy evaluation
  //   the entitlement pair -> tier limits cannot be read
  //   storage accounting   -> the storage cap stops being enforceable
  for (const fn of [
    'xbar_has_workspace_access',
    'xbar_can_manage_workspace',
    'xbar_commercial_limits',
    'xbar_subscription_limits',
    'xbar_workspace_storage_bytes',
  ]) {
    assert.ok(sql.includes(fn), `${fn} must be re-granted after the revoke`);
  }
});

test('service_role is granted the storage RPC explicitly', () => {
  const sql = readMigration(SECURITY_MIGRATION);

  // BYPASSRLS covers row-level policies and nothing else. Function EXECUTE is
  // an ordinary privilege, and service_role held it here only through the
  // default PUBLIC grant, so revoking PUBLIC without this line silently
  // disables the storage cap that api/_lib/entitlements.js enforces.
  assert.match(sql, /'xbar_workspace_storage_bytes',\s*'service_role'/);
});

test('the migration is driven by the catalog rather than a fixed function list', () => {
  const sql = readMigration(SECURITY_MIGRATION);

  // A hardcoded revoke aborts on a database where the function is absent, and
  // silently misses functions added later. Reading pg_proc avoids both.
  assert.match(sql, /from pg_proc/);
  assert.match(sql, /prosecdef/, 'the sweep must be limited to SECURITY DEFINER functions');
});

test('the migration is not presented as already applied', () => {
  const sql = readMigration(SECURITY_MIGRATION);

  // It changes access control on a live database, so it is applied
  // deliberately by an operator, with a documented verification procedure.
  assert.match(sql, /NOT YET APPLIED/);
  assert.match(sql, /HOW TO APPLY THIS/);
  assert.match(sql, /ROLLBACK/);
});

test('the legacy resolver is not re-granted to anon', () => {
  const sql = readMigration(SECURITY_MIGRATION);

  // xbar_resolve_public_listing_legacy is referenced nowhere in src/ or api/,
  // so leaving it open would keep a second unmaintained anon entry point to
  // the same listing data. It is closed, with restore instructions in the
  // migration in case share links in circulation still reach it.
  const keepList = sql.match(/keep_public text\[\] := array\[[^\]]*\]/);
  assert.ok(keepList, 'expected a keep list in the migration');
  assert.doesNotMatch(keepList[0], /legacy/);
});

/*
 * The drift verifier must not report success when a required grant is gone.
 *
 * verify-rpc-surface.mjs checked only for functions anon should not reach. A
 * lost grant on either half of the buyer share flow left that list empty, so
 * the script printed that the surface was correctly limited and exited zero —
 * while public links could not resolve or record views. An over-tight surface
 * is as much a drift failure as an over-broad one, and quieter.
 */
test('the verifier checks the anon surface in both directions', () => {
  const script = readFileSync(path.join(repoRoot, 'scripts', 'verify-rpc-surface.mjs'), 'utf8');

  assert.match(script, /anonMissing/, 'a required grant that disappeared has to be reported');
  assert.match(script, /anonExtra/, 'and so does anything reachable that should not be');

  // Both halves of the share flow are required; naming only the resolver is how
  // the tracking RPC gets revoked by mistake.
  for (const fn of ['xbar_resolve_public_listing', 'xbar_track_public_share_view']) {
    assert.ok(script.includes(fn), `${fn} must be in the verifier's required set`);
  }

  // A verifier that always exits zero cannot fail a deployment check.
  assert.match(script, /process\.exit\(1\)/, 'drift must exit non-zero');
});

test('the verifier only reports success for an exact match', () => {
  const script = readFileSync(path.join(repoRoot, 'scripts', 'verify-rpc-surface.mjs'), 'utf8');

  const success = script.indexOf('anon surface is exactly the buyer share flow.');
  assert.notEqual(success, -1, 'the success message should claim an exact match, not merely a limited one');

  // The success branch has to be guarded by both checks, or it is reachable
  // with a required function missing.
  const guard = script.lastIndexOf('if (!anonMissing.length && !anonExtra.length)', success);
  assert.notEqual(guard, -1, 'success must require both no extras and nothing missing');
});
