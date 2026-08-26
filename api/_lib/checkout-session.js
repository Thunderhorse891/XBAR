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
 * A failed query is treated as NOT claimed. Unknown is not permission to create
 * a second billable session — the same fail-closed rule as the capacity gates.
 *
 * @returns {Promise<boolean>} true only when this request holds the claim.
 */
export async function claimCheckoutLock(supabase, workspaceId, now = new Date()) {
  const staleBefore = new Date(now.getTime() - CHECKOUT_LOCK_MS).toISOString();

  const { data, error } = await supabase
    .from('workspace_billing_customers')
    .update({ checkout_lock_at: new Date(now).toISOString() })
    .eq('workspace_id', workspaceId)
    .or(`checkout_lock_at.is.null,checkout_lock_at.lt.${staleBefore}`)
    .select('workspace_id');

  if (error) {
    console.error('Claiming the checkout lock failed.', error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
}

/**
 * Release the claim so a legitimate retry does not wait out the expiry.
 *
 * Best effort by design: the expiry above is what actually guarantees progress,
 * and a failed release must never turn a completed checkout into an error.
 */
export async function releaseCheckoutLock(supabase, workspaceId) {
  try {
    await supabase
      .from('workspace_billing_customers')
      .update({ checkout_lock_at: null })
      .eq('workspace_id', workspaceId);
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
