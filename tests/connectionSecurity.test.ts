import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import test from 'node:test';

const fromRoot = (filePath: string) => path.resolve(process.cwd(), filePath);
const checkoutSource = await readFile(fromRoot('api/stripe/checkout.js'), 'utf8');
const plansSource = await readFile(fromRoot('api/_lib/subscription-plans.js'), 'utf8');
const migrationSource = await readFile(fromRoot('supabase/migrations/20260605_harden_workspace_rls.sql'), 'utf8');
const commercialMigrationSource = await readFile(
  fromRoot('supabase/migrations/20260611_commercial_entitlements.sql'),
  'utf8',
);
const cloudWorkspaceSource = await readFile(fromRoot('src/lib/cloudWorkspace.ts'), 'utf8');
const prepareSchemaSource = await readFile(fromRoot('scripts/prepare-supabase-schema.mjs'), 'utf8');
const telemetrySource = await readFile(fromRoot('api/telemetry.js'), 'utf8');
const inviteSource = await readFile(fromRoot('api/invite.js'), 'utf8');
const buyerInquiriesSource = await readFile(fromRoot('api/_lib/buyer-inquiries.js'), 'utf8');
const rateLimitSource = await readFile(fromRoot('api/_lib/rate-limit.js'), 'utf8');
const vercelConfigSource = await readFile(fromRoot('vercel.json'), 'utf8');
const platformConfigSource = await readFile(fromRoot('src/lib/platformConfig.ts'), 'utf8');
const validationSource = await readFile(fromRoot('api/_lib/validation.js'), 'utf8');
const corsSource = await readFile(fromRoot('api/_lib/cors.js'), 'utf8');
const managedBillingSource = await readFile(fromRoot('api/_lib/managed-billing.js'), 'utf8');

test('managed checkout is admin-only and validates return origins', () => {
  // The flag itself lives in api/_lib/managed-billing.js so the server gate and
  // the health check cannot drift apart. Follow it to its home rather than
  // dropping the assertion: checkout must still consult it, and it must still
  // be the MANAGED_BILLING_ENABLED variable that decides.
  assert.match(checkoutSource, /serverManagedBillingEnabled\(\)/);
  assert.match(managedBillingSource, /export function serverManagedBillingEnabled/);
  assert.match(managedBillingSource, /env\.MANAGED_BILLING_ENABLED/);
  assert.match(checkoutSource, /Managed billing is paused\. No payment session was created\./);
  assert.match(checkoutSource, /access\.role !== 'Admin'/);
  assert.match(checkoutSource, /configuredOrigins\.includes\(requestedUrl\.origin\)/);
  assert.doesNotMatch(checkoutSource, /const returnUrl = typeof body\.returnUrl/);
});

