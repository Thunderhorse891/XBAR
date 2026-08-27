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
 * What it never does. It never relaxes a gate on a WRITE. Previewing changes
 * which screens and features an owner can see; the gates that decide whether a
 * record may be created — horses, document intakes, sale packets, invitations,
 * listings, deal rooms — all evaluate the real subscription.
 *
 * That boundary is load-bearing, and it used to sit in the wrong place. The
 * reasoning for letting a preview through a write gate was that "every cloud
 * action is authorized by the API against the real account", which is not true
 * of the ordinary configuration: with relational sync off,
 * `saveWorkspaceBackupToCloud` falls back to a direct `workspace_snapshots`
 * upsert whose RLS checks row ownership and says nothing about entitlements.
 * There is no API in that path to refuse anything, so records created under a
 * previewed tier were persisted to the cloud and read back later.
 *
 * Pausing sync during a preview would not have been enough either — the
 * over-limit records still exist locally and sync as soon as the preview ends.
 * Granting capacity for real is a server-side entitlement and has to come from
 * the subscription record, not from an overlay the server has never heard of.
 */

import type { SubscriptionTier } from '../types/xbar.js';
import { compConfig, ownerPreviewConfig } from './platformConfig.js';
import { emailInAllowlist } from './compAccess.js';

export const PREVIEWABLE_TIERS: readonly SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

/** Where the authorization to preview came from, or why there is none. */
export type OwnerPreviewAuthorization =
  | { authorized: true; source: 'comp-allowlist' | 'local-dev-flag' }
  /*
   * `configured` says whether THIS BUILD was set up for owner preview at all —
   * an allowlist compiled in, or the local flag set.
   *
   * It exists so the refusal can be shown to the operator without being shown
   * to a customer. On a build with neither, owner preview is not a thing that
   * exists and saying anything about it would be noise on someone else's
   * screen. On a build the operator configured themselves, silence is the
   * problem: the bar rendered nothing, and there was no way to tell a missing
   * env var from a missing session.
   */
  | { authorized: false; reason: string; configured: boolean };

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

  const configured = env.compEmails.length > 0 || env.localFlagEnabled;

  /*
   * An allowlist with nobody signed in is the case that used to lie.
   *
   * It fell through to the local-flag branch and reported "Owner test mode is
   * off. It is enabled per build, not from the app." — which is exactly
   * backwards when the build DOES carry an allowlist. The operator reads that,
   * concludes the environment variable did not take, and goes back to Vercel to
   * set a variable that was already set. The missing piece is a session: the
   * allowlist matches an EMAIL, and there is no email until someone signs in.
   *
   * Worth being concrete, because it is not obvious: a paused Supabase project
   * means no sign-in at all, so this branch is where an owner lands with every
   * variable correctly configured.
   */
  if (env.compEmails.length > 0 && !env.sessionEmail) {
    return {
      authorized: false,
      configured,
      reason:
        'Owner test mode is configured for this build but nobody is signed in. ' +
        'The allowlist matches a signed-in email, so sign in with the allowlisted account.',
    };
  }

  // The signed-in account simply is not the operator's. Their own address is
  // safe to show them; the allowlist itself is not, since it would hand every
  // visitor the operator's email.
  if (env.compEmails.length > 0 && env.sessionEmail) {
    return {
      authorized: false,
      configured,
      reason: `Signed in as ${env.sessionEmail}, which is not on this build's owner allowlist.`,
    };
  }

  if (!env.localFlagEnabled) {
    return {
      authorized: false,
      configured,
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
      configured,
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
 * The distinction is the whole point of showing it, and it has three levels
 * rather than two, because the comp allowlist does not reach all the way down.
 *
 * A local dev preview is the UI only: the API answers according to the real
 * account, so anything touching the cloud is refused.
 *
 * A comped account MAY go further, and the honest word is "may".
 *
 * There are two allowlists, configured separately: `VITE_XBAR_COMP_EMAILS` is
 * compiled into the bundle and is all this code can see, while
 * `XBAR_COMP_EMAILS` lives on the server and is the one `getWorkspaceEntitlements`
 * actually honours. Setting only the client one — which is exactly what an
 * owner does to get the switcher without granting themselves real entitlements
 * — used to be labelled "the API grants this tier". It does not. The client
 * cannot see the server's list, so it must not claim to know its answer.
 *
 * And even with both set, the allowlist lives in the API while the database's
 * limit triggers read `workspace_subscription_profiles` and see only the
 * workspace's stored plan. A write that hits a seat, storage, or commercial
 * cap can still be refused at the real tier after the API allowed it.
 *
 * So the copy below states the dependency instead of asserting an outcome this
 * side of the wire cannot verify.
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
      // Not "Cloud active": this side of the wire knows the CLIENT allowlist
      // matched and nothing more. Whether the API grants the tier depends on a
      // separate server list the bundle cannot read, so the label states what
      // is known rather than what would be convenient to assume.
      return 'Cloud allowlisted';
    case 'cloud-ready':
      return 'Cloud ready';
    default:
      return 'Local only';
  }
}

export function ownerPreviewReachDetail(reach: OwnerPreviewReach): string {
  switch (reach) {
    case 'cloud-active':
      return 'Your email is on the app\u2019s operator allowlist. The API grants this tier only if the same email is also in the server\u2019s XBAR_COMP_EMAILS \u2014 the two lists are set separately, so if the server list is empty, cloud actions are still refused at your real plan. Where the API does grant it, database limits still follow the workspace\u2019s stored plan, so seat, storage and record caps can refuse a write anyway.';
    case 'cloud-ready':
      return 'Your email is on the app\u2019s operator allowlist. Sign in to a cloud workspace to find out whether the server grants this tier too \u2014 that is a separate allowlist.';
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

/**
 * The tier an owner preview should overlay, or null for "show the real plan".
 *
 * Every consumer of the preview resolves through this one function: the React
 * hook, the imperative snapshot the action gates use, and the store's own
 * feature gates. They were separate reads before, and separate reads are how a
 * previewed tier ended up unlocking a screen while the action behind it was
 * still refused against the real plan.
 *
 * Authorization is passed in rather than stored, so an unauthorized visitor
 * holding a stale persisted tier never gets an override.
 */
export function overlayTier(
  authorization: OwnerPreviewAuthorization,
  previewTier: SubscriptionTier | null,
  realTier: SubscriptionTier,
): SubscriptionTier | null {
  if (!authorization.authorized) return null;
  if (!previewTier || previewTier === realTier) return null;
  return previewTier;
}
