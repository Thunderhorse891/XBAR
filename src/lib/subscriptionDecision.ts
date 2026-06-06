import type { SubscriptionTier } from '../types/xbar.js';

export const planOutcomes: Record<SubscriptionTier, string[]> = {
  Starter: [
    'Build a dependable horse command file',
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
    'Keep the full operation visible from one command center',
  ],
  Enterprise: [
    'Scale the same operating system across up to 60 team seats',
    'Support high-volume document and shared-access workflows',
    'Increase capacity without rebuilding the ranch record',
  ],
};

export function getCheckoutReadiness(params: {
  canManageBilling: boolean;
  hasManagedIdentity: boolean;
  hasPaymentLink: boolean;
  checkoutInProgress: boolean;
}) {
  if (!params.canManageBilling) return { ready: false, reason: 'Ask a workspace owner to change plans.' };
  if (params.checkoutInProgress) return { ready: false, reason: 'A secure checkout session is already opening.' };
  if (!params.hasManagedIdentity && !params.hasPaymentLink) return { ready: false, reason: 'Sign in to this workspace before choosing a paid plan.' };
  return { ready: true, reason: 'Your plan changes only after secure checkout is complete.' };
}

export function recommendedTier(currentTier: SubscriptionTier, requestedTier?: SubscriptionTier) {
  if (requestedTier) return requestedTier;
  const order: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];
  return order[Math.min(order.indexOf(currentTier) + 1, order.length - 1)];
}
