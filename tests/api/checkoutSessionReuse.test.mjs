import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  CHECKOUT_EXPIRE_BUDGET,
  findBlockingSubscription,
  CHECKOUT_LOCK_MS,
  STRIPE_PAGE_LIMIT,
  STRIPE_PAGE_SIZE,
  claimCheckoutLock,
  listOpenCheckoutSessions,
  planCheckoutSession,
  releaseCheckoutLock,
  splitExpiryBatch,
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

  const list = source.indexOf('listOpenCheckoutSessions(stripe, stripeCustomerId)');
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

function fakeSupabase({ claimed = true, error = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: error ? null : claimed, error });
    },
  };
}

test('a workspace making its FIRST purchase can claim', async () => {
  /*
   * `workspace_billing_customers` has no row until the first purchase — the
   * only writers are this flow and the webhook that runs after payment. A plain
   * conditional UPDATE matched nothing and reported "someone else holds it",
   * refusing every first checkout: the one path that has to work. The RPC
   * seeds the row and claims it in one statement.
   */
  const supabase = fakeSupabase({ claimed: true });
  const token = await claimCheckoutLock(supabase, 'ws-new');
  assert.ok(token, 'a first purchase must be able to claim');
  assert.equal(supabase.calls[0].name, 'xbar_claim_checkout_lock', 'the claim must go through the atomic function');
  assert.equal(supabase.calls[0].args.p_token, token, 'the token recorded on the row is the one handed back');
});

test('exactly one racing request may create a session', async () => {
  // Postgres serializes the two statements against the same row: the loser's
  // WHERE no longer matches, so the function returns false.
  assert.ok(await claimCheckoutLock(fakeSupabase({ claimed: true }), 'ws-1'), 'the winner holds a token');
  assert.equal(await claimCheckoutLock(fakeSupabase({ claimed: false }), 'ws-1'), '', 'the loser holds nothing');
});

test('a claim that cannot be read is not a claim', async () => {
  // Same fail-closed rule as the capacity gates: a failed query establishes
  // nothing, and guessing "nobody holds it" creates a second billable session.
  const broken = fakeSupabase({ error: { message: 'connection reset' } });
  assert.equal(await claimCheckoutLock(broken, 'ws-1'), '', 'no token means no claim');
});

test('a claim left behind by a dead request expires', async () => {
  const supabase = fakeSupabase();
  await claimCheckoutLock(supabase, 'ws-1', new Date('2026-08-26T12:00:00Z'));

  /*
   * The holder is a serverless invocation that can vanish mid-request, so the
   * claim has to expire on its own. A lock only a live process can free is a
   * lock that eventually wedges a workspace out of buying anything.
   */
  assert.equal(supabase.calls[0].args.p_stale_before, '2026-08-26T11:58:00.000Z');
  assert.equal(CHECKOUT_LOCK_MS, 120000);
});

test('the claim comes before anything is created in Stripe', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  // A claim that fails after the customer is created leaves Stripe holding a
  // customer this deployment never recorded — the orphan the write-failure
  // path further down exists to avoid.
  const claim = source.indexOf('await claimCheckoutLock(supabase, workspaceId)');
  const customer = source.indexOf('stripe.customers.create(');
  assert.ok(claim > -1 && claim < customer, 'nothing may be created in Stripe before the workspace is claimed');
});

test('the endpoint claims before it looks at Stripe, and always releases', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const claim = source.indexOf('await claimCheckoutLock(supabase, workspaceId)');
  const list = source.indexOf('listOpenCheckoutSessions(stripe, stripeCustomerId)');
  assert.match(
    source,
    /await releaseCheckoutLock\(supabase, workspaceId, claimToken\)/,
    'the release must name the claim it owns',
  );
  assert.ok(claim > -1 && claim < list, 'listing is only safe while holding the claim');

  /*
   * Released in `finally`, not before each return. Four exit paths releasing
   * separately is four chances to add a fifth that does not — and a leaked
   * claim locks the workspace out of buying anything until the expiry.
   */
  assert.match(
    source,
    /\} finally \{\s*\/\/[\s\S]{0,400}await releaseCheckoutLock\(supabase, workspaceId, claimToken\);/,
  );
  assert.ok(!source.includes('idempotencyKey'), 'a second mechanism that looks like it serializes must not remain');
});

