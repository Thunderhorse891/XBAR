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
