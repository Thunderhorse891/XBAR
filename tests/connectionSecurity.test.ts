import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const checkoutSource = await readFile(new URL('../api/stripe/checkout.js', import.meta.url), 'utf8');
const plansSource = await readFile(new URL('../api/_lib/subscription-plans.js', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../supabase/migrations/20260605_harden_workspace_rls.sql', import.meta.url), 'utf8');
const prepareSchemaSource = await readFile(new URL('../scripts/prepare-supabase-schema.mjs', import.meta.url), 'utf8');

test('managed checkout is admin-only and validates return origins', () => {
  assert.match(checkoutSource, /access\.role !== 'Admin'/);
  assert.match(checkoutSource, /configuredOrigins\.includes\(requestedUrl\.origin\)/);
  assert.doesNotMatch(checkoutSource, /const returnUrl = typeof body\.returnUrl/);
});

test('server subscription prices match advertised production tiers', () => {
  assert.match(plansSource, /Starter:[\s\S]*monthlyRate: 29/);
  assert.match(plansSource, /Professional:[\s\S]*monthlyRate: 79/);
  assert.match(plansSource, /'Ranch Ops':[\s\S]*monthlyRate: 199/);
  assert.match(plansSource, /Enterprise:[\s\S]*monthlyRate: 499/);
});

test('Supabase hardening separates member reads from owner and admin writes', () => {
  assert.match(migrationSource, /xbar_has_workspace_access/);
  assert.match(migrationSource, /xbar_can_manage_workspace/);
  assert.match(migrationSource, /m\.role = 'Admin'/);
  assert.match(migrationSource, /drop policy if exists "horses own workspace"/);
  assert.match(migrationSource, /create policy "horses workspace read"/);
  assert.match(migrationSource, /create policy "horses workspace manage"/);
  assert.doesNotMatch(migrationSource, /create policy if not exists/);
});

test('schema preparation removes unsupported policy syntax', () => {
  assert.match(prepareSchemaSource, /create policy if not exists/);
  assert.match(prepareSchemaSource, /drop policy if exists/);
  assert.match(prepareSchemaSource, /production-schema\.generated\.sql/);
});
