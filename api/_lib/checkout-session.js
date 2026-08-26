import { randomUUID } from 'node:crypto';
import { stripeSubscriptionBlocksCheckout } from './subscription-status.js';

/*
 * What to do about Checkout Sessions this workspace already has open.
 *
 * An empty `stripe_subscription_id` means no subscription EXISTS yet — it does
 * not mean none is on its way. A Checkout Session stays open for around 24
 * hours, and the row only gains a subscription id once the webhook lands after
 * payment. So the whole window between "seller clicked Subscribe" and "Stripe
 * told us it completed" looked, to the guard, exactly like a workspace that had
 * never tried to buy anything.
 *
 * A second tab, a double-click, or an ordinary retry therefore created another
 * independent `mode: 'subscription'` session. Both are completable. Complete
 * both and Stripe creates two subscriptions, the customer is billed twice, and
 * two webhook streams fight over one entitlement row.
 *
 * Stripe already knows what is open, so this asks Stripe rather than adding a
 * column to track it — one less thing to keep in step, and it stays correct
 * even for sessions created by a deployment that never wrote the row.
 *
 * The rule:
 *
 *   - An open session for the same tier and seat count is the SAME purchase.
 *     Send the seller back to it instead of starting a second one.
 *   - Any other open session is a different purchase left half-finished. Expire
 *     it, because a stale tab that can still be completed is the duplicate
 *     charge waiting to happen.
 *
 * Seat count is compared through metadata written at creation. A session from
 * before that metadata existed has no seat count, so it never matches and is
 * expired rather than reused — which is the safe direction: reusing a session
 * for the wrong number of seats charges the wrong amount.
 */

/**
 * @param {Array<object>|null|undefined} openSessions Sessions Stripe reports as open for this customer.
 * @param {{ workspaceId: string, tier: string, seatCount: number }} intent What the seller is trying to buy now.
 * @returns {{ action: 'reuse'|'create', session: object|null, expire: object[] }}
 */
export function planCheckoutSession(openSessions, intent) {
  const workspaceId = String(intent?.workspaceId ?? '');
  const tier = String(intent?.tier ?? '');
  const seatCount = String(intent?.seatCount ?? '');

  const mine = (Array.isArray(openSessions) ? openSessions : []).filter((session) => {
    if (!session || typeof session !== 'object') return false;
    // `status` and `mode` are checked here rather than trusted from the list
    // filter: a one-off payment session is not a subscription and expiring it
    // would cancel something unrelated.
    if (session.status !== 'open') return false;
    if (session.mode !== 'subscription') return false;
    return String(session.metadata?.workspace_id ?? '') === workspaceId;
  });

  const sameIntent = mine.find(
    (session) =>
      String(session.metadata?.workspace_tier ?? '') === tier &&
      String(session.metadata?.workspace_seats ?? '') === seatCount &&
      typeof session.url === 'string' &&
      session.url.length > 0,
  );

  if (sameIntent) {
    return { action: 'reuse', session: sameIntent, expire: mine.filter((session) => session !== sameIntent) };
  }

  return { action: 'create', session: null, expire: mine };
}

/**
 * How long a checkout claim stays held before another request may take it.
 *
 * The holder is a serverless invocation that can vanish mid-request, so the
 * claim expires on its own rather than requiring release. A lock only a live
 * process can free is a lock that eventually wedges a workspace out of buying
 * anything — far worse than the two minutes of waiting this costs in the rare
 * case where a request really did die holding it.
 */
export const CHECKOUT_LOCK_MS = 2 * 60 * 1000;

/**
 * Claim the right to create a Checkout Session for this workspace.
 *
 * Postgres serializes concurrent updates to the same row, so of N racing
 * requests exactly one gets a row back. That is the property two earlier
 * attempts could not provide: a Stripe idempotency key keyed on the intent only
 * de-duplicated identical submissions, and keying it on the workspace and the
 * current minute still let two requests straddling a minute boundary through.
 * Any key derived from time has a boundary somewhere.
 *
 * The claim records WHO holds it, not just that it is held, and the token comes
 * back so the release can prove ownership. Without that the release is
 * unconditional, and an invocation that outlives the two-minute expiry clears a
 * lock it no longer owns — A stalls past the TTL, B reclaims legitimately, A
 * finishes and wipes the row, and C enters beside B.
 *
 * A failed query is treated as NOT claimed. Unknown is not permission to create
 * a second billable session — the same fail-closed rule as the capacity gates.
 *
 * @returns {Promise<string>} The claim token, or '' when this request does not hold the claim.
 */
