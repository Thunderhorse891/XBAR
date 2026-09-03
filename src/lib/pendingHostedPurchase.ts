import type { SubscriptionTier } from '../types/xbar.js';

/*
 * A purchase this deployment cannot confirm for itself.
 *
 * Hosted payment links are the whole billing route when managed billing is
 * off, and that deployment has no webhook — `/api/health` says so in as many
 * words. So completing a checkout changes nothing the app can see: the profile
 * still reads Starter, the plan buttons are still enabled, and a customer
 * coming back from Stripe to a page that has not moved does the obvious thing
 * and buys again. Stripe is happy to sell them a second subscription.
 *
 * Nothing here can KNOW whether the payment happened — that is what the
 * missing webhook was for. What it can do is remember that a purchase was
 * started and stop the app cheerfully offering the same one again, which is
 * the accidental double charge rather than the determined one.
 */
export interface PendingHostedPurchase {
  tier: SubscriptionTier;
  /** ISO timestamp of the redirect to Stripe. */
  startedAt: string;
  /**
   * Which workspace started it. `''` for a local-only session, which is the
   * `no_managed_identity` route and has no workspace id by definition.
   */
  workspaceId: string;
}

/*
 * Scoped to a workspace, because browser storage is not.
 *
 * A single key held one marker for the whole origin, so a rancher who manages
 * two workspaces in one browser carried workspace A's pending purchase into
 * workspace B: B was blocked from buying for a day with a notice about a
 * purchase it never made, and clearing it to let B through removed A's
 * duplicate-charge protection at the same time. One marker cannot serve two
 * workspaces, so there is one per workspace.
 *
 * The id is in the KEY so the two never contend, and in the VALUE so a marker
 * that somehow reaches the wrong key is still ignored rather than believed.
 */
export const PENDING_HOSTED_PURCHASE_KEY_PREFIX = 'xbar-pending-hosted-purchase';

export function pendingHostedPurchaseKey(workspaceId: string): string {
  return `${PENDING_HOSTED_PURCHASE_KEY_PREFIX}:${workspaceId || 'local'}`;
}

/*
 * How long a started purchase keeps blocking another one.
 *
 * Long enough to cover a manual grant that waits for someone's morning, short
 * enough that an ABANDONED checkout does not lock a customer out of buying at
 * all. Neither number is safe on its own, which is why the screen also offers
 * an explicit way out — a customer who knows they did not pay should not have
 * to wait a day to say so.
 */
export const PENDING_HOSTED_PURCHASE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function parsePendingHostedPurchase(raw: string | null): PendingHostedPurchase | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    // Both fields must be strings. A damaged entry that blocked checkout would
    // be a stored value stopping someone from paying, which is the worse
    // failure of the two available here.
    if (typeof record.tier !== 'string' || typeof record.startedAt !== 'string') return null;
    /*
     * A marker without a workspace was written before this field existed. It is
     * refused rather than adopted: guessing which workspace it belonged to
     * could block the wrong one, and losing a guard leans toward letting
     * someone buy, which is the direction every default here takes.
     */
    if (typeof record.workspaceId !== 'string') return null;
    if (!record.tier.trim() || Number.isNaN(Date.parse(record.startedAt))) return null;
    return {
      tier: record.tier as SubscriptionTier,
      startedAt: record.startedAt,
      workspaceId: record.workspaceId,
    };
  } catch {
    return null;
  }
}

/**
 * Whether a started purchase is still recent enough to hold checkout closed,
 * and belongs to the workspace asking.
 */
export function isPendingHostedPurchase(
  pending: PendingHostedPurchase | null,
  now: Date,
  workspaceId: string,
): boolean {
  if (!pending) return false;
  // Another workspace's purchase is not this workspace's problem, and treating
  // it as one blocks a sale that has nothing to do with it.
  if (pending.workspaceId !== workspaceId) return false;
  const startedAt = Date.parse(pending.startedAt);
  if (Number.isNaN(startedAt)) return false;
  const age = now.getTime() - startedAt;
  // A future timestamp is a clock that moved, not a purchase from tomorrow.
  // Treating it as pending is the safe reading: it stops a second charge.
  return age < PENDING_HOSTED_PURCHASE_WINDOW_MS;
}

/**
 * What the customer is told, in the terms that are actually true here.
 *
 * Not "your plan is active" — nothing knows that. The honest statement is that
 * the purchase was started, that this deployment turns access on by hand, and
 * that they should not pay twice while it is being sorted out.
 */
export function pendingHostedPurchaseNotice(pending: PendingHostedPurchase): string {
  return `You started a ${pending.tier} purchase on ${pending.startedAt.slice(0, 10)}. This workspace activates paid plans by hand, so access turns on once someone confirms the payment — buying again would charge you a second time.`;
}

/*
 * All storage access for the marker lives here, and there is a reason beyond
 * tidiness: the screen cached the parsed marker in component state and read it
 * once. Two billing tabs open at the same time therefore both started with
 * `null`, and after the first redirected the second still believed nothing was
 * pending — so it opened a second static checkout and the customer was charged
 * twice. The guard has to be answered from STORAGE at the moment of the
 * redirect, not from whatever the tab remembered when it loaded.
 *
 * Every accessor swallows its own failure. Private windows and blocked storage
 * throw on access, and losing the guard is bad while refusing to render the
 * billing screen — or refusing to sell — is worse.
 */
export function readPendingHostedPurchase(workspaceId: string): PendingHostedPurchase | null {
  try {
    return parsePendingHostedPurchase(window.localStorage.getItem(pendingHostedPurchaseKey(workspaceId)));
  } catch {
    return null;
  }
}