/*
 * One `list` call returns the FIRST PAGE of open sessions, not the open
 * sessions. The endpoint asked for 10 and ignored `has_more`, which held for
 * the case it was written against — one seller, one stray tab — and failed for
 * the case that actually produces a pile: repeated attempts under the old flow,
 * which created a completable session every time and expired none of them.
 * Session 11 was invisible to the plan and still completable, and completing it
 * beside this request's session is the second subscription.
 */
function fakeStripe(pages) {
  const calls = [];
  return {
    calls,
    checkout: {
      sessions: {
        async list(params) {
          calls.push(params);
          return pages[calls.length - 1] ?? { data: [], has_more: false };
        },
      },
    },
  };
}

test('a single page of open sessions is read once and reported complete', async () => {
  const stripe = fakeStripe([{ data: [session({ id: 'cs_1' }), session({ id: 'cs_2' })], has_more: false }]);

  const result = await listOpenCheckoutSessions(stripe, 'cus_1');

  assert.equal(result.complete, true);
  assert.deepEqual(
    result.sessions.map((entry) => entry.id),
    ['cs_1', 'cs_2'],
  );
  assert.equal(stripe.calls.length, 1, 'nothing follows a page that says there is no more');
  assert.equal(stripe.calls[0].status, 'open');
  assert.equal(stripe.calls[0].customer, 'cus_1');
  assert.equal(stripe.calls[0].limit, STRIPE_PAGE_SIZE);
  assert.equal(STRIPE_PAGE_SIZE, 100, "Stripe's maximum page size — fewer pages is fewer round trips");
});

test('sessions beyond the first page are collected, not ignored', async () => {
  const stripe = fakeStripe([
    { data: [session({ id: 'cs_1' }), session({ id: 'cs_2' })], has_more: true },
    { data: [session({ id: 'cs_3' })], has_more: false },
  ]);

  const result = await listOpenCheckoutSessions(stripe, 'cus_1');

  assert.equal(result.complete, true);
  assert.deepEqual(
    result.sessions.map((entry) => entry.id),
    ['cs_1', 'cs_2', 'cs_3'],
    'an open session on page two is exactly as completable as one on page one',
  );
  assert.equal(stripe.calls[1].starting_after, 'cs_2', 'the next page must continue from the last id, not restart');
  assert.equal(stripe.calls[0].starting_after, undefined, 'the first page has nothing to continue from');
});

test('a walk that runs out of pages refuses rather than planning from part of the list', async () => {
  const stripe = fakeStripe(
    Array.from({ length: STRIPE_PAGE_LIMIT + 2 }, (_, page) => ({
      data: [session({ id: `cs_${page}` })],
      has_more: true,
    })),
  );

  const result = await listOpenCheckoutSessions(stripe, 'cus_1');

  assert.equal(result.complete, false, 'pages left unread cannot be reported as a complete list');
  assert.equal(stripe.calls.length, STRIPE_PAGE_LIMIT, 'an unbounded loop in a serverless invocation is its own bug');
});

test('more pages promised but none delivered is incomplete, not complete', async () => {
  // `has_more` with an empty page leaves no id to continue from. Calling that
  // complete would invent the assurance the caller then relies on.
  const stripe = fakeStripe([{ data: [], has_more: true }]);

  const result = await listOpenCheckoutSessions(stripe, 'cus_1');

  assert.equal(result.complete, false);
  assert.equal(stripe.calls.length, 1, 'there is no cursor to page with, so retrying the same page is pointless');
});

test('the endpoint refuses a partial list instead of creating beside it', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const refuse = source.indexOf('if (!open.complete)');
  const plan = source.indexOf('planCheckoutSession(openSessions, intent)');
  assert.ok(refuse > -1, 'a list that could not be finished must stop the purchase');
  assert.ok(refuse < plan, 'refusing after planning is not refusing');

  assert.match(
    source.slice(refuse, plan),
    /retryable: true/,
    'the customer must be told to try again, not that they are not entitled',
  );
});

/*
 * Reading every page fixed a duplicate-billing hole and opened a smaller one.
 * The expiry list used to be capped at 10 by the single-page read; each entry
 * is a serial round trip, and this endpoint sets no `maxDuration`, so it runs
 * on Vercel's ten-to-fifteen-second default. Two hundred expiries do not fit,
 * and timing out mid-loop closes an unpredictable number of them.
 */

