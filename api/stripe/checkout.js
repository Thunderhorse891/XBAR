import Stripe from 'stripe';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, getStripePriceIdByTier } from '../_lib/subscription-plans.js';
import { requireWorkspaceAccess } from '../_lib/supabase-admin.js';

const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey, { apiVersion: '2026-02-25.clover' }) : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  if (!stripe) {
    return sendJson(res, 503, { ok: false, message: 'Stripe server billing is not configured.' });
  }

  const accessToken = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim() || '';
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { ok: false, message: err.message });
  }
  const tier = typeof body.tier === 'string' ? body.tier : '';
  const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId : '';
  const returnUrl = typeof body.returnUrl === 'string' && body.returnUrl ? body.returnUrl : 'https://xbar.app';
  const seatCount = Number(body.seatCount || 1);
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
  const { data: billingCustomer } = await supabase
    .from('workspace_billing_customers')
    .select('stripe_customer_id, entitlement_payload')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

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

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [
      {
        price: priceId,
        quantity: Math.max(1, seatCount),
      },
    ],
    success_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}checkout=success`,
    cancel_url: `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}checkout=cancelled`,
    metadata: {
      workspace_id: workspaceId,
      workspace_tier: tier,
      owner_user_id: user.id,
    },
    subscription_data: {
      metadata: {
        workspace_id: workspaceId,
        workspace_tier: tier,
      },
    },
  });

  await supabase.from('workspace_billing_customers').upsert({
    workspace_id: workspaceId,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: '',
    stripe_price_id: priceId,
    seat_count: Math.max(1, seatCount),
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
