import type { SubscriptionProfile } from '../types/xbar.js';
import { hasActivePaidPlan } from './subscriptionDecision.js';

/*
 * What Stripe appends when the customer comes back from a managed checkout.
 *
 * api/stripe/checkout.js builds the return URLs as
 * `${returnUrl}?checkout=success` / `${returnUrl}?checkout=cancelled`, and
 * returnUrl is the billing page itself. Nothing read the parameter, so a
 * customer who had just paid landed back on a page that still showed Starter
 * with the plan buttons still enabled, and did the obvious thing: concluded
 * the payment had failed.
 *
 * The success case cannot trust the parameter alone. A redirect back to
 * ?checkout=success proves Stripe finished the hosted page; it does not prove
 * the deployment recorded anything. The profile the screen polls for is the
 * one the webhook writes on `checkout.session.completed`, so confirmation is
 * withheld until that row says the workspace pays.
 */

export const CHECKOUT_RETURN_PARAM = 'checkout';

export type CheckoutReturnKind = 'success' | 'cancelled';

/**
 * How often the billing screen re-reads the subscription profile while a
 * just-completed checkout is waiting on the webhook.
 */
export const CHECKOUT_CONFIRMATION_POLL_INTERVAL_MS = 5_000;

/**
 * How long the screen waits for the webhook before saying "still confirming".
 * Long enough for an ordinary webhook delivery, short enough that the customer
 * is not left watching a spinner that has given up without saying so.
 */
export const CHECKOUT_CONFIRMATION_TIMEOUT_MS = 75_000;

/**
 * Read the checkout return from a URL query string. Anything that is not one
 * of the two values the checkout endpoint writes is not a checkout return —
 * `?checkout=` arrives only from Stripe's return URL, and an unexpected value
 * must not arm either flow.
 */
export function parseCheckoutReturn(search: string): CheckoutReturnKind | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const value = params.get(CHECKOUT_RETURN_PARAM);
  if (value === 'success') return 'success';
  if (value === 'cancelled') return 'cancelled';
  return null;
}

/**
 * The query string with the checkout return removed, for cleaning the URL
 * after the return is handled. Everything else — `plan=Professional` and any
 * future parameters — is preserved, so a refresh after cleanup still shows the
 * tier the customer was looking at but never re-runs the return handling.
 */
export function stripCheckoutReturnParam(search: string): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  params.delete(CHECKOUT_RETURN_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

/**
 * Whether the profile read from the cloud proves the just-completed checkout
 * landed.
 *
 * The only writer of an entitled paid profile is the webhook (or an operator
 * grant, which also means "this workspace pays"). `hasActivePaidPlan` is the
 * same predicate the plan cards use to mean "this workspace pays", so the
 * confirmation and the buttons can never disagree. An unreadable or absent
 * profile is never confirmation — unknown is not an upgrade, and the poll
 * simply keeps going.
 *
 * The rate check matters, not just the billing state: a freshly initialized
 * workspace is seeded as Starter / 'Manual Billing' / rate 0, and reading the
 * entitled state alone would confirm a purchase that never happened.
 */
export function isCheckoutConfirmationComplete(profile: SubscriptionProfile | null | undefined): boolean {
  return !!profile && hasActivePaidPlan(profile);
}
