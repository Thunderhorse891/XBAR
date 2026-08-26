import Stripe from 'stripe';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, getStripePriceIdByTier } from '../_lib/subscription-plans.js';
import { checkoutBlockReason } from '../_lib/subscription-status.js';
import {
  checkoutIdempotencyKey,
  isIdempotencyConflict,
  planCheckoutSession,
  resolveExpiryFailure,
} from '../_lib/checkout-session.js';
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
      continue;
    } catch (error) {
      console.warn('Expiring a stale checkout session failed.', error);
    }

    /*
     * A failed expire is not automatically harmless.
     *
     * `expire` throws for a session that is already dead, which is fine — and
     * also for one that COMPLETED between the list and the call, which is a
     * purchase that just succeeded. Carrying on there creates the second
     * subscription this path exists to prevent, and the billing row cannot
     * catch it: it was read before any of this and still shows none, because
     * the webhook has not landed yet.
     */
    let reread = null;
    try {
      reread = await stripe.checkout.sessions.retrieve(stale.id);
    } catch (error) {
      console.error('Re-reading a checkout session after a failed expire failed.', error);
    }

    const outcome = resolveExpiryFailure(reread);
    if (outcome === 'proceed') continue;

    return sendJson(res, outcome === 'refuse_completed' ? 409 : 503, {
      ok: false,
      code: outcome === 'refuse_completed' ? 'subscription_active' : 'billing_unavailable',
      retryable: outcome !== 'refuse_completed',
      message:
        outcome === 'refuse_completed'
          ? 'A checkout for this workspace completed a moment ago. Give it a minute to appear, then check the billing portal before starting another plan.'
          : 'An earlier checkout for this workspace could not be confirmed as closed. Try again shortly rather than risk being billed twice.',
    });
  }

  let session = plan.session;
  if (plan.action !== 'reuse') {
    try {
      session = await stripe.checkout.sessions.create(
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
        // Serializes creation for this workspace, which listing alone cannot
        // do: two concurrent requests can both list before either creates.
        { idempotencyKey: checkoutIdempotencyKey(intent) },
      );
    } catch (error) {
      if (!isIdempotencyConflict(error)) throw error;
      /*
       * Another checkout for this workspace is being created right now, for a
       * different plan or seat count. Both requests listed before either
       * created anything, so neither could see the other — and letting both
       * through is exactly how a workspace ends up with two completable
       * sessions and two subscriptions.
       *
       * One of them has to wait, and saying so is the honest answer.
       */
      return sendJson(res, 409, {
        ok: false,
        code: 'billing_unavailable',
        retryable: true,
        message: 'Another checkout for this workspace is already being started. Wait a moment and try again.',
      });
    }
  }

  /*
   * Only a NEW session writes the row, and that exclusion is load-bearing.
   *
   * A reused session can be completed in another tab between the listing above
   * and this write. If its webhook lands first it writes the live
   * `stripe_subscription_id`, and this unconditional `''` then erased it —
   * replacing a paid entitlement with `incomplete` and, worse, leaving the next
   * request to find neither a subscription id nor an open session, free to
   * create a second billable subscription.
   *
   * Nothing is lost by skipping it: reuse can only happen when a customer id
   * was already read from this row, so the row exists, and the webhook writes
   * the authoritative profile on completion either way.
   */
  if (plan.action !== 'reuse') {
    const { error: billingWriteError } = await supabase.from('workspace_billing_customers').upsert({
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

    if (billingWriteError) {
      /*
       * Stripe now holds a customer and an open session that this deployment
       * has no record of. Returning the URL anyway would leave a billable
       * orphan: the next request reads a row with no customer id, creates a
       * second customer, and cannot list or expire this session — the
       * duplicate-subscription path, reopened by a failed database write.
       *
       * So close what was just created before refusing.
       */
      console.error('Recording the checkout customer failed.', billingWriteError);
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireError) {
        console.error('Closing an unrecorded checkout session failed.', expireError);
      }
      return sendJson(res, 503, {
        ok: false,
        code: 'billing_unavailable',
        retryable: true,
        message: 'Checkout could not be recorded for this workspace. Nothing was charged — try again in a moment.',
      });
    }
  }

  return sendJson(res, 200, {
    ok: true,
    url: session.url,
    sessionId: session.id,
  });
}
