import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkoutIdempotencyKey, planCheckoutSession } from '../../api/_lib/checkout-session.js';

/*
 * An empty `stripe_subscription_id` means no subscription EXISTS. It does not
 * mean none is on its way.
 *
 * The row only gains a subscription id once the webhook lands after payment, so
 * the entire window between "seller clicked Subscribe" and "Stripe told us it
 * completed" — around 24 hours, since that is how long a session stays open —
 * looked to the guard exactly like a workspace that had never tried to buy.
 * A second tab or a retry inside that window created another completable
 * session, and completing both bills the customer twice.
 */

function session(overrides = {}) {
  return {
    id: 'cs_1',
    status: 'open',
    mode: 'subscription',
    url: 'https://checkout.stripe.com/c/pay/cs_1',
    metadata: { workspace_id: 'ws-1', workspace_tier: 'Professional', workspace_seats: '3' },
    ...overrides,
  };
}

const intent = { workspaceId: 'ws-1', tier: 'Professional', seatCount: 3 };

test('an open session for the same purchase is reused, not duplicated', () => {
  const open = session();
  const plan = planCheckoutSession([open], intent);

  assert.equal(plan.action, 'reuse');
  assert.equal(plan.session, open);
  assert.deepEqual(plan.expire, [], 'nothing to clean up when the only session is the right one');
});

test('an open session for a different tier is expired, not left completable', () => {
  // The duplicate-charge case: a seller opened Professional, changed their mind,
  // and started Enterprise. Both tabs can still be paid.
  const stale = session({ id: 'cs_old', metadata: { ...session().metadata, workspace_tier: 'Enterprise' } });
  const plan = planCheckoutSession([stale], intent);

  assert.equal(plan.action, 'create');
  assert.deepEqual(
    plan.expire.map((entry) => entry.id),
    ['cs_old'],
  );
});

test('an open session for a different seat count is never reused', () => {
  // Reusing it would charge for the wrong number of seats.
  const stale = session({ metadata: { ...session().metadata, workspace_seats: '9' } });
  const plan = planCheckoutSession([stale], intent);

  assert.equal(plan.action, 'create');
  assert.equal(plan.expire.length, 1);
});

test('a session from before seat metadata existed is expired rather than reused', () => {
  // Safe direction: unknown seats cannot be matched, and reusing on a guess
  // charges the wrong amount.
  const legacy = session({ metadata: { workspace_id: 'ws-1', workspace_tier: 'Professional' } });
  const plan = planCheckoutSession([legacy], intent);

  assert.equal(plan.action, 'create');
  assert.equal(plan.expire.length, 1);
});

test('sessions that are not this workspace, not open, or not subscriptions are left alone', () => {
  const other = session({ id: 'cs_other', metadata: { ...session().metadata, workspace_id: 'ws-2' } });
  const closed = session({ id: 'cs_done', status: 'complete' });
  // Expiring a one-off payment session would cancel something unrelated.
  const payment = session({ id: 'cs_pay', mode: 'payment' });

  const plan = planCheckoutSession([other, closed, payment], intent);

  assert.equal(plan.action, 'create');
  assert.deepEqual(plan.expire, [], 'none of these are this purchase, and none are ours to expire');
});

test('an open session with no url is not offered back to the seller', () => {
  const broken = session({ url: '' });
  const plan = planCheckoutSession([broken], intent);

  assert.equal(plan.action, 'create', 'a session with nowhere to send them is not a reusable session');
});

test('no open sessions means an ordinary first purchase', () => {
  for (const empty of [[], null, undefined]) {
    const plan = planCheckoutSession(empty, intent);
    assert.equal(plan.action, 'create');
    assert.deepEqual(plan.expire, []);
  }
});

test('two submissions in the same moment collapse to one session', () => {
  const at = new Date('2026-08-26T12:34:56Z');
  assert.equal(checkoutIdempotencyKey(intent, at), checkoutIdempotencyKey(intent, new Date('2026-08-26T12:34:02Z')));
});

test('a real second attempt later gets a real second session', () => {
  /*
   * A key with no time component would replay the original session hours later
   * — by then possibly expired, handing the seller a dead link. Listing open
   * sessions is what catches the slow duplicate; this only has to catch the
   * two-POSTs-racing case.
   */
  const first = checkoutIdempotencyKey(intent, new Date('2026-08-26T12:34:56Z'));
  const later = checkoutIdempotencyKey(intent, new Date('2026-08-26T13:34:56Z'));
  assert.notEqual(first, later);

  // Different purchases never share a key either.
  assert.notEqual(first, checkoutIdempotencyKey({ ...intent, tier: 'Enterprise' }, new Date('2026-08-26T12:34:56Z')));
  assert.notEqual(first, checkoutIdempotencyKey({ ...intent, seatCount: 9 }, new Date('2026-08-26T12:34:56Z')));
});

test('the endpoint expires stale sessions before it creates another', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const list = source.indexOf('stripe.checkout.sessions.list(');
  const expire = source.indexOf('stripe.checkout.sessions.expire(');
  const create = source.indexOf('stripe.checkout.sessions.create(');

  assert.ok(list > -1, 'the endpoint must ask Stripe what is already open');
  assert.ok(expire > -1, 'and be able to close what should not stay open');
  assert.ok(list < expire, 'it cannot expire what it has not looked up');
  assert.ok(expire < create, 'a stale session left completable beside a new one is the duplicate charge');

  assert.match(source, /idempotencyKey: checkoutIdempotencyKey\(intent\)/, 'a racing duplicate POST must collapse');
  assert.match(source, /workspace_seats: String\(seatCount\)/, 'seats must be recorded for the next comparison');
});

test('expiring a session that already closed does not fail the purchase', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  // It can complete or expire between the list and the call. Losing that race
  // is not a reason to refuse a customer who is trying to pay.
  assert.match(source, /try \{\s*await stripe\.checkout\.sessions\.expire\(stale\.id\);\s*\} catch/);
});
