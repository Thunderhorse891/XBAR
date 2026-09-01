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
  /*
   * Two billing shapes are complete, and only one of them needs the server.
   *
   * Hosted payment links are a whole configuration on their own: the client
   * redirects to a Stripe-hosted page, and nothing on this deployment has to
   * hold a secret key, receive a webhook, or know a price ID. It is how a
   * workspace with no cloud session buys a plan.
   *
   * So the managed-billing requirements below are triggered by the MANAGED
   * signals only. Including `paymentLinks` here made a link-only deployment
   * fail its own readiness probe — and README.md points uptime monitors and
   * load balancers at this endpoint, so a working deployment would have been
   * pulled out of service for using a configuration the app supports.
   *
   * A half-configured managed stack is still unhealthy, which is the case this
   * check exists for: those pieces are useless apart, and the failure they
   * produce otherwise is a checkout that dies mid-flow.
   */
  const managedBillingTouched =
    subsystems.managedBilling ||
    subsystems.clientManagedBilling ||
    subsystems.stripeBilling ||
    subsystems.stripeWebhook ||
    subsystems.stripePriceIds;
  const billingReady =
    !managedBillingTouched ||
    (subsystems.supabaseAdmin &&
      subsystems.stripeBilling &&
      subsystems.stripeWebhook &&
      subsystems.stripePriceIds &&
      subsystems.managedBilling &&
      subsystems.clientManagedBilling);
  const reasons = [];
  const warnings = [];

  /*
   * Healthy, but worth saying out loud rather than leaving an operator to infer
   * it from a subsystem boolean: without a webhook nothing tells this
   * deployment that a link payment succeeded, so entitlements after a hosted
   * checkout are granted by hand. That is a deliberate operating mode, not a
   * fault, which is why it is a warning and not a 503.
   */
  if (subsystems.paymentLinks && !managedBillingTouched) {
    warnings.push(
      'Billing runs on hosted Stripe payment links only. Checkout works, but no webhook confirms payment, so entitlements must be granted manually.',
    );
  }

  if (managedBillingTouched && !subsystems.supabaseAdmin) {
    reasons.push('Supabase admin credentials are required before billing can create or sync entitlements.');
  }
  if (managedBillingTouched && !subsystems.stripeBilling) {
    reasons.push('STRIPE_SECRET_KEY is required before paid checkout can create sessions.');
  }
  if (managedBillingTouched && !subsystems.stripeWebhook) {
    reasons.push('STRIPE_WEBHOOK_SECRET is required before Stripe can confirm paid entitlements.');
  }
  if (managedBillingTouched && !subsystems.stripePriceIds) {
    reasons.push('All STRIPE_PRICE_ID_* values are required before every tier can be purchased and synced.');
  }
  if (managedBillingTouched && !subsystems.managedBilling) {
    reasons.push('MANAGED_BILLING_ENABLED must be true before the server will create checkout sessions.');
  }
  if (managedBillingTouched && !subsystems.clientManagedBilling) {
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
    ...(warnings.length ? { warnings } : {}),
  });
}
