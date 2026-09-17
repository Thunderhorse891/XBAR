import type { SubscriptionProfile, SubscriptionTier } from '../types/xbar.js';
import { buildSubscriptionForTier, subscriptionTierConfig } from './xbarRuntime.js';

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
   * - 'external': this is a native store build, so no purchase happens in the
   *   app at all. Never ready — see the nativeApp note below.
   */
  mode: 'checkout' | 'manual' | 'recover' | 'external';
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
  /**
   * True when the workspace is already paying for a plan.
   *
   * A different rule from `subscriptionRecoverable` and it has to be checked
   * too: an actively paying workspace is NOT recoverable, so it passed the
   * check below and its other-tier buttons opened a second
   * `mode: 'subscription'` session beside the one it was already paying for.
   * The billing screen enables those buttons, so that is the ordinary upgrade
   * path — the most common way anyone would have hit it.
   */
  subscriptionActive?: boolean;
  /**
   * Whether a Stripe billing portal is configured for this deployment.
   *
   * Only the wording depends on it, never the decision. A workspace with a
   * live subscription is refused checkout whether or not a portal exists —
   * but telling someone to "change plans in the billing portal" when the
   * deployment has no portal sends them looking for a door that is not there.
   */
  hasBillingPortal?: boolean;
  /**
   * True inside an iOS/Android store build.
   *
   * Checked before everything else and regardless of role or Stripe
   * configuration: App Store Review Guideline 3.1.1 requires a digital
   * subscription sold inside the app to go through In-App Purchase, so a store
   * build offers no purchase path at all rather than sending the customer to
   * Stripe. Apple forbids the call to action, not merely the charge, so this
   * refuses the button as well as the navigation.
   *
   * The gate lives here, in the one function every purchase entry point
   * already consults, so no combination of role and Stripe configuration can
   * reopen a path around it — and so it is one tested decision rather than a
   * condition scattered through JSX.
   *
   * Optional, so every web caller is unaffected: a test asserts the web result
   * is identical with the flag absent and with it explicitly false.
   */
  nativeApp?: boolean;
}): CheckoutReadiness {
  if (params.nativeApp)
    return {
      ready: false,
      mode: 'external',
      reason: 'Plans are managed outside the app. Your current plan and workspace are unchanged.',
    };
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
  if (params.subscriptionActive) {
    return {
      ready: false,
      mode: 'manual',
      reason: params.hasBillingPortal
        ? 'This workspace already has an active subscription. Change plans in the billing portal so the existing one is updated rather than duplicated.'
        : 'This workspace already has an active subscription. Changing it has to happen in Stripe, because a new checkout here would bill you a second time alongside it.',
    };
  }
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

/**
 * Where a workspace that already has a subscription is actually sent.
 *
 * `getCheckoutReadiness` refuses checkout for these workspaces, and refusing
 * was the whole of the answer: the primary action rendered disabled, the plan
 * cards returned without navigating, and `stripeConfig.billingPortalUrl` was
 * read from the environment and consumed by nothing. So the copy told a paying
 * customer to change their plan in the billing portal while the app offered no
 * way to reach one — every upgrade, downgrade, payment recovery and
 * cancellation was a dead end.
 *
 * A refusal owes the customer somewhere to go. This is that somewhere, and it
 * is a separate question from readiness on purpose: readiness answers whether
 * a NEW subscription may be created, which stays false here. Routing to the
 * portal cannot create a second subscription — Stripe's portal operates on the
 * one that already exists, which is exactly why it is the safe destination.
 *
 * Returns null when there is nothing to manage, when no portal is configured
 * (a link to nowhere is worse than a disabled button), or when the viewer may
 * not manage billing anyway.
 */
export function getBillingPortalAction(params: {
  portalUrl: string;
  canManageBilling: boolean;
  subscriptionActive?: boolean;
  subscriptionRecoverable?: boolean;
  /**
   * True inside an iOS/Android store build. Suppresses the portal entirely.
   *
   * Gating `getCheckoutReadiness` alone was not enough, and this is the hole it
   * left. The portal is a SECOND external purchase path: `.env.example`
   * describes it as where a workspace that already subscribes goes to "upgrade,
   * downgrade, settle a failed payment, or cancel", and the upgrade half of
   * that is a digital purchase. Worse, it is the PRIMARY action for exactly the
   * customers the checkout gate turns away — an active or recoverable
   * subscription — so closing checkout and leaving this open would have routed
   * every paying native customer to Stripe through the one button still lit.
   *
   * Suppressed rather than relabelled because a single URL does both the
   * purchase and the management, so there is no way to offer one without the
   * other. A store build therefore shows plan state and says billing is handled
   * outside the app, which is what it already tells anyone trying to buy.
   */
  nativeApp?: boolean;
}): { url: string; label: string } | null {
  if (params.nativeApp) return null;
  if (!params.canManageBilling) return null;
  const url = params.portalUrl.trim();
  if (!url) return null;
  if (params.subscriptionActive) return { url, label: 'Manage your subscription' };
  if (params.subscriptionRecoverable) return { url, label: 'Settle your payment' };
  return null;
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
/**
 * Whether a Stripe subscription still exists that could bill this workspace.
 *
 * Reads the stored flag when the profile has one. A profile written before the
 * field existed does not, and the fallback is the whole point of this function:
 * the previous mapper stored `past_due`, `unpaid` AND `incomplete_expired` as
 * 'Past Due' and never produced 'Inactive' at all, so every legacy lapsed
 * workspace is sitting in 'Past Due' with no flag — and two of those three
 * statuses leave a subscription Stripe can still collect on.
 *
 * Before the flag existed the billing screen blocked checkout on 'Past Due'
 * outright. Replacing that test with a field those rows do not carry re-enabled
 * checkout for all of them, which is exactly the duplicate billing the flag was
 * added to prevent. So an absent flag falls back to the billing state, which
 * restores the old behaviour for legacy rows and costs nothing for new ones.
 *
 * 'Past Due' is itself the evidence of a live subscription — it is the state a
 * workspace is put in *because* Stripe is still trying to collect — so no
 * separate check for Stripe linkage is needed.
 */
export function isSubscriptionRecoverable(subscription: SubscriptionProfile): boolean {
  if (typeof subscription.subscriptionRecoverable === 'boolean') {
    return subscription.subscriptionRecoverable;
  }
  /*
   * ABSENT and MALFORMED are different questions, and only one of them has a
   * safe fallback.
   *
   * Absent is the legacy population described above: no flag was ever written,
   * and the billing state answers for them. Present-but-not-a-boolean is a
   * value that was written and is now unreadable — a hand-edited or corrupted
   * backup carrying `"false"` or `{}` — and the billing state cannot answer for
   * it, because a paused or unpaid subscription is stored as 'Inactive' rather
   * than 'Past Due'. Falling through to that test returned false and offered a
   * payment link to a workspace Stripe is still billing.
   *
   * The client is the only gate on that path. A managed checkout is refused
   * again by `checkoutBlockReason`, which already answers `subscription_
   * unverified` for exactly this shape — but a hosted payment link is a
   * redirect straight to Stripe, so nothing downstream gets a second opinion.
   *
   * Unknown therefore resolves the way every other billing unknown in this
   * codebase resolves: toward not charging anyone twice.
   */
  if (subscription.subscriptionRecoverable !== undefined && subscription.subscriptionRecoverable !== null) {
    return true;
  }
  return subscription.billingState === 'Past Due';
}

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
/**
 * Coerce a stored tier to one this build actually sells.
 *
 * Persisted state and imported backups are cast to `SubscriptionProfile`
 * without validation, so an old, renamed, or hand-edited tier string reaches
 * the app as if it were real. Anything that indexes `subscriptionTierConfig` with it
 * gets `undefined` and throws on the first field it reads — the billing screen
 * does exactly that with `purchasedTier` when a lapsed plan is selected, so a
 * single bad string in a restored backup takes the whole route down.
 *
 * Falls back to the baseline for the same reason `normalizeBillingState` falls
 * to 'Inactive': an unreadable value must decay to the least-privileged
 * option, never to a paid one.
 */
export function normalizeTier(value: unknown): SubscriptionTier {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(subscriptionTierConfig, value)
    ? (value as SubscriptionTier)
    : 'Starter';
}

export function clampSubscriptionToEntitlement(subscription: SubscriptionProfile): SubscriptionProfile {
  if (isEntitledBillingState(subscription.billingState)) return subscription;

  return {
    ...buildSubscriptionForTier(subscription, 'Starter'),
    // Normalized here too, not only at restore. This function is the other
    // producer of purchasedTier, and it is the value the billing screen indexes
    // the plan tables with — leaving it unchecked in one of the two producers
    // is how the crash would have come back.
    purchasedTier: normalizeTier(subscription.purchasedTier ?? subscription.tier),
    monthlyRate: subscription.monthlyRate,
    billingState: subscription.billingState,
  };
}
