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
}

export const PENDING_HOSTED_PURCHASE_KEY = 'xbar-pending-hosted-purchase';

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
    if (!record.tier.trim() || Number.isNaN(Date.parse(record.startedAt))) return null;
    return { tier: record.tier as SubscriptionTier, startedAt: record.startedAt };
  } catch {
    return null;
  }
}

/** Whether a started purchase is still recent enough to hold checkout closed. */
export function isPendingHostedPurchase(pending: PendingHostedPurchase | null, now: Date): boolean {
  if (!pending) return false;
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
