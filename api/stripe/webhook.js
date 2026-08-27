import Stripe from 'stripe';
import { readRawBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, findTierByPriceId } from '../_lib/subscription-plans.js';
import { isStaleBillingEvent, resolveWebhookTier } from '../_lib/subscription-status.js';
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
   * Refuse an event Stripe created BEFORE the one already applied.
   *
   * The replay guard in the handler matches on `stripe_event_id`, which stops a
   * redelivery of the same event and nothing else. A different, older event is
   * exactly what Stripe's retry schedule produces: a
   * `customer.subscription.updated` whose first delivery failed arrives hours
   * later, after the `customer.subscription.deleted` that superseded it has
   * been processed. It has its own id, has genuinely never been applied, and
   * the unconditional upserts below wrote its stale `Active` payload straight
   * over the cancellation — leaving a paid tier nobody was paying for until
   * some later event happened to correct it.
   *
   * Checked here rather than in the handler so BOTH entry points are covered:
   * `checkout.session.completed` restores an entitlement just as effectively as
   * a subscription event, and a guard on one path is a guard someone adds a
   * second path around.
   */
  const { data: lastEvent, error: lastEventError } = await supabase
    .from('workspace_subscription_events')
    .select('stripe_event_created_at')
    .eq('workspace_id', workspaceId)
    .not('stripe_event_created_at', 'is', null)
    .order('stripe_event_created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  /*
   * A failed read is not "no previous event", and the difference decides
   * whether a superseded event is allowed to restore a canceled plan. Throwing
   * writes nothing and leaves the event for Stripe to retry — the same posture
   * the profile read below takes, for the same reason.
   */
  if (lastEventError) {
    throw new Error(`Could not read the last applied billing event: ${lastEventError.message}`);
  }

  const lastAppliedAt = lastEvent?.stripe_event_created_at ? Date.parse(lastEvent.stripe_event_created_at) : null;
  if (isStaleBillingEvent(eventCreatedAt, lastAppliedAt)) {
    return { applied: false, reason: 'stale' };
  }

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from('workspace_subscription_profiles')
    .select('tier, payload')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  // A failed read is not the same as "no row", and the difference is
  // destructive. resolveWebhookTier falls back to the baseline when there is no
  // stored tier, which is right for a workspace that has never subscribed — but
  // if this SELECT merely errored while the upserts below succeed, a canceled
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

  const { error: profileError } = await supabase.from('workspace_subscription_profiles').upsert({
    workspace_id: workspaceId,
    tier,
    billing_state: nextProfile.billingState,
    monthly_rate: nextProfile.monthlyRate,
    payload: nextProfile,
    updated_at: new Date().toISOString(),
  });
  if (profileError) {
    throw new Error(`Subscription profile sync failed: ${profileError.message}`);
  }

  const { error: customerError } = await supabase.from('workspace_billing_customers').upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId || '',
    stripe_subscription_id: subscriptionId || '',
    stripe_price_id: priceId || '',
    seat_count: Number(quantity || 1),
    entitlement_payload: nextProfile,
    updated_at: new Date().toISOString(),
  });
  if (customerError) {
    throw new Error(`Billing customer sync failed: ${customerError.message}`);
  }

  const { error: eventError } = await supabase.from('workspace_subscription_events').upsert({
    workspace_id: workspaceId,
    stripe_event_id: eventId,
    event_type: eventType,
    // Stripe's clock, not ours: `processed_at` is when this delivery was
    // handled, and a stale event handled late has the LATEST `processed_at` of
    // all — which is exactly why ordering by it ranked the superseded event
    // first.
    stripe_event_created_at: Number.isFinite(Number(eventCreatedAt))
      ? new Date(Number(eventCreatedAt)).toISOString()
      : null,
    payload,
    processed_at: new Date().toISOString(),
  });
  if (eventError) {
    throw new Error(`Subscription event log failed: ${eventError.message}`);
  }

  return { applied: true };
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
