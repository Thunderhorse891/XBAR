import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { checkoutBlockReason, isStoredSubscriptionRecoverable } from '../../api/_lib/subscription-status.js';

/*
 * A workspace whose subscription Stripe can still bill must not be sold a
 * second one. That rule was enforced only in the browser: the plan buttons were
 * hidden, and the endpoint behind them would happily create another
 * `mode: 'subscription'` Checkout Session for anyone who called it — an admin
 * with curl, or simply an older cached bundle.
 *
 * The harm is money. A duplicated subscription bills the customer twice and
 * leaves two webhook streams fighting over one entitlement record.
 */

test('a stored payload that says recoverable is recoverable', () => {
  assert.equal(isStoredSubscriptionRecoverable({ subscriptionRecoverable: true }), true);
  assert.equal(isStoredSubscriptionRecoverable({ subscriptionRecoverable: false }), false);
});

test('a legacy row with no flag is answered by its billing state', () => {
  // The previous mapper stored past_due AND unpaid as 'Past Due' and wrote no
  // flag. Reading an absent field as "not recoverable" would re-open duplicate
  // checkout for that entire population on the day this deploys.
  assert.equal(isStoredSubscriptionRecoverable({ billingState: 'Past Due' }), true);
  assert.equal(isStoredSubscriptionRecoverable({ billingState: 'Active' }), false);
  assert.equal(isStoredSubscriptionRecoverable({ billingState: 'Inactive' }), false);
});

test('a workspace that has never had a subscription can buy one', () => {
  // Every new workspace is this case; refusing here would sell nothing at all.
  assert.equal(isStoredSubscriptionRecoverable(null), false);
  assert.equal(isStoredSubscriptionRecoverable(undefined), false);
  assert.equal(isStoredSubscriptionRecoverable({}), false);
  assert.equal(isStoredSubscriptionRecoverable('Past Due'), false);
});

test('the flag wins over the billing state when both are present', () => {
  // A reconciled row carries both, and the flag is the reconciliation's answer.
  assert.equal(isStoredSubscriptionRecoverable({ subscriptionRecoverable: false, billingState: 'Past Due' }), false);
  assert.equal(isStoredSubscriptionRecoverable({ subscriptionRecoverable: true, billingState: 'Inactive' }), true);
});

test('the client and the server ask the same question the same way', () => {
  const client = readFileSync('src/lib/subscriptionDecision.ts', 'utf8');
  const server = readFileSync('api/_lib/subscription-status.js', 'utf8');

  // Two copies of a money rule that disagree is worse than either being wrong
  // alone, so both must keep the flag-then-billing-state order.
  for (const [name, source] of [
    ['client', client],
    ['server', server],
  ]) {
    assert.match(source, /typeof \w+\.subscriptionRecoverable === 'boolean'/, `${name} must prefer the explicit flag`);
    assert.match(source, /billingState === 'Past Due'/, `${name} must fall back to the billing state`);
  }
});

const billing = (subscriptionId, payload) => ({
  stripe_subscription_id: subscriptionId,
  entitlement_payload: payload,
});

test('a workspace with no subscription may buy one', () => {
  assert.equal(checkoutBlockReason(null), null, 'a brand new workspace');
  assert.equal(checkoutBlockReason(billing('', {})), null, 'a billing row with no subscription');
});

test('an abandoned checkout session does not lock the customer out of buying', () => {
  // `checkout.js` writes an `incomplete` payload with subscriptionRecoverable
  // true the moment a session is created, and an EMPTY subscription id. Nothing
  // clears it if the customer closes the tab — so a guard reading the payload
  // alone refused that workspace every subsequent attempt, for good. A safety
  // guard that stops people paying is worse than the harm it was added for.
  const abandoned = billing('', { billingState: 'Inactive', subscriptionRecoverable: true });

  assert.equal(
    isStoredSubscriptionRecoverable(abandoned.entitlement_payload),
    true,
    'the payload still says recoverable',
  );
  assert.equal(checkoutBlockReason(abandoned), null, 'but there is no subscription to recover');
});

