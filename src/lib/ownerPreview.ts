/*
 * Owner preview: look at what a tier includes without buying it, and without
 * damaging the workspace's real billing record.
 *
 * What this replaces. The previous operator bridge reacted to a comped email by
 * calling `applySubscriptionTier('Enterprise', { billingState: 'Manual Billing' })`,
 * which writes into the workspace's actual subscription — the same field a real
 * plan lives in, persisted, and synced. Previewing a tier therefore overwrote
 * the record of what the customer was really on, and there was no way back to
 * it. Preview here is a read-time overlay: nothing is written, so "return to my
 * real plan" is just switching the overlay off.
 *
 * What authorizes it. Two sources, and neither is something a visitor can turn
 * on:
 *
 *   1. The comp allowlist (VITE_XBAR_COMP_EMAILS), which only matters once a
 *      real session exists and which the server mirrors with XBAR_COMP_EMAILS.
 *      The server is what actually grants cloud entitlements; this is the
 *      client's matching view of a decision made there.
 *
 *   2. The local development flag (VITE_XBAR_LOCAL_OWNER_MODE), for working on
 *      a machine with no cloud account at all. It is compiled in at build time
 *      and additionally requires a dev build, so a production bundle cannot
 *      honour it even if the variable is set in the deploy environment.
 *
 * What it never does. It never grants server or cloud permission. Every cloud
 * action is authorized by the API against the real account, which has no idea
 * this overlay exists — so a local preview of Enterprise cannot create
 * Enterprise-limit data in a real workspace.
 */

import type { SubscriptionTier } from '../types/xbar.js';
import { compConfig, ownerPreviewConfig } from './platformConfig.js';
import { emailInAllowlist } from './compAccess.js';

export const PREVIEWABLE_TIERS: readonly SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

/** Where the authorization to preview came from, or why there is none. */
export type OwnerPreviewAuthorization =
  { authorized: true; source: 'comp-allowlist' | 'local-dev-flag' } | { authorized: false; reason: string };

export type OwnerPreviewEnvironment = {
  /** Signed-in email, or empty when there is no session. */
  sessionEmail: string;
  /** Emails granted comp access, mirrored from the server allowlist. */
  compEmails: readonly string[];
  /** VITE_XBAR_LOCAL_OWNER_MODE. */
  localFlagEnabled: boolean;
  /** True only for a dev server build. */
  isDevBuild: boolean;
  /** True for anything produced by `vite build`. */
  isProdBuild: boolean;
};

/**
 * Decide whether owner preview may be offered at all.
 *
 * Pure and fully parameterized so every branch — including the production
 * block, which cannot be reached from a test otherwise — is directly testable.
 */
export function resolveOwnerPreviewAuthorization(env: OwnerPreviewEnvironment): OwnerPreviewAuthorization {
  // The allowlist is checked first and is the only source that works in a
  // deployed build, because it corresponds to a grant the server also honours.
  if (env.sessionEmail && emailInAllowlist(env.sessionEmail, env.compEmails)) {
    return { authorized: true, source: 'comp-allowlist' };
  }

  if (!env.localFlagEnabled) {
    return {
      authorized: false,
      reason: 'Owner test mode is off. It is enabled per build, not from the app.',
    };
  }

  // Belt and braces: a production bundle refuses even with the flag compiled
  // in. isProdBuild and isDevBuild are checked independently rather than as
  // each other's negation, so an environment that reports neither (a bare test
  // runner, an unexpected bundler) is treated as unsafe rather than as dev.
  if (env.isProdBuild || !env.isDevBuild) {
    return {
      authorized: false,
      reason: 'Owner test mode is disabled in production builds.',
    };
  }

  return { authorized: true, source: 'local-dev-flag' };
}

/** Authorization for the running app. */
export function ownerPreviewAuthorization(sessionEmail: string | null | undefined): OwnerPreviewAuthorization {
  return resolveOwnerPreviewAuthorization({
    sessionEmail: (sessionEmail ?? '').trim(),
    compEmails: compConfig.emails,
    localFlagEnabled: ownerPreviewConfig.localFlagEnabled,
    isDevBuild: ownerPreviewConfig.isDevBuild,
    isProdBuild: ownerPreviewConfig.isProdBuild,
  });
}

/**
 * How far a previewed tier can actually be exercised.
 *
 * The distinction is the whole point of showing it. A comped account is backed
 * by the server allowlist, so cloud writes at that tier genuinely succeed. A
 * local dev preview is the UI only — the API will still answer according to the
 * real account, so anything that touches the cloud will be refused.
 */
export type OwnerPreviewReach = 'local-only' | 'cloud-ready' | 'cloud-active';

export function ownerPreviewReach(
  authorization: OwnerPreviewAuthorization,
  hasCloudSession: boolean,
): OwnerPreviewReach {
  if (!authorization.authorized) return 'local-only';
  if (authorization.source === 'local-dev-flag') return 'local-only';
  return hasCloudSession ? 'cloud-active' : 'cloud-ready';
}

export function ownerPreviewReachLabel(reach: OwnerPreviewReach): string {
  switch (reach) {
    case 'cloud-active':
      return 'Cloud active';
    case 'cloud-ready':
      return 'Cloud ready';
    default:
      return 'Local only';
  }
}

export function ownerPreviewReachDetail(reach: OwnerPreviewReach): string {
  switch (reach) {
    case 'cloud-active':
      return 'Your account is on the operator allowlist, so cloud actions run at this tier too.';
    case 'cloud-ready':
      return 'Your email is on the operator allowlist. Sign in to a cloud workspace to use this tier for real work.';
    default:
      return 'Preview only. Cloud actions are still authorized against your real account, so they will be refused at this tier.';
  }
}

/** Why a feature is unavailable, phrased for whoever is looking at it. */
export function featureUnavailableReason(options: {
  feature: string;
  requiredTier: SubscriptionTier;
  effectiveTier: SubscriptionTier;
  previewing: boolean;
  reach: OwnerPreviewReach;
}): string {
  const { feature, requiredTier, effectiveTier, previewing, reach } = options;

  if (previewing && reach === 'local-only') {
    return `${feature} needs ${requiredTier}. You are previewing ${effectiveTier} locally, so the screen is available but cloud actions behind it are not.`;
  }

  if (previewing) {
    return `${feature} needs ${requiredTier}. You are previewing ${effectiveTier}.`;
  }

  return `${feature} is included with ${requiredTier}. Your plan is ${effectiveTier}.`;
}

export function isPreviewableTier(value: unknown): value is SubscriptionTier {
  return typeof value === 'string' && (PREVIEWABLE_TIERS as readonly string[]).includes(value);
}
