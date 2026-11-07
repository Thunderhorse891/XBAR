import { isEmailConfigured } from './_lib/email.js';
import { gmailSmtpStatus } from './_lib/gmail-smtp.js';
import { sendJson } from './_lib/http.js';
import {
  clientManagedBillingEnabled,
  serverManagedBillingEnabled,
  serverStripeModeReady,
  stripeAccountIdReady,
} from './_lib/managed-billing.js';
import { readLegacyPriceIds } from './_lib/subscription-plans.js';

/*
 * Liveness/readiness probe for uptime monitoring and load balancers.
 * Reports which subsystems are configured without leaking any secret values,
 * and never touches the database — it must stay cheap enough to poll.
 */

function hasEnv(name) {
  return Boolean(process.env[name]?.trim());
}

/*
 * Shapes, not just presence (audit F13). A value can be set and still be
 * useless: a product id pasted where a price id belongs, a payment-link URL in a
 * price variable, a publishable key in the secret slot. Every one of those read
 * as configured and failed only when a customer tried to pay. Nothing here
 * calls Stripe -- this endpoint must stay cheap enough to poll -- so it proves
 * the values are the right KIND of value; `npm run preflight` and a controlled
 * purchase prove they are the right account's.
 */
const SECRET_KEY_SHAPE = /^(?:sk|rk)_(live|test)_[A-Za-z0-9_]+$/;
const WEBHOOK_SECRET_SHAPE = /^whsec_[A-Za-z0-9+/=_-]+$/;
const PRICE_ID_SHAPE = /^price_[A-Za-z0-9_]+$/;
const PRICE_TIERS = ['STARTER', 'PROFESSIONAL', 'RANCH_OPS', 'ENTERPRISE'];

function envValue(name) {
  return process.env[name]?.trim() || '';
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  /*
   * Each flag read the way its OWN consumer reads it. The server's is the
   * strict form the checkout endpoint acts on; the client's is the broad form
   * its generic reader accepts. Asking one question of both is what let
   * readiness be green over a checkout that could not run.
   */
  const managedBilling = serverManagedBillingEnabled();
  const clientManagedBilling = clientManagedBillingEnabled();
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
  const secretKey = envValue('STRIPE_SECRET_KEY');
  const stripeMode = SECRET_KEY_SHAPE.exec(secretKey)?.[1] ?? null;
  const annualPriceIds = PRICE_TIERS.every((tier) => hasEnv(`STRIPE_PRICE_ID_${tier}_ANNUAL`));
  const subsystems = {
    supabaseAdmin: Boolean(
      (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    stripeBilling: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    stripePriceIds,
    stripeAnnualPriceIds: annualPriceIds,
    // Whether the secret key is a LIVE key. Not a secret, and exactly what an
    // operator needs to see: stripeBilling true with this false is a test key.
    stripeLiveKey: stripeMode === 'live',
    managedBilling,
    clientManagedBilling,
    paymentLinks,
    email: isEmailConfigured(),
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
      subsystems.clientManagedBilling &&
      serverStripeModeReady());
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
  /*
   * The mismatch itself, named. A client that offers checkout while the server
   * refuses it is not a missing value — every variable is set — so none of the
   * checks above can see it. It is the one shape that fails for the customer
   * at the moment they try to pay.
   */
  if (subsystems.clientManagedBilling && !subsystems.managedBilling) {
    reasons.push(
      'VITE_MANAGED_BILLING_ENABLED is on but MANAGED_BILLING_ENABLED is not exactly "true", so the app offers checkout the server will refuse.',
    );
  }

  /*
   * Malformed values make billing unready whatever else is set: each one
   * fails at the customer's moment of payment, not before.
   */
  const malformed = [];
  if (!stripeAccountIdReady(envValue('STRIPE_ACCOUNT_ID'))) {
    malformed.push('STRIPE_ACCOUNT_ID is set but is not a Stripe account id (acct_...).');
  }
  if (secretKey && !stripeMode) {
    malformed.push('STRIPE_SECRET_KEY is set but is not a Stripe secret key (sk_live_, sk_test_ or rk_...).');
  }
  const webhookSecret = envValue('STRIPE_WEBHOOK_SECRET');
  if (webhookSecret && !WEBHOOK_SECRET_SHAPE.test(webhookSecret)) {
    malformed.push('STRIPE_WEBHOOK_SECRET is set but is not a webhook signing secret (whsec_...).');
  }
  const priceOwners = new Map();
  for (const tier of PRICE_TIERS) {
    for (const name of [`STRIPE_PRICE_ID_${tier}`, `STRIPE_PRICE_ID_${tier}_ANNUAL`]) {
      const value = envValue(name);
      if (!value) continue;
      if (!PRICE_ID_SHAPE.test(value)) {
        malformed.push(`${name} is set but is not a Stripe price id (price_...).`);
        continue;
      }
      priceOwners.set(value, [...(priceOwners.get(value) ?? []), name]);
    }
  }
  // One id under two names resolves to whichever tier is checked first, so a
  // buyer of one plan would be entitled to the other.
  for (const names of priceOwners.values()) {
    if (names.length > 1) malformed.push(`${names.join(' and ')} hold the same price id; each plan needs its own.`);
  }
  const legacy = readLegacyPriceIds();
  for (const error of legacy.errors) malformed.push(`STRIPE_LEGACY_PRICE_IDS: ${error}`);
  for (const priceId of legacy.entries.keys()) {
    if (priceOwners.has(priceId)) {
      malformed.push(`STRIPE_LEGACY_PRICE_IDS lists ${priceId}, which is also a current price; list it in one place.`);
    }
  }
  reasons.push(...malformed);

  if (managedBillingTouched && !annualPriceIds) {
    warnings.push('Managed annual checkout is unavailable for plans missing STRIPE_PRICE_ID_*_ANNUAL.');
  }
  if (managedBillingTouched && !serverStripeModeReady()) {
    reasons.push('Production managed checkout requires a Stripe LIVE key. Test-mode checkout is unavailable.');
  }
  const gmail = gmailSmtpStatus();
  const gmailSelected = gmail.enabled && !hasEnv('RESEND_API_KEY') && !hasEnv('SENDGRID_API_KEY');
  if (gmailSelected) {
    warnings.push(
      gmail.configured
        ? 'Gmail SMTP is configured but unverified. It sends as the configured Gmail account, shares its daily limits, and may be blocked by Google. Inbox delivery and Supabase Auth SMTP must be tested separately.'
        : 'Gmail SMTP is enabled but requires a valid GMAIL_SMTP_USER and 16-letter GMAIL_SMTP_APP_PASSWORD. No Gmail messages can be sent.',
    );
  }
  if (!subsystems.email) {
    warnings.push(
      'No email provider is configured (RESEND_API_KEY, SENDGRID_API_KEY or opt-in Gmail SMTP). Welcome, trial, payment-failed and packet emails are not sent.',
    );
  } else if (!gmailSelected && !hasEnv('EMAIL_FROM_ADDRESS')) {
    warnings.push(
      'EMAIL_FROM_ADDRESS is not set, so email goes out from no-reply@xbar.app. That domain must be verified with the email provider or every send is rejected.',
    );
  }

  const ok = billingReady && malformed.length === 0;

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return sendJson(res, ok ? 200 : 503, {
    ok,
    status: ok ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    subsystems,
    checks: {
      billingReady: ok,
    },
    ...(reasons.length ? { reasons } : {}),
    ...(warnings.length ? { warnings } : {}),
  });
}
