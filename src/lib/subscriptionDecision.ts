import type { SubscriptionProfile, SubscriptionTier } from '../types/xbar.js';
import { buildSubscriptionForTier } from './xbarRuntime.js';

export const planOutcomes: Record<SubscriptionTier, string[]> = {
  Starter: [
    'Build a dependable horse record',
    'Keep care and source documents together',
    'See weather alongside daily operations',
  ],
  Professional: [
    'Coordinate a small operating team',
    'Prepare controlled buyer-ready profiles',
    'Share approved documents without exposing the workspace',
  ],
  'Ranch Ops': [
    'Run care, breeding, assets, reminders, and spend in one rhythm',
    'Support a working ranch team with substantially more capacity',
    'Keep the full operation visible from one dashboard',
  ],
  Enterprise: [
    'Scale the same operating system across up to 60 team seats',
    'Support high-volume document and shared-access workflows',
    'Increase capacity without rebuilding the ranch record',
  ],
};

export type CheckoutReadiness = {
  ready: boolean;
  /**
   * How the plan change happens when ready:
   * - 'checkout': a secure Stripe checkout (managed session or payment link) completes first.
   * - 'manual': online checkout is not configured, so an admin/manual billing
   *   state must explicitly activate the plan before capacity changes.
   * - 'recover': a subscription already exists and can still bill the customer.
   *   Buying again would create a second subscription beside it, so this mode
   *   never offers checkout.
   */
  mode: 'checkout' | 'manual' | 'recover';
  reason: string;
};

export function getCheckoutReadiness(params: {
  billingEnabled: boolean;
  canManageBilling: boolean;
  hasManagedIdentity: boolean;
  hasPaymentLink: boolean;
  checkoutInProgress: boolean;
  /**
   * True when a Stripe subscription still exists that could bill again.
   *
   * Not the same as 'Past Due'. Checking only that state missed `paused` and
   * `unpaid`, which map to 'Inactive' yet leave a recoverable subscription:
   * Stripe resumes a paused one once payment details are added and reopens an
   * unpaid one's invoices. Those workspaces got enabled plan buttons, so a
   * second subscription could be created beside the first.
   */
  subscriptionRecoverable?: boolean;
}): CheckoutReadiness {
  if (!params.canManageBilling)
    return { ready: false, mode: 'checkout', reason: 'Ask a workspace owner to change plans.' };
  if (params.checkoutInProgress)
    return { ready: false, mode: 'checkout', reason: 'A secure checkout session is already opening.' };
  // Before any branch that could open checkout, including the payment-link one.
  //
  // These workspaces still have a Stripe subscription that can charge them;
  // api/stripe/checkout.js creates a `mode: 'subscription'` session, so
  // completing one here would leave the customer paying for two subscriptions
  // at once, with both emitting webhooks that fight over the same entitlement
  // record. Refusing is the only safe answer available in the app — resuming or
  // settling the existing subscription happens through Stripe, not here.
  if (params.subscriptionRecoverable) {
    return {
      ready: false,
      mode: 'recover',
      reason:
        'This workspace still has a subscription with Stripe that has not been settled or resumed. Sort that one out through the card issuer or Stripe’s billing email — starting a new checkout here would bill you twice.',
    };
  }
  if (params.hasPaymentLink)
    return { ready: true, mode: 'checkout', reason: 'Secure checkout opens next. XBAR never stores raw card numbers.' };
  if (!params.billingEnabled) {
    // Stripe is not configured for this deployment. Say that plainly rather
    // than implying the customer has a manual route they can take: there is no
    // action available to them here, and pointing them at "manual billing"
    // invites a support round-trip that ends the same way.
    return {
      ready: false,
      mode: 'manual',
      reason: 'Billing is not configured yet, so plans cannot be purchased in the app.',
    };
  }
  if (!params.hasManagedIdentity)
    return { ready: false, mode: 'checkout', reason: 'Sign in to this workspace before choosing a paid plan.' };
  return { ready: true, mode: 'checkout', reason: 'Your plan changes only after secure checkout is complete.' };
}

export function recommendedTier(currentTier: SubscriptionTier, requestedTier?: SubscriptionTier) {
  if (requestedTier) return requestedTier;
  const order: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
  return order[Math.min(order.indexOf(currentTier) + 1, order.length - 1)];
}

/**
 * Whether a billing state means the workspace is actually on a paid plan.
 *
 * Mirrors `entitledTierForBillingState` on the server: 'Active' is paying, and
 * 'Manual Billing' is an operator's deliberate grant. 'Past Due' and 'Inactive'
 * are not.
 *
 * This exists because a plan's *price* was being used as the signal instead.
 * `monthlyRate > 0` reads as "there is a paid plan here", but the stored rate is
 * the price of the plan that was bought, which survives a cancellation — so a
 * canceled Starter subscription looked like a current Starter subscription, its
 * checkout button was disabled as "your current plan", and the customer could
 * not resubscribe to the tier they had just lost.
 */
export function isEntitledBillingState(billingState: SubscriptionProfile['billingState']): boolean {
  return billingState === 'Active' || billingState === 'Manual Billing';
}

/**
 * True when this workspace is on a paid plan at all.
 *
 * Both conditions are load-bearing, and each covers a case the other misses:
 *
 *   - the billing state must be entitled, or a canceled subscription would
 *     still read as configured;
 *   - the rate must be non-zero, because a freshly initialized workspace is
 *     seeded as Starter / 'Manual Billing' / rate 0. That seed is a setup
 *     state, not a purchase, and reading it as one tells a brand-new workspace
 *     its billing is already handled.
 *
 * The rate is a *supporting* condition, not the signal. Reading it alone —
 * which is what these screens used to do — is what let a lapsed plan look
 * current.
 */
export function hasActivePaidPlan(subscription: SubscriptionProfile): boolean {
  return isEntitledBillingState(subscription.billingState) && subscription.monthlyRate > 0;
}

/** True when `tier` specifically is the plan this workspace is paying for. */
export function isCurrentPaidPlan(subscription: SubscriptionProfile, tier: SubscriptionTier): boolean {
  return hasActivePaidPlan(subscription) && subscription.tier === tier;
}

/**
 * Reduce a subscription to what its billing state actually supports.
 *
 * A stored profile can claim entitlements its billing state does not carry. It
 * may predate the effective-tier fix, or simply be the last profile written
 * before the subscription lapsed — a canceled workspace may never receive
 * another webhook to correct it. That object is what every client gate reads,
 * so clamping it on the way in means no stale payload can grant more than the
 * billing state allows, whatever produced it.
 *
 * The purchased tier and its rate are carried through, so a billing screen can
 * still name the plan that lapsed. Usage counts survive too: only the limits
 * change, so "23 of 5 horses" reads correctly after a downgrade.
 */
export function clampSubscriptionToEntitlement(subscription: SubscriptionProfile): SubscriptionProfile {
  if (isEntitledBillingState(subscription.billingState)) return subscription;

  return {
    ...buildSubscriptionForTier(subscription, 'Starter'),
    purchasedTier: subscription.purchasedTier ?? subscription.tier,
    monthlyRate: subscription.monthlyRate,
    billingState: subscription.billingState,
  };
}
