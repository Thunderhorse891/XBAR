import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { checkoutIdempotencyKey, planCheckoutSession, resolveExpiryFailure } from '../../api/_lib/checkout-session.js';

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

  /*
   * Different TIERS deliberately share a key now — see the serialization test
   * below. Keying on the intent meant two concurrent requests for different
   * plans got different keys and both created a completable session. The
   * workspace is the thing being serialized, so a different workspace is what
   * must never collide.
   */
  assert.notEqual(
    first,
    checkoutIdempotencyKey({ ...intent, workspaceId: 'ws-other' }, new Date('2026-08-26T12:34:56Z')),
  );
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

test('a session that expired under us does not fail the purchase', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  /*
   * This test used to say "already closed", which conflated two very different
   * outcomes. Losing the race to a session that EXPIRED is harmless and must
   * not refuse a customer trying to pay. Losing it to one that COMPLETED is a
   * purchase that just succeeded, and carrying on there bills them twice — so
   * only the first carries on.
   */
  assert.match(source, /await stripe\.checkout\.sessions\.expire\(stale\.id\);\s*continue;/);
  assert.match(source, /if \(outcome === 'proceed'\) continue;/);
  assert.doesNotMatch(
    source,
    /catch \(error\) \{[^}]*\}\s*\}\s*const session =/,
    'a swallowed expire failure must not lead straight into creating a session',
  );
});

test('a session that completed while we were expiring it stops the purchase', () => {
  /*
   * `expire` throws for a session that is already dead — harmless — and also
   * for one that COMPLETED between the list and the call, which is a purchase
   * that just succeeded. Treating both as harmless created the second
   * subscription this whole path exists to prevent, and the billing row could
   * not catch it: that row was read before any of this and still showed no
   * subscription, because the webhook had not landed yet.
   */
  assert.equal(resolveExpiryFailure({ status: 'complete' }), 'refuse_completed');
});

test('an already-expired session is the harmless race, and carries on', () => {
  assert.equal(resolveExpiryFailure({ status: 'expired' }), 'proceed');
});

test('a session we could not confirm closed is not permission to charge', () => {
  // Same fail-closed rule as everywhere else in this PR: a failed read
  // establishes nothing, and guessing "it is gone" here bills someone twice.
  assert.equal(resolveExpiryFailure({ status: 'open' }), 'refuse_unverified');
  assert.equal(resolveExpiryFailure(null), 'refuse_unverified', 'a failed re-read is unknown, not safe');
  assert.equal(resolveExpiryFailure(undefined), 'refuse_unverified');
  assert.equal(resolveExpiryFailure({}), 'refuse_unverified', 'a session with no status is unknown too');
});

test('the endpoint re-reads a session it failed to expire, and refuses on the answer', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const retrieve = source.indexOf('stripe.checkout.sessions.retrieve(stale.id)');
  const create = source.indexOf('stripe.checkout.sessions.create(');

  assert.ok(retrieve > -1, 'a failed expire must be followed by finding out why');
  assert.ok(retrieve < create, 'and that has to happen before another session is created');
  assert.match(source, /resolveExpiryFailure\(reread\)/);
  assert.match(source, /if \(outcome === 'proceed'\) continue;/, 'only the harmless race carries on');
  assert.match(source, /code: outcome === 'refuse_completed' \? 'subscription_active' : 'billing_unavailable'/);
});

test('two concurrent checkouts for different plans cannot both proceed', () => {
  /*
   * The gap listing cannot cover. Two requests can both list open sessions
   * before either has created one, so neither sees the other — and with tier
   * and seat count in the key they got DIFFERENT keys, so Stripe happily
   * created two independently completable subscription sessions. Completing
   * both charges the workspace twice.
   *
   * Keyed on the workspace alone, the second collides and Stripe rejects it.
   */
  const at = new Date('2026-08-26T12:34:00Z');
  const professional = { workspaceId: 'ws-1', tier: 'Professional', seatCount: 3 };
  const enterprise = { workspaceId: 'ws-1', tier: 'Enterprise', seatCount: 9 };

  assert.equal(checkoutIdempotencyKey(professional, at), checkoutIdempotencyKey(enterprise, at));

  // A different workspace is a different purchase and must never be serialized
  // against this one.
  assert.notEqual(
    checkoutIdempotencyKey(professional, at),
    checkoutIdempotencyKey({ ...professional, workspaceId: 'ws-2' }, at),
  );
});

test('a collision is reported as retryable, not swallowed or duplicated', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  assert.match(source, /if \(!isIdempotencyConflict\(error\)\) throw error;/, 'only a collision is handled here');
  assert.match(source, /Another checkout for this workspace is already being started/);
  assert.match(source, /retryable: true/);
});

test('a reused session never overwrites the billing row', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  /*
   * A reused session can complete in another tab between the listing and this
   * write. If its webhook lands first it writes the live subscription id, and
   * an unconditional `''` erased it — replacing a paid entitlement with
   * `incomplete` and leaving the next request free to create a second
   * subscription, since it would find neither an id nor an open session.
   */
  assert.match(source, /if \(plan\.action !== 'reuse'\) \{\s*const \{ error: billingWriteError \}/);
});

test('a session Stripe holds but the database does not is closed, not returned', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  /*
   * Returning the URL after a failed write leaves a billable orphan: the next
   * request reads a row with no customer id, creates a second customer, and
   * cannot list or expire this session.
   */
  const failure = source.indexOf('if (billingWriteError) {');
  const expire = source.indexOf('await stripe.checkout.sessions.expire(session.id);');
  assert.ok(failure > -1, 'the write result must be checked');
  assert.ok(expire > failure, 'and the orphaned session closed before refusing');
  assert.match(source, /Checkout could not be recorded for this workspace\. Nothing was charged/);
});
