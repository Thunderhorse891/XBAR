// Local-only adapter for PR #395's unchanged PostgreSQL fixtures/assertions.
// Use a disposable PGlite installation via XBAR_PGLITE_MODULE. No network,
// production connection, project credentials or customer rows are used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { PGlite } = await import(process.env.XBAR_PGLITE_MODULE);
const db = new PGlite();
const read = (name) => readFileSync(path.join(root, name), 'utf8');
for (const name of [
  'supabase/checks/storage-fixture-schema.sql',
  'supabase/checks/workspace-metadata-fixture-schema.sql',
  'supabase/migrations/20260924130000_trial_entitlement.sql',
  'supabase/migrations/20260724_storage_limit_enforcement.sql',
  'supabase/migrations/20261002090000_seat_reservation_consumed_on_accept.sql',
])
  await db.exec(read(name));
await db.exec(
  'create trigger fixture_seat_limit before insert or update on public.workspace_memberships for each row execute function public.xbar_enforce_workspace_seat_limits()',
);
const checks = read('supabase/checks/workspace-metadata-rpc-access.sql');
const migration = read('supabase/migrations/20261112090000_guard_workspace_metadata_rpcs.sql');
let baselineFailed = false;
try {
  await db.exec(checks);
} catch (error) {
  assert.match(error.message, /Client directly invoked internal calculator/);
  baselineFailed = true;
  await db.exec('rollback');
}
assert.ok(baselineFailed, 'The unchanged baseline must fail for direct calculator exposure');
console.log('PASS: unchanged baseline fails the security assertion');
for (let i = 0; i < 2; i++) {
  await db.exec(migration);
  await db.exec(checks);
  console.log(
    `PASS: proposed migration/check round ${i + 1}; owner/member, outsider/inactive/unknown/anon/service and real pre-membership seat trigger`,
  );
}
// Mutation: restore just the original unguarded storage body. The existing
// nonmember assertion must catch the regression even with calculator ACLs fixed.
await db.exec(
  `create or replace function public.xbar_workspace_storage_bytes(p_workspace_id uuid) returns bigint language sql security definer set search_path=public as $$ select coalesce((select sum(size_bytes) from public.documents where workspace_id=p_workspace_id),0)+coalesce((select sum(size_bytes) from public.sale_packets where workspace_id=p_workspace_id),0) $$;`,
);
let mutationFailed = false;
try {
  await db.exec(checks);
} catch (error) {
  assert.match(error.message, /Nonmember read workspace storage/);
  mutationFailed = true;
  await db.exec('rollback');
}
assert.ok(mutationFailed, 'Removing the storage guard must fail');
console.log('PASS: removed storage guard fails the nonmember assertion');
await db.exec(read('supabase/checks/workspace-metadata-rollback.sql'));
let rollbackRestoredBaseline = false;
try {
  await db.exec(checks);
} catch (error) {
  assert.match(error.message, /Client directly invoked internal calculator/);
  rollbackRestoredBaseline = true;
  await db.exec('rollback');
}
assert.ok(rollbackRestoredBaseline, 'Rollback must reproduce the known baseline exposure');
await db.exec(migration);
await db.exec(checks);
console.log('PASS: saved rollback definitions restore baseline; reapplication restores protection');
await db.close();