test('server subscription prices match advertised production tiers', () => {
  assert.match(plansSource, /Starter:[\s\S]*monthlyRate: 12/);
  assert.match(plansSource, /Professional:[\s\S]*monthlyRate: 29/);
  assert.match(plansSource, /'Ranch Ops':[\s\S]*monthlyRate: 79/);
  assert.match(plansSource, /Enterprise:[\s\S]*monthlyRate: 199/);
  // Annual is 10x monthly (2 months free) and must be pinned too — an
  // unadvertised annual price is a billing dispute waiting to happen.
  assert.match(plansSource, /Starter:[\s\S]*annualRate: 120/);
  assert.match(plansSource, /Professional:[\s\S]*annualRate: 290/);
  assert.match(plansSource, /'Ranch Ops':[\s\S]*annualRate: 790/);
  assert.match(plansSource, /Enterprise:[\s\S]*annualRate: 1990/);
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

test('API request bodies are validated with shared zod schemas', async () => {
  assert.match(validationSource, /export const inviteSchema/);
  assert.match(validationSource, /export const checkoutSchema/);
  assert.match(validationSource, /export const telemetrySchema/);
  assert.match(validationSource, /export const buyerInquirySchema/);
  assert.match(validationSource, /export const buyerResponseSchema/);
  assert.match(validationSource, /export const horsesImportSchema/);
  assert.match(inviteSource, /parseBody\(inviteSchema, body\)/);
  assert.match(checkoutSource, /parseBody\(checkoutSchema, body\)/);
  assert.match(telemetrySource, /parseBody\(telemetrySchema, body\)/);
  assert.match(buyerInquiriesSource, /parseBody\(buyerInquirySchema, body\)/);
  const buyerResponsesSource = await readFile(fromRoot('api/_lib/buyer-responses.js'), 'utf8');
  assert.match(buyerResponsesSource, /parseBody\(buyerResponseSchema, body\)/);
  const importSource = await readFile(fromRoot('api/_lib/horses-import.js'), 'utf8');
  assert.match(importSource, /parseBody\(horsesImportSchema, body\)/);
  // CSV imports are size-capped so a single request cannot buffer unbounded input.
  assert.match(validationSource, /MAX_IMPORT_CSV_CHARS/);
});

test('browser-called endpoints declare an explicit, allow-listed CORS policy', async () => {
  assert.match(corsSource, /Access-Control-Allow-Origin/);
  assert.match(corsSource, /allowedOrigins\.includes\(origin\)/);
  const corsEndpoints = [
    'api/telemetry.js',
    'api/_lib/buyer-inquiries.js',
    'api/invite.js',
    'api/stripe/checkout.js',
    'api/_lib/account-delete.js',
    'api/_lib/account-trial-start.js',
    'api/sale-packets.js',
    'api/_lib/horses-import.js',
    'api/_lib/horses-export.js',
    'api/_lib/buyer-responses.js',
    'api/_lib/documents-bulk-upload.js',
    'api/_lib/documents-generate-template.js',
  ];
  for (const endpoint of corsEndpoints) {
    const source = await readFile(fromRoot(endpoint), 'utf8');
    assert.match(source, /applyCors\(req, res/, `${endpoint} is missing the CORS policy`);
  }
});

test('anonymous public endpoints are rate limited', () => {
  assert.match(buyerInquiriesSource, /enforceRateLimit\(req, res, RATE_LIMIT\)/);
  assert.match(telemetrySource, /enforceRateLimit\(req, res, RATE_LIMIT\)/);
  // The limiter uses a shared store when configured and fails open on error.
  assert.match(rateLimitSource, /UPSTASH_REDIS_REST_URL/);
  assert.match(rateLimitSource, /memoryBuckets/);
});

test('every request-driven endpoint enforces a per-IP rate limit', async () => {
  // The Stripe webhook (signature-verified, retried by Stripe) and the cron
  // runner (CRON_SECRET-gated, fired by Vercel) are intentionally exempt.
  const rateLimitedEndpoints = [
    'api/telemetry.js',
    'api/_lib/buyer-inquiries.js',
    'api/invite.js',
    'api/stripe/checkout.js',
    'api/_lib/account-delete.js',
    'api/_lib/account-send-welcome.js',
    'api/_lib/account-trial-start.js',
    'api/sale-packets.js',
    'api/_lib/horses-import.js',
    'api/_lib/horses-export.js',
    'api/_lib/buyer-responses.js',
    'api/_lib/documents-bulk-upload.js',
    'api/_lib/documents-generate-template.js',
  ];
  for (const endpoint of rateLimitedEndpoints) {
    const source = await readFile(fromRoot(endpoint), 'utf8');
    assert.match(source, /enforceRateLimit\(req, res, RATE_LIMIT\)/, `${endpoint} is missing rate limiting`);
  }
});

test('cron secret comparison is constant-time and invite links use server config', async () => {
  const remindersSource = await readFile(fromRoot('api/_lib/reminders-run.js'), 'utf8');
  assert.match(remindersSource, /timingSafeEqual/);
  assert.doesNotMatch(remindersSource, /provided !== cronSecret/);
  // Invite redirect prefers the documented server-side PUBLIC_APP_URL.
  assert.match(inviteSource, /process\.env\.PUBLIC_APP_URL \|\|\s*\n?\s*process\.env\.VITE_PUBLIC_APP_URL/);
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

/*
 * The deployed build must not be a local-mode build.
 *
 * `scripts/build-local.mjs` sets VITE_ALLOW_LOCAL_MODE=true and DELETES
 * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, which is exactly right for the
 * offline test bundles and catastrophic for a deployment: the site stops being
 * able to check anybody's password and opens a browser-local workspace to
 * whoever arrives, while every real customer's account becomes unreachable
 * from it.
 *
 * Vercel takes its build command from the project settings unless the repo
 * overrides it here, so the override is a FILE, and files travel with merges.
 * A branch carrying one is one careless merge away from turning production
 * into a no-auth app -- which is why "remember not to merge that branch" is
 * not a control and this is.
 *
 * Deliberately narrow: a `buildCommand` is not banned, only one that routes
 * through the local-mode build. Same for emptying the Supabase variables at
 * build time, which reaches the same end by the other road.
 */
test('the deployment config cannot ship a local-mode, sign-in-less build', () => {
  const vercelConfig = JSON.parse(vercelConfigSource) as {
    buildCommand?: string;
    build?: { env?: Record<string, string> };
    env?: Record<string, string>;
  };

  const buildCommand = vercelConfig.buildCommand ?? '';
  assert.ok(
    !/build:local|build-local/.test(buildCommand),
    `vercel.json buildCommand must not produce a local-mode bundle, got: ${buildCommand}`,
  );

  /*
   * Matched to how the app ACTUALLY reads these, not to the spellings that
   * happened to come to mind.
   *
   * `platformConfig.readFlag` trims, lowercases, and accepts '1', 'yes' and
   * 'on' as well as 'true'; `readEnv` trims before deciding whether Supabase
   * is configured. A guard that tested for the exact string 'true', and for
   * exactly '', let `VITE_ALLOW_LOCAL_MODE: "1"` and a single-space Supabase
   * URL through -- both of which still produce the sign-in-less deployment
   * this exists to stop. A guard narrower than the thing it guards is worse
   * than none, because it reads as covered.
   */
  const TRUTHY_FLAGS = ['1', 'true', 'yes', 'on'];
  const readsAsTrue = (value: string | undefined) => TRUTHY_FLAGS.includes((value ?? '').trim().toLowerCase());
  const readsAsBlank = (value: string) => value.trim() === '';

  /*
   * And pinned to the source, so the mirror cannot drift silently. If someone
   * teaches readFlag a new spelling, this fails here rather than quietly
   * leaving a way past the guard.
   */
  assert.match(
    platformConfigSource,
    /\['1', 'true', 'yes', 'on'\]\.includes\(normalized\)/,
    'the truthy spellings mirrored above must still be the ones platformConfig accepts',
  );

  for (const [scope, env] of [
    ['env', vercelConfig.env],
    ['build.env', vercelConfig.build?.env],
  ] as const) {
    if (!env) continue;
    assert.ok(
      !readsAsTrue(env.VITE_ALLOW_LOCAL_MODE),
      `vercel.json ${scope} must not force local mode on a deployment, got: ${env.VITE_ALLOW_LOCAL_MODE}`,
    );
    for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const) {
      assert.ok(
        !(key in env) || !readsAsBlank(env[key]),
        `vercel.json ${scope} must not blank ${key} — a value that trims to empty is what makes the deployed app unable to sign anyone in`,
      );
    }
  }
});
