import { subscriptionPlans } from './subscription-plans.js';

/** Check the actual Stripe price against the same plan table used for entitlements.
 * Do not trust a price ID, product name, or metadata as proof of its amount.
 * Any unknown or unsupported pricing shape must refuse checkout.
 */
export async function verifyCheckoutPrice(stripe, { tier, billingPeriod, priceId }) {
  const plan = subscriptionPlans[tier];
  if (!stripe || !plan || !priceId || !['monthly', 'annual'].includes(billingPeriod)) return false;
  const expectedAmount = (billingPeriod === 'annual' ? plan.annualRate : plan.monthlyRate) * 100;
  try {
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    return Boolean(
      price.id === priceId &&
      price.active === true &&
      price.type === 'recurring' &&
      price.currency === 'usd' &&
      price.billing_scheme === 'per_unit' &&
      Number.isSafeInteger(expectedAmount) &&
      price.unit_amount === expectedAmount &&
      !price.transform_quantity &&
      price.recurring?.interval === (billingPeriod === 'annual' ? 'year' : 'month') &&
      price.recurring?.interval_count === 1 &&
      price.recurring?.usage_type === 'licensed' &&
      typeof price.product === 'object' &&
      price.product?.active === true &&
      !price.product?.deleted,
    );
  } catch {
    // Missing price, wrong account, insufficient permissions, and Stripe outages
    // all leave the price unknown. None may hand the buyer a checkout URL.
    return false;
  }
}