export async function claimCheckoutLock(supabase, workspaceId, now = new Date()) {
  const staleBefore = new Date(now.getTime() - CHECKOUT_LOCK_MS).toISOString();
  const token = randomUUID();

  /*
   * An RPC rather than a conditional UPDATE, because the row may not exist.
   *
   * `workspace_billing_customers` has no row until a workspace's first
   * purchase — the only writers are this flow and the webhook that runs after
   * payment. A plain `update ... where workspace_id = $1` therefore matches
   * nothing and reports "someone else holds it", refusing every FIRST checkout:
   * the one path that has to work.
   *
   * `xbar_claim_checkout_lock` is a single `insert ... on conflict do update
   * ... where ... returning`, so it seeds the row and claims it, or claims an
   * existing row only when the lock is free or stale — atomically either way.
   */
  const { data, error } = await supabase.rpc('xbar_claim_checkout_lock', {
    p_workspace_id: workspaceId,
    p_stale_before: staleBefore,
    p_token: token,
  });

  if (error) {
    console.error('Claiming the checkout lock failed.', error);
    return '';
  }

  return data === true ? token : '';
}

/**
 * Release the claim so a legitimate retry does not wait out the expiry.
 *
 * Matched on the token, so this only ever clears a lock THIS request still
 * holds. An unconditional clear is not a smaller version of the same thing: an
 * invocation slow enough to outlive the two-minute expiry would wipe the lock a
 * later request had legitimately taken, letting a third in beside it — two
 * concurrent session creations, arrived at through the release rather than the
 * claim.
 *
 * Best effort otherwise, by design: the expiry above is what actually
 * guarantees progress, and a failed release must never turn a completed
 * checkout into an error.
 */
export async function releaseCheckoutLock(supabase, workspaceId, token) {
  // No token means this request never held the claim. Clearing the row here
  // would be releasing someone else's lock on the strength of having failed.
  if (!token) return;

  try {
    await supabase
      .from('workspace_billing_customers')
      .update({ checkout_lock_at: null, checkout_lock_token: null })
      .eq('workspace_id', workspaceId)
      .eq('checkout_lock_token', token);
  } catch (error) {
    console.warn('Releasing the checkout lock failed; it will expire on its own.', error);
  }
}

/** Whether Stripe refused because another checkout for this workspace is in flight. */
export function isIdempotencyConflict(error) {
  const type = error && typeof error === 'object' ? String(error.type ?? '') : '';
  return type === 'idempotency_error';
}

/**
 * What to do when expiring a stale session failed.
 *
 * Treating every failure as harmless was wrong in one specific and expensive
 * way. `expire` throws for a session that is already dead — fine — but also for
 * one that COMPLETED between the list and the call, and that is a purchase that
 * just succeeded. Shrugging and creating a new session there produces the exact
 * second subscription this whole path exists to prevent, and the billing row
 * cannot save us: it was read before any of this and still shows no
 * subscription, because the webhook has not landed yet.
 *
 * So the session is re-read and its real status decides:
 *
 *   - `expired`  the race was harmless. Carry on.
 *   - `complete` a subscription is on its way. Refuse; the webhook will settle
 *                the entitlement, and the seller must not be charged twice.
 *   - anything else, including a failed re-read, is unknown — and unknown is
 *     not permission to charge. Refuse and let them retry.
 *
 * @param {object|null|undefined} session The session as re-read from Stripe, or null if that failed.
 * @returns {'proceed'|'refuse_completed'|'refuse_unverified'}
 */
export function resolveExpiryFailure(session) {
  const status = session && typeof session === 'object' ? String(session.status ?? '') : '';
  if (status === 'expired') return 'proceed';
  if (status === 'complete') return 'refuse_completed';
  return 'refuse_unverified';
}

/**
 * How many sessions to ask Stripe for per page. 100 is Stripe's maximum.
 */
export const STRIPE_PAGE_SIZE = 100;

/**
 * How many pages to walk before giving up and refusing.
 *
 * An unbounded loop inside a serverless invocation is its own hazard, so the
 * walk is capped — but the cap is set far above anything a real customer can
 * reach. Open sessions die after about 24 hours and this endpoint is rate
 * limited to 10 attempts a minute, so 1000 simultaneously-open sessions is not
 * a busy seller retrying; it is someone who set out to build that pile.
 */
export const STRIPE_PAGE_LIMIT = 10;

/**
 * Every Checkout Session Stripe currently reports as open for this customer.
 *
 * A single `list` call is not "the open sessions", it is the first page of
 * them. The previous version asked for 10 and ignored `has_more`, which was
 * fine for the case it was written against — one seller, one stray tab — and
 * wrong for the case that actually produces a pile: repeated attempts under the
 * old flow, which created a fresh completable session every time and expired
 * none of them. Session number 11 stayed invisible to the plan, stayed
 * completable in whatever tab it was left in, and completing it after this
 * request's session created the second subscription this whole path exists to
 * prevent.
 *
 * `complete` is false when the walk stopped with pages still unread. The caller
 * must refuse in that case rather than plan from what it managed to read: a
 * partial list cannot show that nothing else is completable, and the rule
 * everywhere in this flow is that unknown is not permission to charge.
 *
 * @returns {Promise<{ sessions: object[], complete: boolean }>}
 */
