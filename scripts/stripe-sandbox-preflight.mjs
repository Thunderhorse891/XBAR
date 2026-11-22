#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import Stripe from 'stripe';
import { verifyCheckoutPrice } from '../api/_lib/checkout-price.js';
import { getCheckoutPriceIdByTier, PUBLIC_PAID_SUBSCRIPTION_TIERS } from '../api/_lib/subscription-plans.js';

const failure = (reason, checked = 0, pair) => ({ ok: false, reason, checked, ...(pair ? { pair } : {}) });

/**
 * Read the sandbox's account and exact checkout catalog. Intentionally separate
 * from general go-live preflight: invokes Stripe only with a sandbox key and
 * never touches Checkout, customers, subscriptions, Supabase, or secrets on disk.
 */
export async function inspectStripeSandbox(env, createClient) {
  if (env.VERCEL_ENV?.trim().toLowerCase() === 'production') return failure('production_environment_refused');
  const secret = env.STRIPE_SECRET_KEY?.trim() || '';
  const expectedAccount = env.STRIPE_ACCOUNT_ID?.trim() || '';
  if (!/^(sk|rk)_test_[A-Za-z0-9_]+$/.test(secret)) return failure('test_key_required');
  if (!/^acct_[A-Za-z0-9]+$/.test(expectedAccount)) return failure('account_pin_required');

  const pairs = PUBLIC_PAID_SUBSCRIPTION_TIERS.map((tier) => ({
    tier,
    billingPeriod: 'monthly',
    priceId: getCheckoutPriceIdByTier(tier, 'monthly', env),
  }));
  if (pairs.some(({ priceId }) => !priceId)) return failure('price_configuration_invalid_or_aliased');

  let client;
  try {
    client = createClient(secret);
  } catch {
    return failure('client_initialization_failed');
  }
  let account;
  try {
    account = await client.accounts.retrieve();
  } catch (error) {
    if (error?.type === 'StripeAuthenticationError') return failure('account_authentication_failed');
    if (error?.type === 'StripePermissionError') return failure('account_permission_denied');
    return failure('account_read_failed');
  }
  if (account?.id !== expectedAccount) return failure('account_mismatch');

  let checked = 0;
  for (const pair of pairs) {
    // Account ownership is already pinned for this unchanged client.
    const verified = await verifyCheckoutPrice(client, { ...pair, expectedLivemode: false });
    if (!verified) return failure('price_verification_failed', checked, `${pair.tier}/${pair.billingPeriod}`);
    checked++;
  }
  return { ok: true, checked };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await inspectStripeSandbox(
    process.env,
    (secret) => new Stripe(secret, { timeout: 10000, maxNetworkRetries: 0 }),
  );
  if (result.ok) {
    console.log(`Stripe sandbox: pinned account and ${result.checked} app checkout prices verified (read-only).`);
    console.log('Not verified: sandbox checkout, payment, webhook delivery, entitlement, or production catalog.');
  } else {
    console.error(`Stripe sandbox preflight failed: ${result.reason}${result.pair ? ` (${result.pair})` : ''}.`);
    process.exitCode = 1;
  }
}
