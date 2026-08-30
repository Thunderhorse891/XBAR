import { sendJson } from './_lib/http.js';

/*
 * Liveness/readiness probe for uptime monitoring and load balancers.
 * Reports which subsystems are configured without leaking any secret values,
 * and never touches the database — it must stay cheap enough to poll.
 */

function readFlag(name) {
  const normalized = process.env[name]?.trim().toLowerCase() ?? '';
  if (!normalized) return false;
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function hasEnv(name) {
  return Boolean(process.env[name]?.trim());
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const managedBilling = readFlag('MANAGED_BILLING_ENABLED');
  const clientManagedBilling = readFlag('VITE_MANAGED_BILLING_ENABLED');
  const stripePriceIds = [
    'STRIPE_PRICE_ID_STARTER',
    'STRIPE_PRICE_ID_PROFESSIONAL',
    'STRIPE_PRICE_ID_RANCH_OPS',
    'STRIPE_PRICE_ID_ENTERPRISE',
  ].every(hasEnv);
  const paymentLinks = [
    'VITE_STRIPE_PAYMENT_LINK_STARTER',
    'VITE_STRIPE_PAYMENT_LINK_PROFESSIONAL',
    'VITE_STRIPE_PAYMENT_LINK_RANCH_OPS',
    'VITE_STRIPE_PAYMENT_LINK_ENTERPRISE',
  ].some(hasEnv);
  const subsystems = {
    supabaseAdmin: Boolean(
      (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    stripeBilling: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    stripePriceIds,
    managedBilling,
    clientManagedBilling,
    paymentLinks,
    email: Boolean(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY),
    remindersCron: Boolean(process.env.CRON_SECRET),
  };
  const billingTouched =
    subsystems.managedBilling ||
    subsystems.clientManagedBilling ||
    subsystems.stripeBilling ||
    subsystems.stripeWebhook ||
    subsystems.stripePriceIds ||
    subsystems.paymentLinks;
  const billingReady =
    !billingTouched ||
    (subsystems.supabaseAdmin &&
      subsystems.stripeBilling &&
      subsystems.stripeWebhook &&
      subsystems.stripePriceIds &&
      subsystems.managedBilling &&
      subsystems.clientManagedBilling);
  const reasons = [];

  if (billingTouched && !subsystems.supabaseAdmin) {
    reasons.push('Supabase admin credentials are required before billing can create or sync entitlements.');
  }
  if (billingTouched && !subsystems.stripeBilling) {
    reasons.push('STRIPE_SECRET_KEY is required before paid checkout can create sessions.');
  }
  if (billingTouched && !subsystems.stripeWebhook) {
    reasons.push('STRIPE_WEBHOOK_SECRET is required before Stripe can confirm paid entitlements.');
  }
  if (billingTouched && !subsystems.stripePriceIds) {
    reasons.push('All STRIPE_PRICE_ID_* values are required before every tier can be purchased and synced.');
  }
  if (billingTouched && !subsystems.managedBilling) {
    reasons.push('MANAGED_BILLING_ENABLED must be true before the server will create checkout sessions.');
  }
  if (billingTouched && !subsystems.clientManagedBilling) {
    reasons.push('VITE_MANAGED_BILLING_ENABLED must be true before the app will offer managed checkout.');
  }

  const ok = billingReady;

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return sendJson(res, ok ? 200 : 503, {
    ok,
    status: ok ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    subsystems,
    checks: {
      billingReady,
    },
    ...(reasons.length ? { reasons } : {}),
  });
}
