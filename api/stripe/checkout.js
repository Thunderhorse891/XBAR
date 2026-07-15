import Stripe from 'stripe';
import { readJsonBody, sendJson } from '../_lib/http.js';
import { buildSubscriptionProfile, getStripePriceIdByTier } from '../_lib/subscription-plans.js';
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
        quantity: seatCount,
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
