import Stripe from 'stripe';
import { readRawBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, findTierByPriceId } from '../_lib/subscription-plans.js';
import { resolveWebhookTier } from '../_lib/subscription-status.js';
import { getSupabaseAdmin } from '../_lib/supabase-admin.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' }) : null;

async function syncWorkspaceSubscription({
  workspaceId,
  customerId,
  subscriptionId,
  priceId,
  status,
  currentPeriodEnd,
  quantity,
  eventId,
  eventType,
  eventCreatedAt,
  payload,
}) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error('Supabase admin credentials are not configured.');
  }

  /*
   * The tier decision stays here: `resolveWebhookTier` needs the
   * STRIPE_PRICE_ID_* mapping, which lives in this deployment's environment
   * rather than in the database.
   *
   * Its `storedTier` read happens before the lock the RPC takes, which is
   * deliberate and not a second race. The stored tier is a fallback used ONLY
   * when the price id is unrecognized, and only for a non-entitling status — an
   * entitling status with an unknown price refuses outright. So that path never
   * grants access; it carries an existing tier label forward while the billing
   * state marks it inactive.
   */
  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('workspace_subscription_profiles')
    .select('tier, payload')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  // A failed read is not the same as "no row", and the difference is
  // destructive. resolveWebhookTier falls back to the baseline when there is no
  // stored tier, which is right for a workspace that has never subscribed — but
  // if this SELECT merely errored while the write below succeeds, a canceled
  // Professional or Enterprise subscription would be rewritten as Starter,
  // losing the purchased tier and its rate permanently rather than being marked
  // inactive. Throwing writes nothing and leaves the event for Stripe to retry.
  if (existingProfileError) {
    throw new Error(`Could not read the existing subscription profile: ${existingProfileError.message}`);
  }

  // The asymmetry between granting and withdrawing access lives in
  // resolveWebhookTier, next to the rest of the billing-status policy, so it is
  // testable without a Stripe signature or a database.
  const decision = resolveWebhookTier({
    status,
    mappedTier: findTierByPriceId(priceId),
    storedTier: existingProfile?.tier,
  });

  if (!decision.ok) {
    throw new Error(
      `Unrecognized Stripe price id "${priceId}" — no STRIPE_PRICE_ID_* env var matches it, so the tier is unknown and no entitlement was written.`,
    );
  }

  const tier = decision.tier;

  const existingUsage = existingProfile?.payload?.usage || {};
  const nextProfile = buildSubscriptionProfile({
    tier,
    billingStatus: status,
    renewalDate: currentPeriodEnd ? new Date(currentPeriodEnd * 1000).toISOString().slice(0, 10) : '',
    existingUsage,
  });

  /*
   * One call, because the ordering check and the three writes have to be
   * atomic.
   *
   * They were a SELECT for the newest applied event followed by three separate
   * upserts. That is a read-modify-write with no serialization, and Stripe
   * delivers concurrently: an older `updated` being retried and the `deleted`
   * that superseded it can both read the same previous timestamp, both decide
   * they are newest, and the older one write `Active` over the cancellation.
   * Both are then logged as processed, so no retry ever corrects it.
   *
   * `xbar_apply_subscription_event` takes an advisory lock on the workspace for
   * the length of its transaction, so the second caller sees the first one's
   * row and refuses. It returns false when it declined as stale — which is a
   * success for the delivery: the event has been superseded and Stripe should
   * stop retrying it.
   */
  const { data: applied, error: applyError } = await supabase.rpc('xbar_apply_subscription_event', {
    p_workspace_id: workspaceId,
    p_event_id: eventId,
    p_event_type: eventType,
    p_event_created_at: Number.isFinite(Number(eventCreatedAt)) ? new Date(Number(eventCreatedAt)).toISOString() : null,
    p_payload: payload,
    p_tier: tier,
    p_billing_state: nextProfile.billingState,
    p_monthly_rate: nextProfile.monthlyRate,
    p_profile: nextProfile,
    p_customer_id: customerId || '',
    p_subscription_id: subscriptionId || '',
    p_price_id: priceId || '',
    p_seat_count: Number(quantity || 1),
  });

  if (applyError) {
    throw new Error(`Subscription entitlement sync failed: ${applyError.message}`);
  }

  return { applied: applied === true };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!stripe || !webhookSecret) {
    return sendJson(res, 503, { ok: false, message: 'Stripe webhook configuration is missing.' });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    const payload = event.data.object;

    // Idempotency guard: Stripe retries deliveries, so a replayed event id is
    // acknowledged without re-running the sync (no duplicate Stripe API calls,
    // no racing upserts).
    const supabaseForReplay = getSupabaseAdmin();
    if (supabaseForReplay) {
      const { data: processedEvents } = await supabaseForReplay
        .from('workspace_subscription_events')
        .select('id')
        .eq('stripe_event_id', event.id)
        .limit(1);
      if (processedEvents?.length) {
        return sendJson(res, 200, { ok: true, duplicate: true });
      }
    }

    if (event.type === 'checkout.session.completed' && payload.mode === 'subscription') {
      const workspaceId = payload.metadata?.workspace_id;
      const subscriptionId = typeof payload.subscription === 'string' ? payload.subscription : payload.subscription?.id;
      const customerId = typeof payload.customer === 'string' ? payload.customer : payload.customer?.id;
      if (workspaceId && subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const lineItem = subscription.items.data[0];
        await syncWorkspaceSubscription({
          workspaceId,
          customerId,
          subscriptionId,
          priceId: lineItem?.price?.id || '',
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          quantity: lineItem?.quantity || 1,
          eventId: event.id,
          eventType: event.type,
          eventCreatedAt: event.created * 1000,
          payload,
        });
      }
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const workspaceId = payload.metadata?.workspace_id;
      const customerId = typeof payload.customer === 'string' ? payload.customer : payload.customer?.id;
      const lineItem = payload.items?.data?.[0];
      const directWorkspaceId = workspaceId || null;

      let resolvedWorkspaceId = directWorkspaceId;
      if (!resolvedWorkspaceId && customerId) {
        const supabase = getSupabaseAdmin();
        const { data: billingCustomer } = await supabase
          .from('workspace_billing_customers')
          .select('workspace_id')
          .eq('stripe_customer_id', customerId)
          .maybeSingle();
        resolvedWorkspaceId = billingCustomer?.workspace_id || null;
      }

      if (resolvedWorkspaceId) {
        await syncWorkspaceSubscription({
          workspaceId: resolvedWorkspaceId,
          customerId,
          subscriptionId: payload.id,
          priceId: lineItem?.price?.id || '',
          status: payload.status,
          currentPeriodEnd: payload.current_period_end,
          quantity: lineItem?.quantity || 1,
          eventId: event.id,
          eventType: event.type,
          eventCreatedAt: event.created * 1000,
          payload,
        });
      }
    }

    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 400, {
      ok: false,
      message: error instanceof Error ? error.message : 'Webhook processing failed.',
    });
  }
}
