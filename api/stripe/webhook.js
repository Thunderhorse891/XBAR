import Stripe from 'stripe';
import { readRawBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, findTierByPriceId } from '../_lib/subscription-plans.js';
import { getSupabaseAdmin } from '../_lib/supabase-admin.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' }) : null;

async function syncWorkspaceSubscription({ workspaceId, customerId, subscriptionId, priceId, status, currentPeriodEnd, quantity, eventId, eventType, payload }) {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    throw new Error('Supabase admin credentials are not configured.');
  }

  const tier = findTierByPriceId(priceId) || 'Starter';
  const { data: existingProfile } = await supabase
    .from('workspace_subscription_profiles')
    .select('payload')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

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
    payload,
    processed_at: new Date().toISOString(),
  });
  if (eventError) {
    throw new Error(`Subscription event log failed: ${eventError.message}`);
  }
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
        if (supabase) {
          const { data: billingCustomer } = await supabase
            .from('workspace_billing_customers')
            .select('workspace_id')
            .eq('stripe_customer_id', customerId)
            .maybeSingle();
          resolvedWorkspaceId = billingCustomer?.workspace_id || null;
        }
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
