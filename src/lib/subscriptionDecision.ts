import type { SubscriptionTier } from '../types/xbar.js';

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
   * - 'external': this is a native store build, so no purchase happens in the
   *   app at all. Never ready — see the nativeApp note below.
   */
  mode: 'checkout' | 'manual' | 'external';
  reason: string;
};

export function getCheckoutReadiness(params: {
  billingEnabled: boolean;
  canManageBilling: boolean;
  hasManagedIdentity: boolean;
  hasPaymentLink: boolean;
  checkoutInProgress: boolean;
  /**
   * True inside an iOS/Android store build. Checked before everything else and
   * regardless of role or Stripe configuration: App Store Review Guideline
   * 3.1.1 requires digital subscriptions sold inside the app to use In-App
   * Purchase, so a store build offers no purchase path rather than sending the
   * customer to Stripe. Optional, so web callers are unaffected.
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
  if (params.hasPaymentLink)
    return { ready: true, mode: 'checkout', reason: 'Secure checkout opens next. XBAR never stores raw card numbers.' };
  if (!params.billingEnabled) {
    return {
      ready: false,
      mode: 'manual',
      reason: 'Online checkout is not configured. Contact support/manual billing required.',
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