test('an active subscription is not sold a second one', () => {
  // The billing screen enables every other tier's button, so this is the
  // ordinary upgrade path — not an edge case. Its payload is not recoverable,
  // so a recoverability-only guard let it straight through to a second
  // `mode: 'subscription'` session beside the one being paid for.
  const active = billing('sub_live', { billingState: 'Active', subscriptionRecoverable: false });

  assert.equal(checkoutBlockReason(active), 'subscription_active');
});

test('a live subscription that lapsed is recoverable, not duplicable', () => {
  assert.equal(
    checkoutBlockReason(billing('sub_live', { billingState: 'Inactive', subscriptionRecoverable: true })),
    'subscription_recoverable',
  );
  // Legacy rows carry no flag; the billing state answers for them.
  assert.equal(checkoutBlockReason(billing('sub_live', { billingState: 'Past Due' })), 'subscription_recoverable');
});

test('an unreadable payload beside a live subscription id fails closed', () => {
  // `entitlement_payload` defaults to `{}` in the schema, and a row can carry a
  // real subscription id beside that empty object. Reading "no entitled state,
  // not recoverable" as "proven canceled" turned the least informative case
  // into the most permissive one, while the only reliable evidence on the row
  // said a subscription exists.
  assert.equal(checkoutBlockReason(billing('sub_live', {})), 'subscription_unverified');
  assert.equal(checkoutBlockReason(billing('sub_live', null)), 'subscription_unverified');
  assert.equal(checkoutBlockReason(billing('sub_live', undefined)), 'subscription_unverified');
  // A state nobody recognizes is also unknown, not terminal.
  assert.equal(checkoutBlockReason(billing('sub_live', { billingState: 'Something New' })), 'subscription_unverified');
});

test('terminal is something the payload has to assert', () => {
  // Both writers set the flag explicitly — buildSubscriptionProfile and the
  // reconciliation migration — so an ABSENT flag beside a live id is unknown,
  // and only an explicit false is proof there is nothing left to duplicate.
  assert.equal(
    checkoutBlockReason(billing('sub_dead', { billingState: 'Inactive', subscriptionRecoverable: false })),
    null,
  );
  assert.equal(checkoutBlockReason(billing('sub_dead', { billingState: 'Inactive' })), 'subscription_unverified');
});

test('a canceled subscription can be replaced with a new one', () => {
  // Terminal states leave the id behind, but there is nothing left to
  // duplicate — and refusing here would mean a former customer could never
  // come back.
  assert.equal(
    checkoutBlockReason(billing('sub_dead', { billingState: 'Inactive', subscriptionRecoverable: false })),
    null,
  );
});

test('a comped workspace is not sold a subscription beside its grant', () => {
  // Manual Billing is an operator decision. If it also carries a Stripe
  // subscription id, that subscription is live and must not be duplicated.
  assert.equal(checkoutBlockReason(billing('sub_live', { billingState: 'Manual Billing' })), 'subscription_active');
});

test('the checkout endpoint refuses before it creates a session', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const guard = source.indexOf('checkoutBlockReason(billingCustomer)');
  const createSession = source.indexOf('stripe.checkout.sessions.create(');
  const createCustomer = source.indexOf('stripe.customers.create(');

  assert.ok(guard > -1, 'the endpoint must enforce recoverability itself, not rely on the UI');
  assert.ok(guard < createSession, 'the refusal must come before a Checkout Session is created');
  // Also before the customer is created: a refused request should leave nothing
  // behind in Stripe.
  assert.ok(guard < createCustomer, 'the refusal must come before a Stripe customer is created');
  assert.match(source, /code: blockReason,/, 'the client needs a code it can act on');
  assert.match(source, /subscription_active/, 'and the two refusals must be distinguishable');
});

test('an unreadable billing row is a retryable refusal, not a sale', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  // Same fail-closed rule as the capacity gates: a failed read establishes
  // nothing, and guessing "no subscription" here charges someone twice.
  assert.match(source, /select\('stripe_customer_id, stripe_subscription_id, entitlement_payload'\)/);
  assert.match(source, /if \(billingCustomerError\) \{[\s\S]{0,400}sendJson\(res, 503,/);
  assert.match(source, /retryable: true/);
});
