import { verifyCheckoutPrice } from './checkout-price.js';
import {
  collectStripePages,
  listOpenCheckoutSessions,
  planCheckoutSession,
  renewCheckoutLock,
  resolveExpiryFailure,
  splitExpiryBatch,
} from './checkout-session.js';
import { findTierByPriceId, getStripePriceIdByTier } from './subscription-plans.js';
import { checkoutBlockReason, stripeSubscriptionBlocksCheckout } from './subscription-status.js';
import { tierIncludesPlan } from './entitlements.js';
import { serverManagedBillingEnabled } from './managed-billing.js';

export class UpgradeOfferError extends Error {
  constructor(code, message, status = 409) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const refuse = (code, message, status) => {
  throw new UpgradeOfferError(code, message, status);
};
const objectId = (value) => (typeof value === 'string' ? value : value?.id || '');
const hasDiscount = (value) => Boolean(value?.discount || (Array.isArray(value?.discounts) && value.discounts.length));

export async function offerAction(supabase, input, action, extra = {}) {
  const { data, error } = await supabase.rpc('xbar_upgrade_offer_action', {
    p_user_id: input.userId,
    p_workspace_id: input.workspaceId,
    p_feature: input.feature,
    p_attempt_id: input.attemptId,
    p_billing_period: input.billingPeriod,
    p_action: action,
    ...extra,
  });
  if (error || !data || typeof data.ok !== 'boolean') {
    refuse('offer_unavailable', 'Your upgrade offer could not be verified. Please try again or compare plans.', 503);
  }
  if (!data.ok) {
    const messages = {
      owner_required: 'Only the workspace owner can accept this upgrade.',
      attempt_conflict: 'This upgrade request belongs to different options. Close it and try again.',
      attempt_not_found: 'Open the feature’s upgrade offer before continuing.',
      offer_expired: 'This offer has expired or was declined. Close it and compare plans again.',
      offer_changed: 'The upgrade terms changed. Close this offer and review the available plans again.',
      account_deletion_in_progress: 'Account deletion is in progress. Billing changes are unavailable.',
    };
    refuse(
      data.code || 'offer_unavailable',
      messages[data.code] || 'The upgrade request could not be saved. Please try again.',
    );
  }
  if (
    !data.attempt ||
    data.attempt.attempt_id !== input.attemptId ||
    data.attempt.user_id !== input.userId ||
    data.attempt.workspace_id !== input.workspaceId ||
    data.attempt.feature !== input.feature ||
    data.attempt.billing_period !== input.billingPeriod ||
    !Number.isSafeInteger(data.attempt.attempt_number) ||
    data.attempt.attempt_number < 1 ||
    typeof data.discountEligible !== 'boolean'
  ) {
    refuse('offer_unavailable', 'The saved upgrade request could not be verified. Please try again.', 503);
  }
  return data;
}

/** Independent server check, also repeated immediately before any hosted session. */
export async function assertUpgradeOwner(supabase, workspaceId, userId) {
  const { data, error } = await supabase
    .from('workspaces')
    .select('id, owner_user_id')
    .eq('id', workspaceId)
    .maybeSingle();
  if (error) refuse('workspace_unavailable', 'Workspace ownership could not be verified.', 503);
  if (!data || data.owner_user_id !== userId)
    refuse('owner_required', 'Only the workspace owner can accept this upgrade.', 403);
}

export async function verifyUpgradeCoupon(stripe, couponId, price, now = new Date()) {
  if (!couponId) return false;
  try {
    const coupon = await stripe.coupons.retrieve(couponId);
    const products = coupon.applies_to?.products;
    return (
      coupon.id === couponId &&
      coupon.valid === true &&
      coupon.deleted !== true &&
      coupon.livemode === price.livemode &&
      coupon.percent_off === 10 &&
      coupon.amount_off == null &&
      coupon.duration === 'once' &&
      coupon.duration_in_months == null &&
      (!coupon.redeem_by || coupon.redeem_by > Math.floor(now.getTime() / 1000)) &&
      (coupon.max_redemptions == null ||
        (Number.isSafeInteger(coupon.times_redeemed) && coupon.times_redeemed < coupon.max_redemptions)) &&
      (products === undefined ||
        products === null ||
        (Array.isArray(products) && products.includes(objectId(price.product))))
    );
  } catch {
    return false;
  }
}

export function verifiedPortalConfiguration(config, price, configurationId) {
  const update = config?.features?.subscription_update;
  return Boolean(
    config?.id === configurationId &&
    config.active === true &&
    config.livemode === price.livemode &&
    update?.enabled === true &&
    update.default_allowed_updates?.includes('price') &&
    update.billing_cycle_anchor === 'now' &&
    update.proration_behavior === 'always_invoice' &&
    Array.isArray(update.schedule_at_period_end?.conditions) &&
    update.schedule_at_period_end.conditions.length === 0 &&
    update.products?.some(
      (product) => objectId(product.product) === objectId(price.product) && product.prices?.includes(price.id),
    ),
  );
}

export function assertUpgradableSubscription(subscription, { customerId, workspaceId, price, targetTier }) {
  const item = subscription.items?.data?.[0];
  const currentTier = findTierByPriceId(objectId(item?.price));
  if (
    subscription.status !== 'active' ||
    subscription.livemode !== price.livemode ||
    objectId(subscription.customer) !== customerId ||
    subscription.metadata?.workspace_id !== workspaceId ||
    subscription.items?.data?.length !== 1 ||
    subscription.items?.has_more ||
    !item?.id ||
    item.quantity !== 1 ||
    subscription.collection_method !== 'charge_automatically' ||
    subscription.latest_invoice?.status !== 'paid' ||
    subscription.schedule ||
    subscription.pending_update ||
    subscription.cancel_at ||
    subscription.cancel_at_period_end ||
    subscription.pause_collection ||
    hasDiscount(subscription) ||
    hasDiscount(item) ||
    subscription.billing_mode?.type !== 'classic' ||
    !currentTier
  ) {
    refuse(
      'subscription_review_required',
      'Your existing subscription needs a review in billing before this offer can be applied.',
    );
  }
  if (tierIncludesPlan(currentTier, targetTier)) {
    refuse('already_entitled', 'Stripe already shows this feature’s plan or a higher plan. Refresh your workspace.');
  }
}

async function readBilling(supabase, workspaceId) {
  const { data, error } = await supabase
    .from('workspace_billing_customers')
    .select('stripe_customer_id, stripe_subscription_id, entitlement_payload')
    .eq('workspace_id', workspaceId)
    .maybeSingle();
  if (error)
    refuse('billing_unavailable', 'Your current billing status could not be verified. Try again shortly.', 503);
  return data;
}

async function liveSubscriptions(stripe, customerId) {
  const result = await collectStripePages((params) =>
    stripe.subscriptions.list({ customer: customerId, status: 'all', ...params }),
  );
  if (!result.complete)
    refuse('billing_unavailable', 'Your subscription history could not be completely verified.', 503);
  return result.items.filter(
    (subscription) => !subscription.status || stripeSubscriptionBlocksCheckout(subscription.status),
  );
}

/** Read-only quote. No client supplied price, tier, coupon, or billing status is trusted. */
export async function prepareUpgradeQuote({
  stripe,
  supabase,
  input,
  targetTier,
  discountEligible,
  env = process.env,
  now = new Date(),
}) {
  if (!stripe || !serverManagedBillingEnabled(env) || env.UPGRADE_OFFERS_ENABLED !== 'true') {
    refuse('billing_unavailable', 'Secure upgrade checkout is not available yet. You can still compare plans.', 503);
  }
  const expectedAccount = env.STRIPE_UPGRADE_ACCOUNT_ID?.trim();
  const expectedLive = env.STRIPE_UPGRADE_LIVEMODE;
  if (
    !expectedAccount ||
    !['true', 'false'].includes(expectedLive) ||
    (env.VERCEL_ENV === 'production' && expectedLive !== 'true')
  ) {
    refuse('billing_unavailable', 'Upgrade billing has not been verified for this deployment.', 503);
  }
  const account = await stripe.accounts.retrieve();
  if (account.id !== expectedAccount)
    refuse('billing_unavailable', 'Upgrade billing is unavailable while its account is verified.', 503);
  const priceId = getStripePriceIdByTier(targetTier, input.billingPeriod);
  if (!priceId) refuse('price_unavailable', 'This plan’s selected billing period is not available yet.', 503);
  const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
  if (
    price.livemode !== (expectedLive === 'true') ||
    !(await verifyCheckoutPrice(
      { prices: { retrieve: async () => price } },
      { tier: targetTier, billingPeriod: input.billingPeriod, priceId },
    ))
  ) {
    refuse('price_unavailable', 'This plan’s price could not be verified. Please compare the available plans.', 503);
  }
  const billing = await readBilling(supabase, input.workspaceId);
  let customerId = billing?.stripe_customer_id || '';
  let subscription = null;
  let configurationId = '';
  if (!customerId && (billing?.stripe_subscription_id || checkoutBlockReason(billing))) {
    refuse('billing_unavailable', 'Your existing subscription needs a billing review before it can be changed.', 503);
  }
  if (customerId) {
    const customer = await stripe.customers.retrieve(customerId);
    if (
      customer.deleted ||
      customer.id !== customerId ||
      customer.livemode !== price.livemode ||
      customer.metadata?.workspace_id !== input.workspaceId ||
      hasDiscount(customer)
    ) {
      refuse('billing_unavailable', 'Your billing account needs a review before this upgrade can be quoted.', 503);
    }
    const current = await liveSubscriptions(stripe, customerId);
    if (current.length > 1)
      refuse(
        'billing_unavailable',
        'More than one subscription is on file. Review billing before changing plans.',
        503,
      );
    if (billing?.stripe_subscription_id && !current.some((item) => item.id === billing.stripe_subscription_id)) {
      const recorded = await stripe.subscriptions.retrieve(billing.stripe_subscription_id);
      if (objectId(recorded.customer) !== customerId || !['canceled', 'incomplete_expired'].includes(recorded.status)) {
        refuse(
          'billing_unavailable',
          'Your current subscription could not be reconciled. Review billing before changing plans.',
          503,
        );
      }
    }
    if (current.length === 1) {
      subscription = await stripe.subscriptions.retrieve(current[0].id, {
        expand: ['latest_invoice', 'items.data.price'],
      });
      assertUpgradableSubscription(subscription, { customerId, workspaceId: input.workspaceId, price, targetTier });
      // The existing standard billing portal remains available. This new
      // preselected, anchor-reset confirmation flow needs separate sandbox
      // proof for stale/sibling links, even when it has no coupon.
      if (env.STRIPE_UPGRADE_PAID_CONFIRMATIONS_VERIFIED !== 'true') {
        refuse(
          'paid_confirmation_unverified',
          'Use billing management to review changes to your existing subscription. This direct upgrade confirmation is not available yet.',
          503,
        );
      }
      configurationId = env.STRIPE_UPGRADE_PORTAL_CONFIGURATION_ID?.trim() || '';
      const config = configurationId ? await stripe.billingPortal.configurations.retrieve(configurationId) : null;
      if (!verifiedPortalConfiguration(config, price, configurationId)) {
        refuse(
          'portal_unavailable',
          'A secure confirmation page for this plan change is not configured yet. Please review the available plans.',
          503,
        );
      }
    }
  }
  const requestedCoupon = env.STRIPE_UPGRADE_COUPON_ID?.trim() || '';
  const couponId =
    discountEligible && (await verifyUpgradeCoupon(stripe, requestedCoupon, price, now)) ? requestedCoupon : '';
  const discountPercent = couponId ? 10 : 0;
  return {
    customerId,
    subscription,
    configurationId,
    price,
    couponId,
    offer: {
      attemptId: input.attemptId,
      feature: input.feature,
      targetTier,
      billingPeriod: input.billingPeriod,
      currency: 'USD',
      regularAmountCents: price.unit_amount,
      firstPeriodAmountCents: Math.round(price.unit_amount * (1 - discountPercent / 100)),
      discountPercent,
      checkoutAvailable: true,
      message: [
        discountEligible && !couponId
          ? 'A first-period discount is not currently available. This is the regular price.'
          : '',
        subscription
          ? 'Your existing subscription will be updated after you confirm in Stripe. A new billing period starts then; Stripe shows any credit for unused time and taxes before confirmation.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
  };
}

function returnUrl(env) {
  try {
    const url = new URL(env.PUBLIC_APP_URL || env.VITE_PUBLIC_APP_URL || '');
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    return new URL('/app/billing', url.origin).toString();
  } catch {
    refuse('billing_unavailable', 'The return address for secure billing is not configured.', 503);
  }
}
function checkedSessionUrl(session, kind) {
  try {
    const url = new URL(session?.url);
    if (
      url.protocol === 'https:' &&
      url.hostname === (kind === 'checkout' ? 'checkout.stripe.com' : 'billing.stripe.com') &&
      typeof session.id === 'string' &&
      session.id
    )
      return url.toString();
  } catch {
    /* Unknown is not a safe payment destination. */
  }
  refuse('session_unverified', 'Stripe did not return a verified confirmation address.', 503);
}

async function closeOtherCheckouts(stripe, customerId, intent) {
  const open = await listOpenCheckoutSessions(stripe, customerId);
  if (!open.complete)
    refuse('billing_unavailable', 'Unfinished checkouts could not all be verified. Please retry.', 503);
  const plan = planCheckoutSession(open.sessions, intent);
  const { batch, deferred } = splitExpiryBatch(plan.expire);
  for (const session of batch) {
    try {
      await stripe.checkout.sessions.expire(session.id);
    } catch {
      let reread;
      try {
        reread = await stripe.checkout.sessions.retrieve(session.id);
      } catch {
        /* refuse below */
      }
      if (resolveExpiryFailure(reread) !== 'proceed')
        refuse(
          'billing_unavailable',
          'An earlier checkout may have completed. Refresh your billing before continuing.',
          503,
        );
    }
  }
  if (deferred) refuse('billing_unavailable', 'Older checkouts are still being closed. Please retry shortly.', 503);
  return plan.session;
}

/** Caller holds the SAME workspace lease as the ordinary checkout endpoint. */
export async function createUpgradeCheckout({
  stripe,
  supabase,
  input,
  user,
  quote,
  claimToken,
  env = process.env,
  now = new Date(),
}) {
  const kind = quote.subscription ? 'subscription_update' : 'checkout';
  if (kind === 'subscription_update' && env.STRIPE_UPGRADE_PAID_CONFIRMATIONS_VERIFIED !== 'true') {
    refuse('paid_confirmation_unverified', 'Use billing management to review this subscription change.', 503);
  }
  const destination = returnUrl(env);
  const saved = await offerAction(supabase, input, 'begin_checkout', {
    p_kind: kind,
    p_price_id: quote.price.id,
    p_coupon_id: quote.couponId || null,
    p_discount_percent: quote.offer.discountPercent,
  });
  const attempt = saved.attempt;
  const started = Date.parse(attempt.checkout_started_at);
  if (!Number.isFinite(started) || now.getTime() - started >= 30 * 60_000) {
    refuse(
      'offer_expired',
      'This upgrade request cannot be reopened. Continue on your existing Stripe page or compare plans again.',
    );
  }
  // A portal session cannot be expired via API. Reuse exactly one session
  // for this attempt; never generate another discounted link afterward.
  // This guard limits API reopens only: it does NOT revoke an already-open
  // Stripe page (its expiry can extend with activity). Paid promotions remain
  // separately disabled until stale/sibling-link behavior is sandbox-proven.
  if (kind === 'subscription_update' && now.getTime() - started >= 4 * 60_000) {
    refuse(
      'offer_expired',
      'This upgrade request cannot be reopened. Continue on your existing Stripe page or compare plans again.',
    );
  }
  await assertUpgradeOwner(supabase, input.workspaceId, user.id);
  if (!(await renewCheckoutLock(supabase, input.workspaceId, claimToken))) {
    refuse('billing_busy', 'Another billing request started. Wait a moment and retry.');
  }
  let customerId = quote.customerId;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: user.email || undefined, metadata: { workspace_id: input.workspaceId, owner_user_id: user.id } },
      { idempotencyKey: `xbar-upgrade-customer-${input.workspaceId}-${user.id}` },
    );
    customerId = customer.id;
    // Save the customer BEFORE any payment session exists. A failed write may
    // leave an inert customer, but cannot leave an untracked billable session.
    const { data, error } = await supabase
      .from('workspace_billing_customers')
      .update({ stripe_customer_id: customerId })
      .eq('workspace_id', input.workspaceId)
      .eq('checkout_lock_token', claimToken)
      .select('workspace_id, stripe_customer_id');
    if (error || data?.length !== 1 || data[0].stripe_customer_id !== customerId) {
      refuse('billing_unavailable', 'The billing account could not be saved. Please retry.', 503);
    }
  }
  const intent = {
    workspaceId: input.workspaceId,
    tier: quote.offer.targetTier,
    seatCount: 1,
    billingPeriod: input.billingPeriod,
    priceId: quote.price.id,
    offerAttemptId: input.attemptId,
    couponId: quote.couponId,
  };
  const existingSession = await closeOtherCheckouts(stripe, customerId, intent);
  const current = await liveSubscriptions(stripe, customerId);
  if (kind === 'checkout' ? current.length !== 0 : current.length !== 1 || current[0].id !== quote.subscription.id) {
    refuse(
      'billing_changed',
      'Your subscription changed while this offer was opening. Refresh billing before continuing.',
    );
  }
  await assertUpgradeOwner(supabase, input.workspaceId, user.id);
  if (!(await renewCheckoutLock(supabase, input.workspaceId, claimToken))) {
    refuse('billing_busy', 'Another billing request started. Wait a moment and retry.');
  }
  // Date and key are stored before the Stripe request; retry after a network
  // error or failed database save has identical parameters and one session.
  const options = { idempotencyKey: `xbar-upgrade-${input.attemptId}` };
  let session;
  if (kind === 'subscription_update') {
    const latest = await stripe.subscriptions.retrieve(quote.subscription.id, {
      expand: ['latest_invoice', 'items.data.price'],
    });
    assertUpgradableSubscription(latest, {
      customerId,
      workspaceId: input.workspaceId,
      price: quote.price,
      targetTier: quote.offer.targetTier,
    });
    if (
      latest.items.data[0].id !== quote.subscription.items.data[0].id ||
      objectId(latest.items.data[0].price) !== objectId(quote.subscription.items.data[0].price)
    ) {
      refuse('billing_changed', 'Your subscription changed. Refresh billing before accepting an upgrade.');
    }
    if (attempt.session_id) session = { id: attempt.session_id, url: attempt.session_url };
    else
      session = await stripe.billingPortal.sessions.create(
        {
          customer: customerId,
          configuration: quote.configurationId,
          return_url: destination,
          flow_data: {
            type: 'subscription_update_confirm',
            after_completion: { type: 'redirect', redirect: { return_url: `${destination}?checkout=success` } },
            subscription_update_confirm: {
              subscription: quote.subscription.id,
              items: [{ id: quote.subscription.items.data[0].id, price: quote.price.id, quantity: 1 }],
              ...(quote.couponId ? { discounts: [{ coupon: quote.couponId }] } : {}),
            },
          },
        },
        options,
      );
  } else {
    session = existingSession;
    if (!session && attempt.session_id) {
      // Expired/complete sessions are never replaced under the same offer.
      refuse('offer_expired', 'This checkout is no longer open. Refresh billing or compare plans again.');
    }
    if (!session)
      session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          payment_method_types: ['card'],
          customer: customerId,
          line_items: [{ price: quote.price.id, quantity: 1 }],
          expires_at: Math.floor(started / 1000) + 60 * 60,
          success_url: `${destination}?checkout=success`,
          cancel_url: `${destination}?checkout=cancelled`,
          ...(quote.couponId ? { discounts: [{ coupon: quote.couponId }] } : {}),
          metadata: {
            workspace_id: input.workspaceId,
            workspace_tier: quote.offer.targetTier,
            workspace_seats: '1',
            workspace_billing_period: input.billingPeriod,
            workspace_price_id: quote.price.id,
            owner_user_id: user.id,
            upgrade_offer_attempt_id: input.attemptId,
            upgrade_offer_coupon_id: quote.couponId,
          },
          subscription_data: { metadata: { workspace_id: input.workspaceId, workspace_tier: quote.offer.targetTier } },
        },
        options,
      );
  }
  const url = checkedSessionUrl(session, kind);
  await offerAction(supabase, input, 'save_session', { p_session_id: session.id, p_session_url: url });
  return { url, kind };
}