export function writePendingHostedPurchase(pending: PendingHostedPurchase): void {
  try {
    window.localStorage.setItem(pendingHostedPurchaseKey(pending.workspaceId), JSON.stringify(pending));
  } catch {
    // The redirect still happens: a storage failure must not stop someone
    // buying. It only costs the second-charge guard on this device.
  }
}

export function clearPendingHostedPurchase(workspaceId: string): void {
  try {
    window.localStorage.removeItem(pendingHostedPurchaseKey(workspaceId));
  } catch {
    // Nothing to do — the caller's own state is what the screen reads.
  }
}

/*
 * A claim, not a check followed by a write.
 *
 * Reading the marker and then writing it is not one act. Two billing tabs
 * whose customer clicks Buy in both at nearly the same moment can each finish
 * the read before either has written: both see nothing pending, both write,
 * and both redirect to a static payment link that can be completed on its own.
 * The storage event cannot close that window, because it only fires AFTER a
 * write — by which time the other tab has already read and decided.
 *
 * Web Locks is the one cross-tab mutual exclusion a browser offers without a
 * server. The read and the write both happen inside it, so the second tab
 * cannot look until the first has finished writing, and then sees the marker.
 *
 * The lock is released when this tab navigates away, which is correct: what
 * the next tab must see is the written marker, and that outlives the lock.
 */
interface PendingPurchaseLockManager {
  request<T>(name: string, run: () => Promise<T>): Promise<T>;
}

export const PENDING_HOSTED_PURCHASE_LOCK = 'xbar-pending-hosted-purchase-claim';

function pendingPurchaseLockManager(): PendingPurchaseLockManager | null {
  try {
    const locks = (navigator as Navigator & { locks?: PendingPurchaseLockManager }).locks;
    return locks && typeof locks.request === 'function' ? locks : null;
  } catch {
    return null;
  }
}

/**
 * Runs `body` under the cross-tab claim lock, or plainly where there is none.
 *
 * A non-secure context, an older browser and a test runner all lack
 * `navigator.locks`. Degrading to the unlocked read-then-write is exactly the
 * behaviour that shipped before this existed, so it costs nothing that was
 * there — whereas refusing to sell because a browser has no lock would be the
 * worse of the two failures, the same direction every default here takes.
 */
export async function withPendingPurchaseLock<T>(body: () => T): Promise<T> {
  const locks = pendingPurchaseLockManager();
  if (!locks) return body();
  let entered = false;
  try {
    return await locks.request(PENDING_HOSTED_PURCHASE_LOCK, () => {
      entered = true;
      return Promise.resolve(body());
    });
  } catch (error) {
    /*
     * Only the lock manager's own refusal falls back. Once the critical
     * section has started, a failure inside it is that failure: running it
     * again could write a second marker for a single click.
     */
    if (entered) throw error;
    return body();
  }
}

export type PendingHostedPurchaseClaim =
  { claimed: true; pending: PendingHostedPurchase } | { claimed: false; blockedBy: PendingHostedPurchase };

/**
 * Claims the right to start one hosted purchase for a workspace.
 *
 * `enforceGuard` is false once a subscription is already active — that
 * customer is managing a plan they hold rather than being sold a second one,
 * and the duplicate-charge guard is not theirs to trip over. The write still
 * happens inside the lock either way, so the two paths cannot interleave.
 */
export function claimPendingHostedPurchase(
  pending: PendingHostedPurchase,
  now: Date,
  enforceGuard: boolean,
): Promise<PendingHostedPurchaseClaim> {
  return withPendingPurchaseLock<PendingHostedPurchaseClaim>(() => {
    const existing = readPendingHostedPurchase(pending.workspaceId);
    if (enforceGuard && existing && isPendingHostedPurchase(existing, now, pending.workspaceId)) {
      return { claimed: false, blockedBy: existing };
    }
    writePendingHostedPurchase(pending);
    return { claimed: true, pending };
  });
}

/**
 * Carry a local ranch's pending purchase into the workspace it becomes.
 *
 * The marker is scoped to a workspace on purpose — one browser can hold two
 * ranches, and a purchase started by one must not block the other. Signing in
 * is the case that scoping alone gets wrong: the same person, the same
 * browser, the same purchase, and a new `workspaceId`. Both the screen and the
 * claim then look under a key nobody wrote, so a payment link already
 * completed and waiting on a manual grant would be offered again inside the
 * same window.
 *
 * `startedAt` is carried across unchanged. Restamping it would extend the
 * window past the purchase it describes, and the window is the only thing
 * bounding how long an abandoned checkout keeps someone from buying.
 */
export function migratePendingHostedPurchase(fromWorkspaceId: string, toWorkspaceId: string): void {
  if (!toWorkspaceId || toWorkspaceId === 'local') return;
  if (pendingHostedPurchaseKey(fromWorkspaceId) === pendingHostedPurchaseKey(toWorkspaceId)) return;

  const carried = readPendingHostedPurchase(fromWorkspaceId);
  if (!carried) return;

  /*
   * A marker already under the destination is the workspace's own, and it is
   * the one that belongs there. The stale copy is dropped rather than merged:
   * keeping it would hand the same guard two answers on the next promotion.
   */
  if (!readPendingHostedPurchase(toWorkspaceId)) {
    writePendingHostedPurchase({ ...carried, workspaceId: toWorkspaceId });
  }
  clearPendingHostedPurchase(fromWorkspaceId);
}
