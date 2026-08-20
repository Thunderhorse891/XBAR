/*
 * The single place that decides what a billing status means.
 *
 * Before this module the mapping lived inline and had a catch-all: any status
 * that was not recognized became "Manual Billing", and Manual Billing grants
 * the full paid tier. That made the *default* outcome the most permissive one.
 * A canceled subscription, a paused one, and a typo all landed in the same
 * bucket as a deliberately comped account, so a workspace kept every paid
 * feature after it stopped paying — and `api/stripe/checkout.js` writes a
 * profile with status `incomplete` when a checkout session is *created*, which
 * meant opening the checkout page granted the tier before any money moved.
 *
 * Two rules fix that class of problem rather than the individual cases:
 *
 *   1. This mapper can never return 'Manual Billing'. That state is an operator
 *      decision written deliberately, so it must not be reachable by accident
 *      from a payment processor's status string.
 *   2. Anything not explicitly listed as entitled is not entitled. New Stripe
 *      statuses, empty strings and garbage all fail to the baseline instead of
 *      to full access.
 */

/** Lowest-capability plan. Used whenever a workspace is not entitled to more. */
export const BASELINE_TIER = 'Starter';

/**
 * Paying (or in an agreed trial), so the purchased tier applies.
 * `trialing` is included deliberately: Stripe reports it for a subscription
 * that exists and is in good standing, which is what a trial is meant to be.
 */
export const ENTITLED_STRIPE_STATUSES = Object.freeze(['active', 'trialing']);

/**
 * The subscription exists but payment is failing. Distinct from inactive on
 * purpose: the workspace has not walked away, so it keeps its records and its
 * account and drops to the baseline feature set until billing recovers, rather
 * than being treated as though it never subscribed.
 */
export const PAST_DUE_STRIPE_STATUSES = Object.freeze(['past_due']);

/**
 * Explicitly not entitled to paid features.
 *
 * `incomplete` and `incomplete_expired` mean the first payment never
 * succeeded. `canceled` and `paused` mean it is over or suspended. `unpaid`
 * means Stripe gave up collecting. None of these should carry paid access, and
 * none of them are "manual billing".
 *
 * This list is documentation, not control flow — the resolver treats every
 * status outside the two lists above as inactive, so an unrecognized or future
 * status behaves like these without needing to be added here first.
 */
export const INACTIVE_STRIPE_STATUSES = Object.freeze([
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'canceled',
  'paused',
]);

/** Every billing state that may be stored on a workspace profile. */
export const BILLING_STATES = Object.freeze(['Active', 'Past Due', 'Manual Billing', 'Inactive']);

/**
 * Map a Stripe subscription status onto a stored billing state.
 *
 * Never returns 'Manual Billing' — see rule 1 above.
 */
export function billingStateForStripeStatus(status) {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase();

  if (ENTITLED_STRIPE_STATUSES.includes(normalized)) return 'Active';
  if (PAST_DUE_STRIPE_STATUSES.includes(normalized)) return 'Past Due';
  return 'Inactive';
}

/** True when a stored billing state is one this codebase actually defines. */
export function isKnownBillingState(billingState) {
  return BILLING_STATES.includes(billingState);
}

/**
 * The tier a workspace is actually entitled to, given its purchased tier and
 * its billing state.
 *
 * 'Manual Billing' grants the tier because it is an operator's explicit
 * decision to comp or invoice an account outside Stripe. It is safe *only*
 * because nothing derives it automatically; if that ever changes, this is the
 * line that turns the mistake into free paid access.
 */
export function entitledTierForBillingState(tier, billingState) {
  if (billingState === 'Active' || billingState === 'Manual Billing') return tier;
  // 'Past Due', 'Inactive', and any unrecognized value stored in the column.
  return BASELINE_TIER;
}

/**
 * Which tier a Stripe webhook should write when the event's price id may not
 * map to a known tier.
 *
 * The asymmetry here is the point. Granting access needs to know what was
 * bought: an unrecognized price id means STRIPE_PRICE_ID_* is misconfigured for
 * this deployment, and guessing is wrong in both directions — defaulting to
 * Starter silently downgrades someone who paid for more, while picking anything
 * else hands out access nobody bought. So an entitling status with an unknown
 * price refuses, writes nothing, and leaves the event unprocessed for an
 * operator to see in Stripe's delivery log.
 *
 * Withdrawing access needs no such lookup, and refusing it is the more
 * dangerous failure. A subscription canceled after its price was retired — or
 * while the env var was briefly wrong — would otherwise be rejected, leaving
 * the previous Active record in place so every entitlement check keeps granting
 * the old paid tier, with Stripe's retries unable to correct it until someone
 * fixes configuration. The stored tier is what the workspace is losing, so it
 * is carried forward and the billing state does the downgrade.
 *
 * @param {{ status: unknown, mappedTier: string | null | undefined, storedTier: string | null | undefined }} params
 */
export function resolveWebhookTier({ status, mappedTier, storedTier }) {
  const billingState = billingStateForStripeStatus(status);

  if (mappedTier) {
    return { ok: true, tier: mappedTier, billingState };
  }

  if (billingState === 'Active') {
    return { ok: false, billingState };
  }

  return { ok: true, tier: storedTier || BASELINE_TIER, billingState };
}
