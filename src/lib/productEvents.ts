export const productEventNames = {
  activationAction: 'activation.action_clicked',
  activationCollapsed: 'activation.guide_collapsed',
  activationFirstValueReached: 'activation.first_value_reached',
  checkoutStarted: 'billing.checkout_started',
  checkoutRedirected: 'billing.checkout_redirected',
  checkoutFailed: 'billing.checkout_failed',
  landingCtaClicked: 'acquisition.landing_cta_clicked',
  landingPlanSelected: 'acquisition.landing_plan_selected',
  localWorkspaceEntered: 'acquisition.local_workspace_entered',
  followUpAction: 'sales.follow_up_action',
  buyerMomentumOpened: 'sales.buyer_momentum_opened',
} as const;

export type ProductEventName = typeof productEventNames[keyof typeof productEventNames];

export function productEvent(eventName: ProductEventName, payload: Record<string, unknown> = {}) {
  return { eventName, payload };
}
