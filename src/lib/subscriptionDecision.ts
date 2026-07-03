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
   * - 'direct': no online checkout is configured, so the plan is applied to the
   *   workspace immediately and billing is arranged outside the app.
   */
  mode: 'checkout' | 'direct';
  reason: string;
};

export function getCheckoutReadiness(params: {
  billingEnabled: boolean;
  canManageBilling: boolean;
  hasManagedIdentity: boolean;
  hasPaymentLink: boolean;
  checkoutInProgress: boolean;
}): CheckoutReadiness {
  if (!params.canManageBilling) return { ready: false, mode: 'checkout', reason: 'Ask a workspace owner to change plans.' };
  if (params.checkoutInProgress) return { ready: false, mode: 'checkout', reason: 'A secure checkout session is already opening.' };
  if (params.hasPaymentLink) return { ready: true, mode: 'checkout', reason: 'Secure checkout opens next. XBAR never stores raw card numbers.' };
  if (!params.billingEnabled) {
    return {
      ready: true,
      mode: 'direct',
      reason: 'The plan applies to this workspace right away. Online checkout is not set up yet, so billing is arranged directly.',
    };
  }
  if (!params.hasManagedIdentity) return { ready: false, mode: 'checkout', reason: 'Sign in to this workspace before choosing a paid plan.' };
  return { ready: true, mode: 'checkout', reason: 'Your plan changes only after secure checkout is complete.' };
}

export function recommendedTier(currentTier: SubscriptionTier, requestedTier?: SubscriptionTier) {
  if (requestedTier) return requestedTier;
  const order: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
  return order[Math.min(order.indexOf(currentTier) + 1, order.length - 1)];
}
