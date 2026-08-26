import Stripe from 'stripe';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, getStripePriceIdByTier } from '../_lib/subscription-plans.js';
import { checkoutBlockReason } from '../_lib/subscription-status.js';
import { checkoutIdempotencyKey, planCheckoutSession } from '../_lib/checkout-session.js';
import { requireWorkspaceAccess } from '../_lib/supabase-admin.js';
import { applyCors } from '../_lib/cors.js';
import { checkoutSchema, parseBody } from '../_lib/validation.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';

const RATE_LIMIT = { bucket: 'checkout', limit: 10, windowSeconds: 60 };

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' }) : null;
const managedBillingEnabled = process.env.MANAGED_BILLING_ENABLED?.trim().toLowerCase() === 'true';

function getTrustedReturnUrl(requestedReturnUrl) {
  const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const configuredOrigins = [process.env.PUBLIC_APP_URL, process.env.VITE_PUBLIC_APP_URL, vercelOrigin]
    .filter(Boolean)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  const fallbackOrigin = configuredOrigins[0] || 'https://xbar-horse-management-app.vercel.app';
  try {
    const requestedUrl = new URL(requestedReturnUrl || fallbackOrigin);
    if (configuredOrigins.includes(requestedUrl.origin)) {
      return requestedUrl.toString();
    }
  } catch {
    // Fall through to the trusted application origin.
  }

  return fallbackOrigin;
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!(await enforceRateLimit(req, res, RATE_LIMIT))) {
    return;
  }

  if (!managedBillingEnabled) {
    return sendJson(res, 503, { ok: false, message: 'Managed billing is paused. No payment session was created.' });
  }

  if (!stripe) {
    return sendJson(res, 503, { ok: false, message: 'Stripe server billing is not configured.' });
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  const body = await readJsonBody(req);
  const parsed = parseBody(checkoutSchema, body);
  if (!parsed.ok) {
    return sendJson(res, 400, { ok: false, message: parsed.message });
  }
  const { tier, workspaceId } = parsed.data;
  const returnUrl = getTrustedReturnUrl(parsed.data.returnUrl);
  const requestedSeatCount = Number(parsed.data.seatCount || 1);
  const seatCount = Number.isInteger(requestedSeatCount) ? Math.min(100, Math.max(1, requestedSeatCount)) : 1;
  const priceId = getStripePriceIdByTier(tier);

  if (!workspaceId || !priceId) {
    return sendJson(res, 400, { ok: false, message: 'Workspace id and a configured Stripe price id are required.' });
  }

  const access = await requireWorkspaceAccess(accessToken, workspaceId);
  if (!access.ok) {
    return sendJson(res, access.status, { ok: false, message: access.message });
  }

  if (access.role !== 'Admin') {
    return sendJson(res, 403, { ok: false, message: 'Only workspace admins can manage billing.' });
  }

  const { supabase, user } = access;
  const { data: billingCustomer, error: billingCustomerError } = await supabase
    .from('workspace_billing_customers')
    .select('stripe_customer_id, stripe_subscription_id, entitlement_payload')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  // Fail closed on an unreadable billing row. Everything below decides whether
  // this workspace already has a subscription Stripe can bill; a failed read
  // answers nothing, and guessing "no" here charges a customer twice.
  if (billingCustomerError) {
    return sendJson(res, 503, {
      ok: false,
      code: 'billing_unavailable',
      retryable: true,
      message: 'Your billing status could not be verified just now. Try again in a moment.',
    });
  }

  /*
   * Refuse a second subscription when one already exists that Stripe can act on.
   *
   * The client hides the buttons for some of these, but that is a courtesy, not
   * a control: an admin can call this endpoint directly, and an older cached
   * bundle will. Enforced here because the harm is money — a second Checkout
   * Session beside a live subscription bills the customer twice and leaves two
   * webhook streams fighting over one entitlement record.
   *
   * Both changes go through the billing portal, which acts on the subscription
   * that already exists rather than creating another one.
   */
  const blockReason = checkoutBlockReason(billingCustomer);
  if (blockReason) {
    return sendJson(res, 409, {
      ok: false,
      code: blockReason,
      message:
        blockReason === 'subscription_active'
          ? 'This workspace already has an active subscription. Change plans in the billing portal so the existing subscription is updated rather than duplicated.'
          : blockReason === 'subscription_recoverable'
            ? 'This workspace already has a subscription that can be reactivated. Update the payment method in the billing portal instead of starting a new plan.'
            : 'This workspace has a subscription on file whose status could not be confirmed. Check it in the billing portal before starting a new plan.',
    });
  }

  let stripeCustomerId = billingCustomer?.stripe_customer_id || '';
  if (!stripeCustomerId) {
    const customer = await stripe.customers.create({
      email: user.email || undefined,
      metadata: {
        workspace_id: workspaceId,
        owner_user_id: user.id,
      },
    });
    stripeCustomerId = customer.id;
  }

  /*
   * An open Checkout Session is a purchase in flight, and the guard above
   * cannot see one.
   *
   * `stripe_subscription_id` stays empty until the webhook lands after payment,
   * so the entire window between "seller clicked Subscribe" and "Stripe told us
   * it completed" looked identical to a workspace that had never tried to buy.
   * A second tab or a retry inside that window created another completable
   * session; completing both bills the customer twice.
   *
   * Stripe knows what is open, so ask it rather than tracking it in a column.
   */
  const intent = { workspaceId, tier, seatCount };
  let openSessions = [];
  if (stripeCustomerId) {
    const existing = await stripe.checkout.sessions.list({
      customer: stripeCustomerId,
      status: 'open',
      limit: 10,
    });
    openSessions = existing?.data ?? [];
  }

  const plan = planCheckoutSession(openSessions, intent);

  // Expire before creating. A stale open session for a different tier is
  // completable in whatever tab it was left in, which is the duplicate charge
  // this whole path exists to prevent.
  for (const stale of plan.expire) {
    try {
      await stripe.checkout.sessions.expire(stale.id);
    } catch (error) {
      // Already expired or completed between the list and now. Nothing to do,
      // and failing the purchase over it would be worse than the race.
      console.warn('Expiring a stale checkout session failed.', error);
    }
  }

  const session =
    plan.action === 'reuse'
      ? plan.session
      : await stripe.checkout.sessions.create(
          {
            mode: 'subscription',
            customer: stripeCustomerId,
            line_items: [
              {
                price: priceId,
                quantity: seatCount,
              },
            ],
            success_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}checkout=success`,
            cancel_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}checkout=cancelled`,
            metadata: {
              workspace_id: workspaceId,
              workspace_tier: tier,
              // Recorded so a later request can tell whether an open session is
              // the SAME purchase. Reusing one for a different seat count would
              // charge the wrong amount.
              workspace_seats: String(seatCount),
              owner_user_id: user.id,
            },
            subscription_data: {
              metadata: {
                workspace_id: workspaceId,
                workspace_tier: tier,
              },
            },
          },
          // Collapses two POSTs that race each other, which listing alone
          // cannot catch: both can list before either has created anything.
          { idempotencyKey: checkoutIdempotencyKey(intent) },
        );

  await supabase.from('workspace_billing_customers').upsert({
    workspace_id: workspaceId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: '',
    stripe_price_id: priceId,
    seat_count: seatCount,
    entitlement_payload: buildSubscriptionProfile({
      tier,
      billingStatus: 'incomplete',
      existingUsage: billingCustomer?.entitlement_payload?.usage || {},
    }),
    updated_at: new Date().toISOString(),
  });

  return sendJson(res, 200, {
    ok: true,
    url: session.url,
    sessionId: session.id,
  });
}
