import { serverManagedBillingEnabled } from '../_lib/managed-billing.js';
import Stripe from 'stripe';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, getStripePriceIdByTier } from '../_lib/subscription-plans.js';
import { checkoutBlockReason } from '../_lib/subscription-status.js';
import {
  claimCheckoutLock,
  findBlockingSubscription,
  listOpenCheckoutSessions,
  planCheckoutSession,
  splitExpiryBatch,
  releaseCheckoutLock,
  renewCheckoutLock,
  resolveExpiryFailure,
} from '../_lib/checkout-session.js';
import { requireWorkspaceAccess } from '../_lib/supabase-admin.js';
import { applyCors } from '../_lib/cors.js';
import { checkoutSchema, parseBody } from '../_lib/validation.js';
import { enforceRateLimit } from '../_lib/rate-limit.js';

const RATE_LIMIT = { bucket: 'checkout', limit: 10, windowSeconds: 60 };

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' }) : null;
const managedBillingEnabled = serverManagedBillingEnabled();

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

  /*
   * Claim the workspace before touching Stripe at all.
   *
   * Everything after this — creating a customer, listing, expiring, creating a
   * session — is only safe with one request doing it at a time. It also has to
   * come before the customer is created: a claim that fails afterwards leaves
   * Stripe holding a customer this deployment never recorded, which is the
   * orphan the write-failure path further down exists to avoid.
   */
  // The token, not a boolean: the release has to prove it still owns the lock.
  const claimToken = await claimCheckoutLock(supabase, workspaceId);
  if (!claimToken) {
    return sendJson(res, 409, {
      ok: false,
      code: 'billing_unavailable',
      retryable: true,
      message: 'Another checkout for this workspace is already being started. Wait a moment and try again.',
    });
  }

  try {
    /*
     * Read the billing row only now that the workspace is claimed.
     *
     * Reading it earlier looked harmless — it only decides whether a
     * subscription already exists — but it also carries the STRIPE CUSTOMER ID,
     * and that turned a stale read into a duplicate charge by a route the
     * subscription check could not see:
     *
     *   B reads an empty row, waits behind the lock. A creates customer C1 and
     *   session S1, writes the row, releases. B claims, still holding its empty
     *   row, so it creates a SECOND customer C2 — and every Stripe question it
     *   then asks is scoped to C2, which has no sessions and no subscriptions.
     *   S1 is invisible to it, and B creates S2 beside it.
     *
     * Asking Stripe instead of the database did not help, because the customer
     * is what decides who Stripe is asked ABOUT. The claim is what makes this
     * read stable: the previous owner wrote the row before releasing.
     *
     * There is exactly one read, deliberately. Keeping the cheap pre-claim gate
     * as well would leave a stale copy beside a fresh one, and using the wrong
     * one of a similar pair is the mistake this file keeps making.
     */
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
     * Ask Stripe whether a subscription already exists, because the billing row
     * could not have told us.
     *
     * `stripe_subscription_id` is written by the webhook. A Checkout Session
     * that completed between the row read above and the session listing below
     * is therefore invisible to both: gone from `status: 'open'`, and not yet
     * recorded. The request would create a second completable subscription, and
     * its upsert would then erase the first webhook's id when that landed.
     *
     * Completing a `mode: 'subscription'` session creates the subscription
     * immediately, so Stripe can answer even when the webhook has not arrived.
     * Asked after the claim, so two requests cannot both ask and both proceed.
     */
    const existingSubscription = await findBlockingSubscription(stripe, stripeCustomerId);

    if (!existingSubscription.complete) {
      // A partial list cannot show that no subscription exists. Same rule as
      // the capacity gates: unknown is not permission to charge.
      return sendJson(res, 503, {
        ok: false,
        code: 'billing_unavailable',
        retryable: true,
        message: 'Your billing status could not be verified just now. Try again in a moment.',
      });
    }

    if (existingSubscription.subscription) {
      return sendJson(res, 409, {
        ok: false,
        code: 'subscription_active',
        message:
          'This workspace already has a subscription with Stripe. Change plans in the billing portal so the existing subscription is updated rather than duplicated.',
      });
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
      const open = await listOpenCheckoutSessions(stripe, stripeCustomerId);

      /*
       * A partial list is not evidence that nothing else is completable.
       *
       * Planning from the pages that were read would leave every unread session
       * open in whatever tab it was abandoned in, and completing one of those
       * after this request's session bills the workspace twice. So refuse, the
       * same fail-closed rule the capacity gates and the expiry re-read follow.
       *
       * Nothing is expired first. Expiring a thousand sessions one call at a
       * time is not something this invocation can finish, and a customer who
       * has that many open built them deliberately: the endpoint is rate
       * limited to ten attempts a minute and Stripe closes an open session
       * after about a day.
       */
      if (!open.complete) {
        return sendJson(res, 503, {
          ok: false,
          code: 'billing_unavailable',
          retryable: true,
          message:
            'This workspace has more unfinished checkouts open than can be checked at once. Finish or abandon them in the billing portal, then try again.',
        });
      }

      openSessions = open.sessions;
    }

    const plan = planCheckoutSession(openSessions, intent);

    // Expire before creating. A stale open session for a different tier is
    // completable in whatever tab it was left in, which is the duplicate charge
    // this whole path exists to prevent.
    const { batch: expiring, deferred: deferredExpiries } = splitExpiryBatch(plan.expire);

    for (const stale of expiring) {
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

    /*
     * Anything left unexpired keeps this purchase from being safe.
     *
     * A deferred session is still completable in whatever tab it was abandoned
     * in, so creating — or reusing — one beside it is the duplicate charge the
     * expiry step exists to prevent. Refusing here is retryable rather than a
     * dead end: every attempt closes another batch, so the backlog shrinks by a
     * fixed amount each time instead of timing out mid-loop and closing an
     * unpredictable number.
     */
    if (deferredExpiries > 0) {
      return sendJson(res, 503, {
        ok: false,
        code: 'billing_unavailable',
        retryable: true,
        message: 'Older unfinished checkouts for this workspace are still being closed. Try again in a moment.',
      });
    }

    /*
     * Last check before anything billable: is this claim still ours?
     *
     * Everything above talks to Stripe, and the lease is two minutes. An
     * invocation slow enough to outrun it does not know that — a second request
     * will have reclaimed the workspace and may already be creating a session,
     * and this one would create another beside it. Validating the token only on
     * release was too late, because the session exists by then.
     *
     * The renewal is the fence: it proves ownership and buys a fresh lease for
     * the create and the row write that follow.
     */
    if (!(await renewCheckoutLock(supabase, workspaceId, claimToken))) {
      return sendJson(res, 409, {
        ok: false,
        code: 'billing_unavailable',
        retryable: true,
        message: 'Another checkout for this workspace started while this one was preparing. Try again in a moment.',
      });
    }

    /*
     * Ask about subscriptions a SECOND time, because the two questions above
     * were asked of different things at different moments.
     *
     * The subscription query runs first so a completion cannot hide between
     * the billing row and it. But a session completed on Stripe's hosted page
     * AFTER that query and BEFORE the session listing is invisible to both: by
     * the time the listing runs it is no longer `status: 'open'`, and the
     * subscription it created was not there when the earlier query ran. The
     * plan then reaches the create with nothing having seen it.
     *
     * The checkout claim cannot help here. It serializes requests to THIS
     * endpoint, and finishing a checkout on Stripe's own page never touches
     * it. Neither can the billing row, read before any of this and still empty
     * until the webhook lands.
     *
     * So the pair is closed by re-asking, inside the lease the renewal just
     * bought and immediately before anything billable. This does not make the
     * purchase atomic with Stripe — a completion landing after this query is
     * beyond anything an endpoint can observe — but it removes the wide window
     * between two list calls, which is the one an ordinary retry falls into.
     */
    const lateSubscription = await findBlockingSubscription(stripe, stripeCustomerId);

    if (!lateSubscription.complete) {
      return sendJson(res, 503, {
        ok: false,
        code: 'billing_unavailable',
        retryable: true,
        message: 'Your billing status could not be verified just now. Try again in a moment.',
      });
    }

    if (lateSubscription.subscription) {
      return sendJson(res, 409, {
        ok: false,
        code: 'subscription_active',
        message:
          'A checkout for this workspace completed a moment ago. Give it a minute to appear, then check the billing portal before starting another plan.',
      });
    }

    let session = plan.session;
    if (plan.action !== 'reuse') {
      /*
       * No Stripe idempotency key here any more, deliberately.
       *
       * Every key available to a single request is derived from that request, so
       * it can only de-duplicate identical submissions or, with a time bucket,
       * leak across the bucket boundary. The claim above is what serializes, and
       * a second mechanism that looks like it serializes but does not is worse
       * than none — it is what made the last two attempts read as solved.
       */
      session = await stripe.checkout.sessions.create({
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
      });
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
  } finally {
    // Best effort: the expiry is what guarantees progress, so a failed release
    // must never turn a completed checkout into an error. Matched on the token
    // so an invocation that outlived the expiry cannot clear a lock that a
    // later request has since taken.
    await releaseCheckoutLock(supabase, workspaceId, claimToken);
  }
}
