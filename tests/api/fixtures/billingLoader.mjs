/*
 * ESM loader for the billing endpoint behavioral tests.
 *
 * The Stripe and Supabase clients are module-private inside
 * api/stripe/webhook.js and api/stripe/checkout.js (constructed at import
 * time from environment variables), so the test cannot reach them to swap in
 * fakes. This loader redirects the two package specifiers to the fixture
 * stubs in this directory instead, which hand the handler a scripted fake
 * chosen by the test.
 *
 * What is NOT stubbed: the webhook's signature verification. The Stripe
 * fixture reimplements stripe-node's constructEvent (t=...,v1=... HMAC-SHA256
 * over the raw body) faithfully — verified both directions against the real
 * SDK — so a test event is accepted only when it carries a valid signature
 * for STRIPE_WEBHOOK_SECRET. Unsigned and tampered deliveries still fail.
 *
 * Register from the test file before dynamically importing the handler:
 *
 *   import { register } from 'node:module';
 *   register(new URL('./fixtures/billingLoader.mjs', import.meta.url));
 *   const { default: handler } = await import('../../api/stripe/webhook.js');
 *
 * Static imports in the test file are linked before register() runs, so the
 * handler itself must be imported dynamically (with a query string when one
 * process needs two different module-scope env postures).
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'stripe') {
    return {
      url: new URL('./billingStripeStub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  if (specifier === '@supabase/supabase-js') {
    return {
      url: new URL('./billingSupabaseStub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