test('a backlog too large for one invocation is closed in bounded batches', () => {
  const stale = Array.from({ length: CHECKOUT_EXPIRE_BUDGET + 5 }, (_, index) => session({ id: `cs_${index}` }));

  const { batch, deferred } = splitExpiryBatch(stale);

  assert.equal(batch.length, CHECKOUT_EXPIRE_BUDGET, 'one invocation must not attempt unbounded serial work');
  assert.equal(deferred, 5, 'what was not attempted has to be counted, not dropped');
  assert.ok(CHECKOUT_EXPIRE_BUDGET <= 25, 'a budget that cannot finish inside the function timeout is not a budget');
});

test('a backlog that fits is attempted whole, with nothing deferred', () => {
  const stale = Array.from({ length: 3 }, (_, index) => session({ id: `cs_${index}` }));

  const { batch, deferred } = splitExpiryBatch(stale);

  assert.equal(batch.length, 3);
  assert.equal(deferred, 0, 'the ordinary case must not be told to come back later');
  assert.deepEqual(splitExpiryBatch([]), { batch: [], deferred: 0 });
  assert.deepEqual(splitExpiryBatch(undefined), { batch: [], deferred: 0 }, 'a missing list is not a crash');
});

test('a deferred expiry stops the purchase, including the reuse path', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const refuse = source.indexOf('if (deferredExpiries > 0)');
  const reuse = source.indexOf('let session = plan.session;');
  const create = source.indexOf('stripe.checkout.sessions.create(');

  assert.ok(refuse > -1, 'sessions left open must stop the purchase');
  assert.ok(refuse < reuse, 'a deferred session is completable beside a REUSED one too, not only a new one');
  assert.ok(refuse < create, 'refusing after creating is not refusing');
  assert.match(source.slice(refuse, reuse), /retryable: true/, 'the backlog shrinks each attempt, so retrying works');

  // The loop must walk the bounded batch, not the whole list it came from.
  assert.match(source, /for \(const stale of expiring\)/);
  assert.doesNotMatch(source, /for \(const stale of plan\.expire\)/, 'the unbounded loop is the bug being fixed');
});

/*
 * The release was the second way into two concurrent session creations.
 *
 * The lock expires after two minutes so a dead serverless invocation cannot
 * wedge a workspace out of buying anything — but a SLOW one is not dead. A
 * stalls past the TTL, B legitimately reclaims, A finishes and clears the row
 * it no longer owns, and C walks in beside B. The claim was doing its job and
 * the release undid it.
 */

function fakeUpdateChain(recorder) {
  return {
    from(table) {
      recorder.table = table;
      return this;
    },
    update(values) {
      recorder.values = values;
      recorder.filters = [];
      return this;
    },
    // Chains like the real client: every `eq` returns the builder, and only
    // awaiting it runs the query. A fake that resolves on the first `eq` hides
    // the second filter — which is the entire subject of this test.
    eq(column, value) {
      recorder.filters.push([column, value]);
      return this;
    },
    then(resolve) {
      return Promise.resolve({ error: null }).then(resolve);
    },
  };
}

test('the release clears only the claim this request still holds', async () => {
  const recorder = { filters: [] };
  await releaseCheckoutLock(fakeUpdateChain(recorder), 'ws-1', 'token-a');

  assert.equal(recorder.table, 'workspace_billing_customers');
  assert.deepEqual(
    recorder.filters,
    [
      ['workspace_id', 'ws-1'],
      ['checkout_lock_token', 'token-a'],
    ],
    'matching the workspace alone clears whichever request holds the lock now, not this one',
  );
  assert.deepEqual(
    recorder.values,
    { checkout_lock_at: null, checkout_lock_token: null },
    'the holder must be cleared with the timestamp, or the next release matches a stale token',
  );
});

test('a request that never claimed does not release anything', async () => {
  let touched = false;
  const supabase = {
    from() {
      touched = true;
      return this;
    },
  };

  await releaseCheckoutLock(supabase, 'ws-1', '');

  assert.equal(touched, false, 'clearing the row on the strength of having FAILED to claim frees a rival lock');
});

test('the claim token is unguessable and per-request', async () => {
  const first = await claimCheckoutLock(fakeSupabase({ claimed: true }), 'ws-1');
  const second = await claimCheckoutLock(fakeSupabase({ claimed: true }), 'ws-1');

  assert.notEqual(first, second, 'two invocations sharing a token cannot tell each other apart');
  assert.match(first, /^[0-9a-f-]{36}$/, 'a token another request could predict is not ownership');
});

