import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CHECKOUT_LOCK_MS,
  claimCheckoutLock,
  planCheckoutSession,
  resolveExpiryFailure,
} from '../../api/_lib/checkout-session.js';

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

test('the endpoint expires stale sessions before it creates another', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const list = source.indexOf('stripe.checkout.sessions.list(');
  const expire = source.indexOf('stripe.checkout.sessions.expire(');
  const create = source.indexOf('stripe.checkout.sessions.create(');

  assert.ok(list > -1, 'the endpoint must ask Stripe what is already open');
  assert.ok(expire > -1, 'and be able to close what should not stay open');
  assert.ok(list < expire, 'it cannot expire what it has not looked up');
  assert.ok(expire < create, 'a stale session left completable beside a new one is the duplicate charge');

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

/*
 * Serialization is a database claim now, not a key.
 *
 * Every key available to a single request is derived from that request, so it
 * can only de-duplicate identical submissions or — with a time bucket — leak
 * across the bucket boundary. Two attempts read as solved and were not:
 * keying on the intent let two tabs on different plans both create a session,
 * and keying on workspace+minute let two requests straddling :59 do the same.
 * Postgres serializing two updates to one row has no such boundary.
 */

function fakeSupabase({ rows = [{ workspace_id: 'ws-1' }], error = null } = {}) {
  const calls = [];
  const builder = {
    update(values) {
      calls.push(values);
      return builder;
    },
    eq() {
      return builder;
    },
    or(expression) {
      calls.push({ or: expression });
      return builder;
    },
    select() {
      return Promise.resolve({ data: rows, error });
    },
  };
  return { from: () => builder, calls };
}

test('exactly one racing request may create a session', async () => {
  const winner = fakeSupabase({ rows: [{ workspace_id: 'ws-1' }] });
  // Postgres serializes the two updates: the loser's conditional no longer
  // matches, so it gets no row back.
  const loser = fakeSupabase({ rows: [] });

  assert.equal(await claimCheckoutLock(winner, 'ws-1'), true);
  assert.equal(await claimCheckoutLock(loser, 'ws-1'), false);
});

test('a claim that cannot be read is not a claim', async () => {
  // Same fail-closed rule as the capacity gates: a failed query establishes
  // nothing, and guessing "nobody holds it" creates a second billable session.
  const broken = fakeSupabase({ rows: null, error: { message: 'connection reset' } });
  assert.equal(await claimCheckoutLock(broken, 'ws-1'), false);
});

test('a claim left behind by a dead request expires', async () => {
  const supabase = fakeSupabase();
  const now = new Date('2026-08-26T12:00:00Z');
  await claimCheckoutLock(supabase, 'ws-1', now);

  const condition = supabase.calls.find((call) => typeof call.or === 'string').or;

  /*
   * The holder is a serverless invocation that can vanish mid-request, so the
   * claim has to expire on its own. A lock only a live process can free is a
   * lock that eventually wedges a workspace out of buying anything.
   */
  assert.match(condition, /checkout_lock_at\.is\.null/, 'an unclaimed workspace is claimable');
  assert.match(condition, /checkout_lock_at\.lt\.2026-08-26T11:58:00/, 'and a stale claim is reclaimable');
  assert.equal(CHECKOUT_LOCK_MS, 120000);
});

test('the endpoint claims before it looks at Stripe, and always releases', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const claim = source.indexOf('await claimCheckoutLock(supabase, workspaceId)');
  const list = source.indexOf('stripe.checkout.sessions.list(');
  assert.ok(claim > -1 && claim < list, 'listing is only safe while holding the claim');

  /*
   * Released in `finally`, not before each return. Four exit paths releasing
   * separately is four chances to add a fifth that does not — and a leaked
   * claim locks the workspace out of buying anything until the expiry.
   */
  assert.match(source, /\} finally \{\s*\/\/[\s\S]{0,200}await releaseCheckoutLock\(supabase, workspaceId\);/);
  assert.ok(!source.includes('idempotencyKey'), 'a second mechanism that looks like it serializes must not remain');
});
