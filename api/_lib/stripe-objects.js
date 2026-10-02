/*
 * Readers for the Stripe fields that moved between API versions.
 *
 * Both handlers pin apiVersion 2026-02-25.clover. Since 2025-03-31 a
 * subscription's billing period lives on its items
 * (`items.data[n].current_period_end`), not at the top level, and an invoice
 * names its subscription under `parent.subscription_details.subscription`
 * rather than `invoice.subscription`.
 *
 * Code written against the old shape does not fail on a current payload: it
 * reads `undefined` and carries on. That is how the renewal date came to be
 * stored blank for every current purchase (audit F14) and how a dunning notice
 * could lose its way to the workspace. Each reader prefers the current location
 * and still accepts the old one, so a replayed legacy event resolves too.
 */

function positiveSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * The end of the billing period, in Unix seconds, or null when Stripe did not
 * say. Prefers the line item the entitlement was decided from, then any item,
 * then the pre-2025 top-level field.
 */
export function subscriptionPeriodEnd(subscription, lineItem) {
  const fromLineItem = positiveSeconds(lineItem?.current_period_end);
  if (fromLineItem) return fromLineItem;
  const items = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  for (const item of items) {
    const fromItem = positiveSeconds(item?.current_period_end);
    if (fromItem) return fromItem;
  }
  return positiveSeconds(subscription?.current_period_end);
}

/** The id of the subscription an invoice bills, or '' when it bills none. */
export function invoiceSubscriptionId(invoice) {
  const value = invoice?.parent?.subscription_details?.subscription ?? invoice?.subscription;
  if (typeof value === 'string') return value;
  return typeof value?.id === 'string' ? value.id : '';
}
