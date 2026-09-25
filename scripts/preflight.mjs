#!/usr/bin/env node
// Go-live preflight: report which production subsystems are configured, what
// each missing value keeps switched off, and (optionally) probe a deployed
// instance's /api/health to compare intent against reality.
//
//   npm run preflight                       — check env vars visible to this shell
//   npm run preflight -- --url https://...  — also probe the deployment's /api/health
//
// This never prints secret values — only whether each variable is set.

import { readFileSync } from 'node:fs';
import { checkBackupEvidence } from './backup-evidence.mjs';

const args = process.argv.slice(2);
const urlFlagIndex = args.indexOf('--url');
const bareProbeUrl = args.find((arg) => /^https?:\/\//i.test(arg));
const probeUrl = urlFlagIndex >= 0 ? args[urlFlagIndex + 1] : bareProbeUrl;

const isSet = (name) => Boolean(process.env[name]?.trim());
const flagOn = (name) => /^(1|true|yes|on)$/i.test(process.env[name]?.trim() ?? '');

/** @type {{title: string, unlocks: string, required: {name: string, note?: string}[], optional?: {name: string, note?: string}[], enabled?: () => boolean, extra?: string[]}[]} */
const groups = [
  {
    title: 'Accounts, sync & document storage (Supabase)',
    unlocks:
      'Sign-in, multi-device sync, invitations, cloud document storage. Without these the app runs local-only on each device.',
    required: [
      { name: 'VITE_SUPABASE_URL', note: 'project URL (client)' },
      { name: 'VITE_SUPABASE_ANON_KEY', note: 'anon key (client)' },
      { name: 'SUPABASE_URL', note: 'project URL (API functions)' },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', note: 'service-role key (API functions)' },
    ],
  },
  {
    title: 'Online billing (Stripe)',
    unlocks:
      'Self-serve checkout and subscription management. Until fully configured, the app honestly shows the manual-billing panel.',
    required: [
      { name: 'STRIPE_SECRET_KEY' },
      { name: 'STRIPE_WEBHOOK_SECRET', note: 'from the dashboard webhook endpoint' },
      { name: 'STRIPE_PRICE_ID_STARTER' },
      { name: 'STRIPE_PRICE_ID_PROFESSIONAL' },
      { name: 'STRIPE_PRICE_ID_RANCH_OPS' },
      { name: 'STRIPE_PRICE_ID_ENTERPRISE' },
      // Annual billing has its own Stripe Price per tier (a Price pins its
      // interval), and checkout refuses an annual purchase without one — so a
      // deployment missing these is not fully configured for billing.
      { name: 'STRIPE_PRICE_ID_STARTER_ANNUAL', note: 'annual price' },
      { name: 'STRIPE_PRICE_ID_PROFESSIONAL_ANNUAL', note: 'annual price' },
      { name: 'STRIPE_PRICE_ID_RANCH_OPS_ANNUAL', note: 'annual price' },
      { name: 'STRIPE_PRICE_ID_ENTERPRISE_ANNUAL', note: 'annual price' },
    ],
    extra: [
      `VITE_MANAGED_BILLING_ENABLED is ${flagOn('VITE_MANAGED_BILLING_ENABLED') ? 'ON — the app shows online checkout' : 'OFF — the app shows the manual-billing panel'}. Flip it to true only after every Stripe value above is set (billing also requires Supabase).`,
    ],
  },
  {
    title: 'Outbound email (reminders, invitations)',
    unlocks: 'Emailed care reminders and invitation delivery. Without a provider, reminders stay in-app only.',
    required: [{ name: 'EMAIL_FROM_ADDRESS', note: 'verified sender' }],
    optional: [
      { name: 'RESEND_API_KEY', note: 'either this…' },
      { name: 'SENDGRID_API_KEY', note: '…or this' },
    ],
    enabled: () => isSet('EMAIL_FROM_ADDRESS') && (isSet('RESEND_API_KEY') || isSet('SENDGRID_API_KEY')),
  },
  {
    title: 'Daily reminders cron',
    unlocks:
      'The scheduled /api/reminders/run job (vercel.json cron). Without the secret, the endpoint rejects every run.',
    required: [{ name: 'CRON_SECRET', note: 'any long random string; set the same value in Vercel' }],
  },
  {
    title: 'Shared request protection and monitoring',
    unlocks:
      'Protected APIs, cron completion evidence and error tracking. Missing Redis blocks protected requests with 503.',
    required: [
      { name: 'UPSTASH_REDIS_REST_URL' },
      { name: 'UPSTASH_REDIS_REST_TOKEN' },
      { name: 'SENTRY_DSN' },
      { name: 'VITE_SENTRY_DSN' },
    ],
  },
  {
    title: 'Optional hardening & extras',
    unlocks: 'Server-side OCR, custom-domain canonicals.',
    required: [],
    optional: [
      { name: 'OCR_PROVIDER', note: 'textract enables AWS OCR (needs AWS keys); blank = on-device OCR' },
      {
        name: 'PUBLIC_SITE_ORIGIN',
        note: 'set to the custom domain before building, drives every canonical/sitemap URL',
      },
      { name: 'GOOGLE_SITE_VERIFICATION', note: 'Search Console meta tag' },
    ],
  },
];

const mark = (ok) => (ok ? '✓ set' : '✗ missing');

let readyGroups = 0;
let gatedGroups = 0;

console.log('XBAR go-live preflight');
console.log('======================\n');

for (const group of groups) {
  const requiredOk = group.required.every((v) => isSet(v.name));
  const enabled = group.enabled ? group.enabled() : requiredOk;
  const hasRequirements = group.required.length > 0 || group.enabled;
  const status = !hasRequirements ? 'optional' : enabled ? 'CONFIGURED (UNVERIFIED)' : 'NOT CONFIGURED';
  if (hasRequirements) {
    if (enabled) readyGroups++;
    else gatedGroups++;
  }

  console.log(`${group.title} — ${status}`);
  console.log(`  ${group.unlocks}`);
  for (const v of group.required) {
    console.log(`    ${mark(isSet(v.name))}  ${v.name}${v.note ? `  (${v.note})` : ''}`);
  }
  for (const v of group.optional ?? []) {
    console.log(`    ${isSet(v.name) ? '✓ set' : '○ unset'}  ${v.name}${v.note ? `  (${v.note})` : ''}`);
  }
  for (const line of group.extra ?? []) {
    console.log(`    ℹ ${line}`);
  }
  console.log('');
}

console.log(`Summary: ${readyGroups} subsystem(s) configured but unverified, ${gatedGroups} awaiting configuration.`);
console.log(
  'Configuration presence is not launch readiness. Verify real sign-in, email callbacks, storage and enabled billing before public release.',
);
console.log('A browser-only preview does not validate cloud account access or production services.');

let backupEvidence;
try {
  backupEvidence = JSON.parse(readFileSync(process.env.BACKUP_EVIDENCE_PATH, 'utf8'));
} catch {
  /* Missing evidence blocks launch. */
}
const backup = checkBackupEvidence(backupEvidence, process.env.XBAR_BACKUP_SOURCE_REF);
console.log(`Backup and restore — ${backup.ok ? 'VERIFIED EVIDENCE' : 'BLOCKED'}`);
for (const failure of backup.failures) console.log(`  ${failure}`);
if (!backup.ok || gatedGroups > 0) process.exitCode = 1;

if (probeUrl) {
  const origin = probeUrl.replace(/\/+$/, '');
  console.log(`\nProbing ${origin}/api/health ...`);
  try {
    const response = await fetch(`${origin}/api/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`Health endpoint returned HTTP ${response.status}`);
    const health = await response.json();
    if (health?.ok !== true) throw new Error('Health endpoint did not report a successful health verdict.');
    console.log(`  HTTP ${response.status}`);
    for (const [key, value] of Object.entries(health.subsystems ?? health)) {
      if (typeof value === 'boolean') {
        console.log(`    ${value ? '✓ reported configured' : '✗ reported unconfigured'}  ${key}`);
      }
    }
    // Health's ok verdict establishes liveness/billing consistency, not that
    // every launch feature is configured. Require the deployed values too;
    // this shell's configuration cannot stand in for the target deployment.
    const requiredSubsystems = ['supabaseAdmin', 'email', 'remindersCron'];
    const missingSubsystems = requiredSubsystems.filter((key) => health.subsystems?.[key] !== true);
    if (missingSubsystems.length) {
      throw new Error(`Deployment configuration is missing or unverified: ${missingSubsystems.join(', ')}.`);
    }
    console.log('  Compare reported configuration with the local env report. This does not test service access.');
    console.log('  Email delivery, auth callbacks, storage policies, webhooks and migrations remain unverified.');
  } catch (error) {
    console.error(`  Probe failed: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
