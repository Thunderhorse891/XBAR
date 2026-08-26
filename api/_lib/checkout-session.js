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
 * A key that collapses duplicate submissions of the same purchase.
 *
 * Listing open sessions closes the "other tab from ten minutes ago" case, but
 * two POSTs racing each other can both list before either has created anything.
 * This makes Stripe itself return one session for that pair.
 *
 * Bucketed by the minute on purpose. A key with no time component would make a
 * legitimate retry hours later replay the original session — which by then may
 * have expired, handing the seller a dead link. A minute is long enough to
 * cover a double submit and short enough that a real second attempt gets a real
 * second session.
 */
export function checkoutIdempotencyKey(intent, now = new Date()) {
  const minute = new Date(now).toISOString().slice(0, 16);
  return `checkout:${intent?.workspaceId ?? ''}:${intent?.tier ?? ''}:${intent?.seatCount ?? ''}:${minute}`;
}
