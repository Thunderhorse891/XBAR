import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { databaseEnv } from './database-backup.mjs';
import { inspectCatalog, compareCatalog, loadBaseline } from './database-readiness.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost', 'postgres'].includes(new URL(url).hostname)) {
  throw new Error('Drift tests require isolated local PostgreSQL.');
}
const expected = loadBaseline().catalog;
assert.deepEqual(compareCatalog(inspectCatalog(url), expected), []);
// Each mutation is confined to a transaction on the synthetic local database.
// No live connection, customer data, migration ledger repair or persistent drift.
const snapshot = readFileSync('supabase/checks/release-catalog.sql', 'utf8').replace(
  'begin isolation level repeatable read read only;',
  '',
);
const cases = [
  ["update storage.buckets set public=true where id='horse-media';", 'buckets.horse-media'],
  ['drop function public.xbar_trial_active(jsonb);', 'functions.xbar_trial_active'],
  ['alter table public.workspace_subscription_profiles drop column billing_period;', 'billingPeriod'],
  [
    'alter table public.workspace_subscription_profiles disable row level security;',
    'rls.public.workspace_subscription_profiles',
  ],
  [
    'create policy unreviewed_write on public.workspace_subscription_profiles for all to authenticated using(true) with check(true);',
    'policies.public.workspace_subscription_profiles.unreviewed_write',
  ],
  [
    'create policy unreviewed_read on storage.objects for select to anon using(true);',
    'policies.storage.objects.unreviewed_read',
  ],
  ['alter table public.horses disable trigger trg_horses_enforce_commercial_limits;', 'triggers.public.horses'],
  ['grant execute on all functions in schema public to anon;', 'functions.'],
  [
    'create or replace function public.xbar_trial_active(p_payload jsonb) returns boolean language sql stable as $$ select true $$;',
    'functions.xbar_trial_active',
  ],
];
for (const [mutation, label] of cases) {
  const result = spawnSync('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1'], {
    env: databaseEnv(url),
    input: `begin;\n${mutation}\n${snapshot}`,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  const drift = compareCatalog(JSON.parse(result.stdout.trim()), expected);
  assert.ok(
    drift.some((f) => f.includes(label)),
    `undetected drift: ${label}`,
  );
  assert.deepEqual(compareCatalog(inspectCatalog(url), expected), [], 'drift fixture escaped rollback');
}
console.log(`PostgreSQL release gate rejected ${cases.length} actual catalog mutations; each rolled back.`);