/**
 * Walk a Stripe list endpoint to the end, or report that it could not.
 *
 * One paginator rather than one per resource. Two copies of this loop is how
 * every drift in this PR started, and the halves that matter — reading
 * `has_more`, advancing from the last id, refusing to call a truncated walk
 * complete — are exactly the ones easy to get subtly different the second time.
 *
 * @param {(params: object) => Promise<{ data?: object[], has_more?: boolean }>} fetchPage
 * @returns {Promise<{ items: object[], complete: boolean }>}
 */
export async function collectStripePages(fetchPage) {
  const items = [];
  let startingAfter = '';

  for (let page = 0; page < STRIPE_PAGE_LIMIT; page += 1) {
    const response = await fetchPage(
      startingAfter ? { limit: STRIPE_PAGE_SIZE, starting_after: startingAfter } : { limit: STRIPE_PAGE_SIZE },
    );
    const data = Array.isArray(response?.data) ? response.data : [];
    items.push(...data);

    if (!response?.has_more) return { items, complete: true };

    // `has_more` with nothing to page from leaves no cursor to continue with.
    // Reporting that as complete would be inventing the assurance the caller
    // is about to rely on.
    const cursor = data.length > 0 ? String(data[data.length - 1]?.id ?? '') : '';
    if (!cursor) return { items, complete: false };
    startingAfter = cursor;
  }

  return { items, complete: false };
}

export async function listOpenCheckoutSessions(stripe, customerId) {
  const { items, complete } = await collectStripePages((params) =>
    stripe.checkout.sessions.list({ customer: customerId, status: 'open', ...params }),
  );
  return { sessions: items, complete };
}

/**
 * A subscription Stripe already holds for this customer that forbids buying
 * another one.
 *
 * This exists because the billing row cannot answer the question during the
 * window that matters. `stripe_subscription_id` is written by the webhook, so a
 * Checkout Session that COMPLETED a moment ago shows up in neither signal the
 * endpoint had: it is gone from the open-session list, and the row is still
 * empty. Both said "this workspace has bought nothing", and the request created
 * a second completable subscription — and its upsert then erased the first
 * webhook's id when that landed.
 *
 * Stripe knows immediately, because completing a `mode: 'subscription'` session
 * creates the subscription. So the authoritative source is asked directly.
 *
 * Which statuses block is NOT decided here. `stripeSubscriptionBlocksCheckout`
 * is the policy the rest of the flow already uses — everything but `canceled`
 * and `incomplete_expired` leaves something Stripe can still bill or a plan
 * that must be changed in the portal — and a second, narrower list written
 * beside it is how these two answers drift apart.
 *
 * @returns {Promise<{ subscription: object|null, complete: boolean }>}
 */
export async function findBlockingSubscription(stripe, customerId) {
  // Stripe's default omits `canceled`; `incomplete_expired` still comes back
  // and is filtered below rather than trusted from the query.
  const { items, complete } = await collectStripePages((params) =>
    stripe.subscriptions.list({ customer: customerId, ...params }),
  );

  const blocking = items.find(
    (subscription) =>
      subscription && typeof subscription === 'object' && stripeSubscriptionBlocksCheckout(subscription.status),
  );

  return { subscription: blocking ?? null, complete };
}

/**
 * How many stale sessions one invocation will close before deferring the rest.
 *
 * Reading every page of open sessions fixed a real duplicate-billing hole and
 * introduced a smaller one: the plan's expiry list used to be capped at 10 by
 * the single-page read, and each entry is a serial round trip to Stripe. No
 * `maxDuration` is configured for this endpoint, so it runs on Vercel's default
 * of ten to fifteen seconds — enough for roughly twenty expiries at a couple of
 * hundred milliseconds each, and not enough for two hundred.
 *
 * Timing out mid-loop is not a data-loss bug (the claim expires, some sessions
 * did close, the retry resumes) but it spends the customer's time failing
 * opaquely. Closing a bounded batch and saying so does the same work visibly.
 */
export const CHECKOUT_EXPIRE_BUDGET = 20;

/**
 * Split the sessions to expire into what this invocation will attempt now and
 * how many it is leaving for the next one.
 *
 * The caller must refuse when anything is deferred. A session left open is
 * completable in whatever tab it was abandoned in, so creating a new one beside
 * it is the duplicate charge — the same reason the whole expiry step exists.
 * Refusing is safe to retry rather than a dead end: each attempt closes another
 * batch, so the backlog shrinks by `CHECKOUT_EXPIRE_BUDGET` every time.
 *
 * @returns {{ batch: object[], deferred: number }}
 */
export function splitExpiryBatch(expire, budget = CHECKOUT_EXPIRE_BUDGET) {
  const all = Array.isArray(expire) ? expire : [];
  return { batch: all.slice(0, budget), deferred: Math.max(0, all.length - budget) };
}
