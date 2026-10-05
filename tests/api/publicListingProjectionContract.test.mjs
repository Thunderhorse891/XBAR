import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const historical = readFileSync('supabase/migrations/20261001090000_workspace_keyed_storage_expand.sql', 'utf8');
const candidate = readFileSync('supabase/checks/public-listing-projection.candidate.sql', 'utf8');
const runner = readFileSync('tests/database/verify-public-listing-projection.sh', 'utf8');

test('projection preserves selected-row release and token conditions verbatim', () => {
  const gate = (source) =>
    source.slice(
      source.indexOf(
        '  if not found then',
        source.indexOf('create or replace function public.xbar_resolve_public_listing_legacy('),
      ),
      source.indexOf(
        '\n  select\n    (payload::jsonb',
        source.indexOf('create or replace function public.xbar_resolve_public_listing_legacy('),
      ),
    );
  const original = gate(historical).trim();
  assert.ok(candidate.includes(original));
  assert.match(
    candidate,
    /where sl\.share_path = p_share_path\s+and sl\.state <> 'Archived'\s+order by sl\.updated_at desc\s+limit 1/,
  );
});

test('candidate changes only the existing resolver body without expanding privileges', () => {
  assert.equal((candidate.match(/create or replace function/gi) ?? []).length, 1);
  assert.match(
    candidate,
    /xbar_resolve_public_listing_legacy\(\s+p_share_path text,\s+p_share_token text default null\s+\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path to 'public'/,
  );
  const executable = candidate.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(executable, /\b(grant|revoke|drop|alter|insert|update|delete)\b/i);
  assert.doesNotMatch(candidate, /listing_row\.payload\s*\|\||payload::jsonb\s*-/);
});

test('runtime harness is isolated and executes the historical trigger, correction and idempotence', () => {
  for (const guard of ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'recovery_fixture', 'synthetic-ci-only'])
    assert.ok(runner.includes(guard));
  assert.ok(runner.indexOf('exit 2') < runner.indexOf('psql -X'));
  assert.ok(runner.includes('expect_fixed=0'));
  assert.equal((runner.match(/expect_fixed=1/g) ?? []).length, 2);
  const fixture = readFileSync('tests/database/public-listing-projection.sql', 'utf8');
  assert.match(fixture, /set local role anon/);
  assert.match(fixture, /987654/);
  assert.match(fixture, /PRIVATE_SENTINEL/);
  assert.match(fixture, /rollback;/);
});
