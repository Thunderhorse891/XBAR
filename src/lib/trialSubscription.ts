import type { SubscriptionProfile, SubscriptionTier } from '../types/xbar.js';
import { isEntitledBillingState } from './subscriptionDecision.js';
import { subscriptionTierConfig } from './xbarRuntime.js';

/**
 * The 14-day Professional trial policy (client side).
 *
 * A trial is recorded on the profile as `trialStart` (ISO timestamp), written
 * by the server when the workspace starts it and read back from the
 * subscription row on every load — so it survives reloads, and expiry is
 * evaluated fresh each time rather than stored. The server-side twin is
 * `api/_lib/trial-status.js`; the trial constants are pinned together by the
 * client/server parity test.
 *
 * Client gates read the profile this module produces. Anything the API
 * enforces is decided server-side in `api/_lib/entitlements.js` — a
 * client-side flag alone never authorizes a server action.
 */

/** The only plan a trial may grant. The server never takes a tier parameter. */
export const TRIAL_PLAN_TIER: SubscriptionTier = 'Professional';

/** Trial length in days. Mirrored by api/_lib/trial-status.js. */
export const TRIAL_LENGTH_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TrialState = 'active' | 'expired' | 'none';

/** Parse a stored trial start defensively: garbage is "no trial", never a crash. */
export function parseTrialStart(value: unknown): Date | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/** The instant a trial starting at `start` lapses. */
export function trialEndDate(start: Date): Date {
  return new Date(start.getTime() + TRIAL_LENGTH_DAYS * MS_PER_DAY);
}

/**
 * 'active' | 'expired' | 'none' for a stored `trialStart` at `now`.
 *
 * A future-dated start has not begun yet, so it is not active — a corrupt or
 * tampered clock value cannot grant features.
 */
export function getTrialState(trialStart: string | undefined, now: Date = new Date()): TrialState {
  const start = parseTrialStart(trialStart);
  if (!start) return 'none';
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs) || start.getTime() > nowMs) return 'none';
  return nowMs < trialEndDate(start).getTime() ? 'active' : 'expired';
}

/** Whole days left, rounded up, or 0 when the trial is not active. */
export function trialDaysRemaining(trialStart: string | undefined, now: Date = new Date()): number {
  const start = parseTrialStart(trialStart);
  if (!start || getTrialState(trialStart, now) !== 'active') return 0;
  return Math.max(1, Math.ceil((trialEndDate(start).getTime() - now.getTime()) / MS_PER_DAY));
}

/**
 * Resolve a stored profile to what the workspace may actually use right now.
 *
 * An active trial grants the Professional feature set: tier, limits, shared
 * access and feature flags all come from the Professional plan. What was
 * bought (`purchasedTier`), what is billed (`monthlyRate`, `billingState`),
 * and the trial marker itself (`trialStart`) are carried through untouched —
 * a trial is not a purchase, and expiry must find the original values still
 * there.
 *
 * Two things this deliberately does not do:
 *
 * - It never downgrades. A workspace the billing state already entitles to a
 *   paid tier keeps that tier, even with a trial record present (for example
 *   a subscription bought mid-trial).
 * - It never extends. Only `trialStart` is read; the window is always exactly
 *   TRIAL_LENGTH_DAYS from it, computed here and on the server.
 */
export function applyTrialToProfile(profile: SubscriptionProfile, now: Date = new Date()): SubscriptionProfile {
  if (getTrialState(profile.trialStart, now) !== 'active') return profile;
  if (isEntitledBillingState(profile.billingState) && profile.tier !== 'Starter') return profile;

  const config = subscriptionTierConfig[TRIAL_PLAN_TIER];
  return {
    ...profile,
    tier: TRIAL_PLAN_TIER,
    sharedAccessEnabled: config.sharedAccessEnabled,
    featureFlags: [...config.featureFlags],
    usage: {
      ...profile.usage,
      horseLimit: config.limits.horseLimit,
      seatLimit: config.limits.seatLimit,
      documentLimit: config.limits.documentLimit,
      salePacketLimit: config.limits.salePacketLimit,
      storageLimitGb: config.limits.storageLimitGb,
      sharedAccessSeatLimit: config.limits.sharedAccessSeatLimit,
    },
  };
}

/** Rancher-facing copy for the trial states. Professional tone, no hype. */
export function trialStatusCopy(
  state: TrialState,
  daysRemaining: number,
): { eyebrow: string; heading: string; message: string } {
  switch (state) {
    case 'active':
      return {
        eyebrow: 'Professional trial',
        heading: 'Trial active',
        message: `Your Professional trial ends in ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}. Choose a plan to keep these features.`,
      };
    case 'expired':
      return {
        eyebrow: 'Professional trial',
        heading: 'Trial ended',
        message: 'Your 14-day Professional trial has ended. Choose a plan below to restore Professional features.',
      };
    default:
      return {
        eyebrow: 'Professional trial',
        heading: 'Try Professional free for 14 days',
        message: 'Try every Professional feature free for 14 days. No card required.',
      };
  }
}
