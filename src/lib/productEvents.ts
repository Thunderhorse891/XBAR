export const productEventNames = {
  activationAction: 'activation.action_clicked',
  activationCollapsed: 'activation.guide_collapsed',
  checkoutStarted: 'billing.checkout_started',
  checkoutRedirected: 'billing.checkout_redirected',
  checkoutFailed: 'billing.checkout_failed',
  followUpAction: 'sales.follow_up_action',
  buyerMomentumOpened: 'sales.buyer_momentum_opened',
} as const;

export type ProductEventName = typeof productEventNames[keyof typeof productEventNames];

export function productEvent(eventName: ProductEventName, payload: Record<string, unknown> = {}) {
  return { eventName, payload };
}
