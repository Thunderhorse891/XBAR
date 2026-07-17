#!/usr/bin/env node
// Go-live preflight: report which production subsystems are configured, what
// each missing value keeps switched off, and (optionally) probe a deployed
// instance's /api/health to compare intent against reality.
//
//   npm run preflight                       — check env vars visible to this shell
//   npm run preflight -- --url https://...  — also probe the deployment's /api/health
//
// This never prints secret values — only whether each variable is set.

const args = process.argv.slice(2);
const urlFlagIndex = args.indexOf('--url');
const probeUrl = urlFlagIndex >= 0 ? args[urlFlagIndex + 1] : null;

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
    title: 'Optional hardening & extras',
    unlocks: 'Cross-instance rate limiting, server-side OCR, custom-domain canonicals.',
    required: [],
    optional: [
      { name: 'UPSTASH_REDIS_REST_URL', note: 'shared rate limiting' },
      { name: 'UPSTASH_REDIS_REST_TOKEN', note: 'shared rate limiting' },
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
  const status = !hasRequirements ? 'optional' : enabled ? 'READY' : 'NOT CONFIGURED';
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

console.log(`Summary: ${readyGroups} subsystem(s) ready, ${gatedGroups} awaiting configuration.`);
console.log('The app is safe to deploy at any point — unconfigured subsystems degrade honestly instead of failing.');

if (probeUrl) {
  const origin = probeUrl.replace(/\/+$/, '');
  console.log(`\nProbing ${origin}/api/health ...`);
  try {
    const response = await fetch(`${origin}/api/health`, { headers: { accept: 'application/json' } });
    const health = await response.json();
    console.log(`  HTTP ${response.status}`);
    for (const [key, value] of Object.entries(health.subsystems ?? health)) {
      if (typeof value === 'boolean') {
        console.log(`    ${value ? '✓ live' : '✗ off '}  ${key}`);
      }
    }
    console.log('  Compare the live values above with the local env report — differences mean the');
    console.log('  Vercel project is missing (or holding different) environment variables.');
  } catch (error) {
    console.error(`  Probe failed: ${error?.message ?? error}`);
    process.exitCode = 1;
  }
}
