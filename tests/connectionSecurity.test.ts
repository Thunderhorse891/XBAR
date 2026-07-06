import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

const fromRoot = (filePath: string) => path.resolve(process.cwd(), filePath);
const checkoutSource = await readFile(fromRoot('api/stripe/checkout.js'), 'utf8');
const plansSource = await readFile(fromRoot('api/_lib/subscription-plans.js'), 'utf8');
const migrationSource = await readFile(fromRoot('supabase/migrations/20260605_harden_workspace_rls.sql'), 'utf8');
const commercialMigrationSource = await readFile(fromRoot('supabase/migrations/20260611_commercial_entitlements.sql'), 'utf8');
const cloudWorkspaceSource = await readFile(fromRoot('src/lib/cloudWorkspace.ts'), 'utf8');
const prepareSchemaSource = await readFile(fromRoot('scripts/prepare-supabase-schema.mjs'), 'utf8');
const telemetrySource = await readFile(fromRoot('api/telemetry.js'), 'utf8');
const inviteSource = await readFile(fromRoot('api/invite.js'), 'utf8');
const buyerInquiriesSource = await readFile(fromRoot('api/buyer-inquiries.js'), 'utf8');
const rateLimitSource = await readFile(fromRoot('api/_lib/rate-limit.js'), 'utf8');
const vercelConfigSource = await readFile(fromRoot('vercel.json'), 'utf8');
const validationSource = await readFile(fromRoot('api/_lib/validation.js'), 'utf8');
const corsSource = await readFile(fromRoot('api/_lib/cors.js'), 'utf8');

test('managed checkout is admin-only and validates return origins', () => {
  assert.match(checkoutSource, /MANAGED_BILLING_ENABLED/);
  assert.match(checkoutSource, /Managed billing is paused\. No payment session was created\./);
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

test('telemetry never trusts a client-supplied workspace and caps payloads', () => {
  // A claimed workspace is only attached after membership is verified.
  assert.match(telemetrySource, /requireWorkspaceAccess\(accessToken, requestedWorkspaceId\)/);
  assert.match(telemetrySource, /let workspaceId = null/);
  assert.match(telemetrySource, /MAX_PAYLOAD_BYTES/);
  assert.match(telemetrySource, /enforceRateLimit\(req, res, RATE_LIMIT\)/);
  // The raw request workspaceId must never be written directly.
  assert.doesNotMatch(telemetrySource, /workspace_id: requestedWorkspaceId/);
});

test('member invitations are admin-only with a bounded role set', () => {
  assert.match(inviteSource, /access\.role !== 'Admin'/);
  assert.match(inviteSource, /parseBody\(inviteSchema, body\)/);
  assert.match(inviteSource, /Only workspace admins can invite members\./);
});

test('API request bodies are validated with shared zod schemas', () => {
  assert.match(validationSource, /export const inviteSchema/);
  assert.match(validationSource, /export const checkoutSchema/);
  assert.match(validationSource, /export const telemetrySchema/);
  assert.match(inviteSource, /parseBody\(inviteSchema, body\)/);
  assert.match(checkoutSource, /parseBody\(checkoutSchema, body\)/);
  assert.match(telemetrySource, /parseBody\(telemetrySchema, body\)/);
});

test('public endpoints declare an explicit, allow-listed CORS policy', () => {
  assert.match(corsSource, /Access-Control-Allow-Origin/);
  assert.match(corsSource, /allowedOrigins\.includes\(origin\)/);
  assert.match(buyerInquiriesSource, /applyCors\(req, res\)/);
  assert.match(telemetrySource, /applyCors\(req, res\)/);
});

test('anonymous public endpoints are rate limited', () => {
  assert.match(buyerInquiriesSource, /enforceRateLimit\(req, res, RATE_LIMIT\)/);
  assert.match(telemetrySource, /enforceRateLimit\(req, res, RATE_LIMIT\)/);
  // The limiter uses a shared store when configured and fails open on error.
  assert.match(rateLimitSource, /UPSTASH_REDIS_REST_URL/);
  assert.match(rateLimitSource, /memoryBuckets/);
});

test('production responses carry hardened security headers', () => {
  assert.match(vercelConfigSource, /Content-Security-Policy/);
  assert.match(vercelConfigSource, /frame-ancestors 'none'/);
  assert.match(vercelConfigSource, /Strict-Transport-Security/);
  assert.match(vercelConfigSource, /X-Content-Type-Options/);
  assert.match(vercelConfigSource, /Referrer-Policy/);
  assert.match(vercelConfigSource, /Permissions-Policy/);
});

test('commercial entitlements are server-authoritative and audited', () => {
  assert.match(commercialMigrationSource, /drop policy if exists "workspace subscription profiles own workspace"/);
  assert.match(commercialMigrationSource, /billing_state = 'Past Due'/);
  assert.match(commercialMigrationSource, /trg_sale_packets_enforce_commercial_limits/);
  assert.match(commercialMigrationSource, /trg_sales_leads_enforce_commercial_limits/);
  assert.match(commercialMigrationSource, /trg_shared_listings_audit/);
  assert.doesNotMatch(cloudWorkspaceSource, /from\('workspace_subscription_profiles'\)\.upsert/);
});
