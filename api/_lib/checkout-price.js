import { subscriptionPlans } from './subscription-plans.js';
import { stripeAccountIdReady } from './managed-billing.js';

// Only fixed, code-owned reasons enter server logs. Stripe exception messages
// can contain credentials or customer data; never log the exception itself.
function refuse(reason) {
  console.warn('Stripe checkout price verification refused.', { reason });
  return false;
}

function readFailureReason(error, stage) {
  if (error?.type === 'StripeAuthenticationError') return `${stage}_authentication_failed`;
  if (error?.type === 'StripePermissionError') return `${stage}_permission_denied`;
  if (stage === 'price' && error?.code === 'resource_missing') return 'price_not_found';
  return `${stage}_read_failed`;
}

/** Check the actual Stripe price against the same plan table used for entitlements.
 * Do not trust a price ID, product name, or metadata as proof of its amount.
 * Any unknown or unsupported pricing shape must refuse checkout.
 */
export async function verifyCheckoutPrice(
  stripe,
  { tier, billingPeriod, priceId, expectedAccountId, expectedLivemode },
) {
  const plan = subscriptionPlans[tier];
  if (!stripe || !plan || !priceId || !['monthly', 'annual'].includes(billingPeriod)) return false;
  const expectedAmount = (billingPeriod === 'annual' ? plan.annualRate : plan.monthlyRate) * 100;
  let stage = 'account';
  try {
    // Account IDs are nonsecret configuration, never a client-supplied value.
    // A failed identity read must not fall back to an unpinned checkout.
    if (expectedAccountId) {
      if (!stripeAccountIdReady(expectedAccountId)) return refuse('account_pin_invalid');
      const account = await stripe.accounts.retrieve();
      if (account.id !== expectedAccountId) return refuse('account_mismatch');
    }
    stage = 'price';
    const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
    if (typeof expectedLivemode === 'boolean' && price.livemode !== expectedLivemode) {
      return refuse('price_mode_mismatch');
    }
    if (!Number.isSafeInteger(expectedAmount) || price.unit_amount !== expectedAmount) {
      return refuse('price_amount_mismatch');
    }
    const verified = Boolean(
      price.id === priceId &&
      price.active === true &&
      price.type === 'recurring' &&
      price.currency === 'usd' &&
      price.billing_scheme === 'per_unit' &&
      !price.transform_quantity &&
      price.recurring?.interval === (billingPeriod === 'annual' ? 'year' : 'month') &&
      price.recurring?.interval_count === 1 &&
      price.recurring?.usage_type === 'licensed' &&
      typeof price.product === 'object' &&
      price.product?.active === true &&
      !price.product?.deleted,
    );
    return verified || refuse('price_contract_mismatch');
  } catch (error) {
    // Missing price, wrong account, insufficient permissions, and Stripe outages
    // all leave the price unknown. None may hand the buyer a checkout URL.
    return refuse(readFailureReason(error, stage));
  }
}
