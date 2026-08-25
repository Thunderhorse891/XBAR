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

/**
 * Statuses where a Stripe subscription object still exists and can resume
 * billing the customer.
 *
 * This is a different question from entitlement, and collapsing the two caused
 * a real defect. `paused` and `unpaid` both map to 'Inactive' — correctly, they
 * carry no paid access — but Stripe keeps the subscription: a paused one
 * resumes once payment details are added, and an unpaid one's invoices can be
 * reopened and paid (node_modules/stripe/types/Subscriptions.d.ts). `incomplete`
 * is the same shape: the subscription exists and its first invoice can still be
 * paid.
 *
 * So a workspace in any of these has a subscription that may start charging
 * again. Offering checkout there creates a SECOND `mode: 'subscription'`
 * session beside the first, and the customer is billed twice while two streams
 * of webhooks fight over one entitlement record.
 *
 * `canceled` and `incomplete_expired` are terminal — nothing can revive them —
 * so buying again is exactly right there.
 */
export const RECOVERABLE_STRIPE_STATUSES = Object.freeze(['past_due', 'unpaid', 'paused', 'incomplete']);

/** Statuses where the subscription is over and cannot bill again. */
export const TERMINAL_STRIPE_STATUSES = Object.freeze(['canceled', 'incomplete_expired']);

/**
 * True when a status leaves a subscription that could bill the customer again.
 *
 * Fails toward `true`, which is the opposite direction from
 * `billingStateForStripeStatus`, and deliberately so — the two protect against
 * opposite harms. Entitlement fails closed because the risk is granting access
 * nobody paid for. Here the risk is charging a customer twice for the same
 * workspace, so an unrecognized status is treated as a live subscription and
 * checkout is withheld. A wrongly withheld purchase costs a support message; a
 * duplicate subscription takes money and needs a refund.
 *
 * The empty case is not "unknown": no status means no Stripe subscription at
 * all, which is every new workspace. Those must be able to buy.
 */
export function isRecoverableStripeStatus(status) {
  const normalized = String(status ?? '')
    .trim()
    .toLowerCase();

  if (!normalized) return false;
  if (ENTITLED_STRIPE_STATUSES.includes(normalized)) return false;
  if (TERMINAL_STRIPE_STATUSES.includes(normalized)) return false;
  return true;
}

/**
 * True when a STORED entitlement payload describes a subscription Stripe can
 * still bill.
 *
 * The same question as `isRecoverableStripeStatus`, asked of a row in the
 * database rather than of a webhook. It exists so the server can enforce the
 * no-duplicate-checkout rule itself: the client refusing to offer the button is
 * a courtesy, not a control — an admin can call the endpoint directly, and an
 * older cached bundle will.
 *
 * Legacy rows written by the previous mapper carry no `subscriptionRecoverable`
 * field, and every one of them that was `past_due` or `unpaid` was stored as
 * `Past Due`. Reading an absent field as "not recoverable" would re-open
 * duplicate checkout for that entire population, so the billing state answers
 * for them. This mirrors `isSubscriptionRecoverable` in
 * `src/lib/subscriptionDecision.ts` exactly; the two must agree.
 */
export function isStoredSubscriptionRecoverable(entitlementPayload) {
  if (!entitlementPayload || typeof entitlementPayload !== 'object') return false;
  if (typeof entitlementPayload.subscriptionRecoverable === 'boolean') {
    return entitlementPayload.subscriptionRecoverable;
  }
  return entitlementPayload.billingState === 'Past Due';
}

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
  if (isEntitledBillingState(billingState)) return tier;
  // 'Past Due', 'Inactive', and any unrecognized value stored in the column.
  return BASELINE_TIER;
}

/** The two states that grant the purchased tier. */
export function isEntitledBillingState(billingState) {
  return billingState === 'Active' || billingState === 'Manual Billing';
}

/*
 * Why a workspace may not start a NEW subscription, or null when it may.
 *
 * Two failures sat either side of the earlier guard, and both are about the
 * same missing distinction: an open Checkout Session is not a subscription.
 *
 *   - `api/stripe/checkout.js` writes an `incomplete` profile the moment a
 *     session is created, with an EMPTY `stripe_subscription_id`. Nothing
 *     clears it if the customer closes the tab, so keying the refusal on the
 *     entitlement payload alone locked that workspace out of buying anything,
 *     for good. A safety guard that stops people paying is worse than the harm
 *     it was added for.
 *
 *   - An actively paying workspace choosing a different tier had
 *     `subscriptionRecoverable: false`, so it sailed through and got a SECOND
 *     `mode: 'subscription'` session beside the one it was already paying for.
 *     The billing screen enables those buttons, so this is the ordinary upgrade
 *     path, not an edge case.
 *
 * So the question is not "is this recoverable" but "does a subscription Stripe
 * can still act on already exist". A real subscription id is what says one
 * does; terminal states — canceled, expired — leave the id behind but nothing
 * to duplicate, so those workspaces must be able to buy again.
 */
export function checkoutBlockReason(billingCustomer) {
  const subscriptionId = String(billingCustomer?.stripe_subscription_id ?? '').trim();
  // No subscription: a new workspace, or a checkout session nobody completed.
  if (!subscriptionId) return null;

  const payload = billingCustomer?.entitlement_payload;
  if (isEntitledBillingState(payload?.billingState)) return 'subscription_active';
  if (isStoredSubscriptionRecoverable(payload)) return 'subscription_recoverable';

  /*
   * Past this point a subscription id exists and the payload has not explained
   * it away — so the payload is the thing in doubt, not the subscription.
   *
   * `entitlement_payload` defaults to `{}` in the schema, and a row can carry a
   * real subscription id beside that empty object. Reading "no entitled state,
   * not recoverable" as "proven canceled" turned the least informative case
   * into the most permissive one, and the only reliable evidence on the row —
   * a non-empty subscription id — says a subscription exists.
   *
   * Terminal is therefore something the payload has to ASSERT, which both
   * writers do: `buildSubscriptionProfile` and the reconciliation migration
   * both set `subscriptionRecoverable` explicitly. An absent flag beside a live
   * id is unknown, and unknown fails toward not charging anyone twice.
   */
  if (payload && typeof payload === 'object' && typeof payload.subscriptionRecoverable === 'boolean') {
    // Explicitly not recoverable: canceled or expired. Nothing left to
    // duplicate, and a former customer must be able to come back.
    return null;
  }

  return 'subscription_unverified';
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
