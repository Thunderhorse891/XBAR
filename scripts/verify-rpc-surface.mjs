#!/usr/bin/env node
/*
 * Report which SECURITY DEFINER functions each Supabase role can execute.
 *
 * The static test (tests/api/supabaseRpcSurface.test.mjs) can only check what
 * the SQL files say. This checks what a database actually grants, which is the
 * question that matters when applying
 * supabase/migrations/20260822_restrict_anon_rpc_surface.sql — deployments
 * drift from migration files, so the file being correct does not establish that
 * the database is.
 *
 * Usage:
 *   node scripts/verify-rpc-surface.mjs "postgres://user:pass@host:5432/db"
 *   DATABASE_URL=... node scripts/verify-rpc-surface.mjs
 *
 * Run it before applying and again afterwards. Expected outcome for this
 * schema: anon drops to exactly xbar_resolve_public_listing and
 * xbar_track_public_share_view, authenticated keeps the two RLS helpers plus
 * the entitlement and storage functions, and service_role keeps
 * xbar_workspace_storage_bytes.
 *
 * Requires psql on PATH. It only reads catalog tables and changes nothing.
 */

import { spawnSync } from 'node:child_process';

const connection = process.argv[2] || process.env.DATABASE_URL || '';

if (!connection) {
  console.error('Pass a connection string, or set DATABASE_URL. Nothing was queried.');
  process.exit(1);
}

const ROLES = ['anon', 'authenticated', 'service_role'];

const query = `
select r.rolname,
       p.proname || '(' || coalesce((
         select string_agg(format_type(t, null), ', ' order by ord)
         from unnest(p.proargtypes) with ordinality as a(t, ord)
       ), '') || ')' as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (select unnest(array[${ROLES.map((role) => `'${role}'`).join(',')}]) as rolname) r
where n.nspname = 'public'
  and p.prosecdef
  and p.proname like 'xbar\\_%'
  and exists (select 1 from pg_roles where rolname = r.rolname)
  and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
order by r.rolname, signature;
`;

const result = spawnSync('psql', [connection, '-tAF', '\t', '-c', query], { encoding: 'utf8' });

if (result.error) {
  console.error(`Could not run psql: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(result.stderr.trim() || `psql exited ${result.status}`);
  process.exit(1);
}

const byRole = new Map(ROLES.map((role) => [role, []]));
for (const line of result.stdout.split('\n')) {
  const [role, fn] = line.split('\t');
  if (role && fn && byRole.has(role)) byRole.get(role).push(fn);
}

for (const role of ROLES) {
  const functions = byRole.get(role);
  console.log(`\n${role} can execute ${functions.length} SECURITY DEFINER function(s):`);
  for (const fn of functions) console.log(`  ${fn}`);
  if (functions.length === 0) console.log('  (none)');
}

// The buyer share flow, and nothing else. Both halves are required: a buyer
// opens a link with no account, so resolution AND view tracking must stay
// reachable by anon.
// Exact signatures, matching the migration's allowlist. Comparing bare names
// would report an exact surface while an unintended overload of one of these
// names stayed executable — the drift this script exists to catch.
//
// Built from proargtypes, not pg_get_function_identity_arguments, which keeps
// parameter names and would render these as
// `xbar_resolve_public_listing(p_share_path text, p_share_token text)` —
// matching nothing here, so a correct database would report both RPCs as
// extra AND missing at once. Verified against PostgreSQL 16.
const REQUIRED_ANON = ['xbar_resolve_public_listing(text, text)', 'xbar_track_public_share_view(text, text)'];

// The grants the application cannot work without, per role. Losing one of
// these is drift this script exists to catch, and it is the quiet kind: a
// missing RLS-helper grant makes every signed-in read fail with "permission
// denied for function", and a missing storage grant makes the capacity gate
// unable to read usage. Reporting only on `anon` meant the script printed the
// reduced lists and still exited 0.
//
// anon is exhaustive — it must be exactly this set. The other two are minimums:
// extra grants there are not a security problem the way an anon grant is.
const REQUIRED_BY_ROLE = {
  authenticated: [
    'xbar_has_workspace_access(uuid)',
    'xbar_can_manage_workspace(uuid)',
    'xbar_commercial_limits(uuid)',
    'xbar_subscription_limits(uuid)',
  ],
  service_role: ['xbar_workspace_storage_bytes(uuid)'],
};

const roleMissing = Object.entries(REQUIRED_BY_ROLE).map(([role, required]) => ({
  role,
  missing: required.filter((fn) => !byRole.get(role).includes(fn)),
}));

const anonFunctions = byRole.get('anon');
const anonExtra = anonFunctions.filter((fn) => !REQUIRED_ANON.includes(fn));
const anonMissing = REQUIRED_ANON.filter((fn) => !anonFunctions.includes(fn));

console.log('');

// Checking only for extras made this report success when a required grant had
// been lost — the drift case the script exists to catch. An over-tight surface
// is a broken buyer share link, which is as much a failure as an over-broad one
// and is quieter, so both are reported and both exit non-zero.
if (anonMissing.length) {
  console.log(`anon is MISSING ${anonMissing.length} function(s) the buyer share flow needs:`);
  for (const fn of anonMissing) console.log(`  ${fn}`);
  console.log('Public share links cannot resolve or record views until these are granted to anon.');
}

if (anonExtra.length) {
  console.log(`anon can still execute ${anonExtra.length} function(s) beyond the buyer share flow:`);
  for (const fn of anonExtra) console.log(`  ${fn}`);
  console.log('Apply supabase/migrations/20260822_restrict_anon_rpc_surface.sql to close these.');
}

for (const { role, missing } of roleMissing) {
  if (!missing.length) continue;
  console.log(`${role} is MISSING ${missing.length} grant(s) the application needs:`);
  for (const fn of missing) console.log(`  ${fn}`);
  console.log(
    role === 'authenticated'
      ? 'Signed-in reads will fail with "permission denied for function" until these are granted.'
      : 'Storage capacity cannot be read, so the storage gate refuses every upload.',
  );
}

const anyRoleMissing = roleMissing.some(({ missing }) => missing.length > 0);

if (!anonMissing.length && !anonExtra.length && !anyRoleMissing) {
  console.log('anon surface is exactly the buyer share flow, and every required grant is present.');
  process.exit(0);
}

process.exit(1);
