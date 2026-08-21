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
select r.rolname, p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature
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
const REQUIRED_ANON = ['xbar_resolve_public_listing(text, text)', 'xbar_track_public_share_view(text, text)'];

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

if (!anonMissing.length && !anonExtra.length) {
  console.log('anon surface is exactly the buyer share flow.');
  process.exit(0);
}

process.exit(1);