/*
 * The window the billing row cannot cover.
 *
 * `stripe_subscription_id` is written by the webhook, so a Checkout Session
 * that completed between the row read and the session listing is invisible to
 * both signals the endpoint had — gone from `status: 'open'`, not yet recorded.
 * Both said "nothing bought", and the request created a second completable
 * subscription whose upsert then erased the first webhook's id.
 */

function fakeSubscriptions(pages) {
  const calls = [];
  return {
    calls,
    subscriptions: {
      async list(params) {
        calls.push(params);
        return pages[calls.length - 1] ?? { data: [], has_more: false };
      },
    },
  };
}

test('a subscription Stripe already holds blocks another checkout', async () => {
  for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'paused', 'incomplete']) {
    const stripe = fakeSubscriptions([{ data: [{ id: `sub_${status}`, status }], has_more: false }]);
    const found = await findBlockingSubscription(stripe, 'cus_1');

    assert.equal(found.complete, true);
    assert.equal(found.subscription?.id, `sub_${status}`, `${status} leaves something Stripe can still bill`);
  }
});

test('a subscription that is over does not block a returning customer', async () => {
  for (const status of ['canceled', 'incomplete_expired']) {
    const stripe = fakeSubscriptions([{ data: [{ id: 'sub_dead', status }], has_more: false }]);
    const found = await findBlockingSubscription(stripe, 'cus_1');

    assert.equal(found.subscription, null, `${status} is over — a former customer must be able to come back`);
  }

  // Terminal ones are filtered rather than trusted out of the query: Stripe's
  // default omits `canceled` but still returns `incomplete_expired`.
  const mixed = fakeSubscriptions([
    {
      data: [
        { id: 'sub_dead', status: 'incomplete_expired' },
        { id: 'sub_live', status: 'active' },
      ],
      has_more: false,
    },
  ]);
  assert.equal((await findBlockingSubscription(mixed, 'cus_1')).subscription?.id, 'sub_live');
});

test('a subscription list that could not be finished is not proof of none', async () => {
  const stripe = fakeSubscriptions(
    Array.from({ length: STRIPE_PAGE_LIMIT + 2 }, () => ({
      data: [{ id: 'sub_x', status: 'canceled' }],
      has_more: true,
    })),
  );

  const found = await findBlockingSubscription(stripe, 'cus_1');
  assert.equal(found.complete, false, 'pages left unread cannot establish that nothing is billable');
});

test('the endpoint asks Stripe before it creates, and refuses both answers it cannot use', () => {
  const source = readFileSync('api/stripe/checkout.js', 'utf8');

  const claim = source.indexOf('await claimCheckoutLock(supabase, workspaceId)');
  const ask = source.indexOf('await findBlockingSubscription(stripe, stripeCustomerId)');
  const create = source.indexOf('stripe.checkout.sessions.create(');
  const reuse = source.indexOf('let session = plan.session;');

  assert.ok(ask > -1, 'the row cannot answer during the webhook window, so Stripe must be asked');
  assert.ok(claim < ask, 'two requests must not both ask and both proceed');
  assert.ok(ask < create && ask < reuse, 'asking after creating — or after reusing — is not asking');

  const guard = source.slice(ask, create);
  assert.match(guard, /if \(!existingSubscription\.complete\)/, 'a truncated list must refuse, not be read as none');
  assert.match(guard, /if \(existingSubscription\.subscription\)/, 'a live subscription must stop the purchase');
  assert.match(guard, /code: 'subscription_active'/);
});

test('one paginator serves both listings', () => {
  const source = readFileSync('api/_lib/checkout-session.js', 'utf8');

  // Two copies of a pagination loop is how the `has_more` half gets fixed in
  // one place and left wrong in the other.
  assert.equal((source.match(/response\?\.has_more/g) ?? []).length, 1, 'the walk must live in exactly one function');
  assert.match(source, /collectStripePages\(\(params\) =>\s*stripe\.checkout\.sessions\.list/);
  assert.match(source, /collectStripePages\(\(params\) =>\s*stripe\.subscriptions\.list/);
  assert.match(
    source,
    /stripeSubscriptionBlocksCheckout\(subscription\.status\)/,
    'which statuses block is existing policy, not a second list written beside it',
  );
});
