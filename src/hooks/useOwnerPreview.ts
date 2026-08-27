import { useMemo } from 'react';
import type { SubscriptionProfile } from '../types/xbar';
import { buildSubscriptionForTier } from '../lib/xbarRuntime';
import {
  ownerPreviewAuthorization,
  ownerPreviewReach,
  overlayTier,
  type OwnerPreviewAuthorization,
  type OwnerPreviewReach,
} from '../lib/ownerPreview';
import { useCloudStore } from '../store/useCloudStore';
import { useOwnerPreviewStore } from '../store/useOwnerPreviewStore';
import { useXbarStore } from '../store/useXbarStore';

/*
 * The read path for tier-gated UI.
 *
 * `useEffectiveSubscription()` returns either the workspace's real subscription
 * or, when an authorized owner is previewing a tier, a derived profile for that
 * tier. The derivation is pure — `buildSubscriptionForTier` returns a new
 * object — so the store is never touched and the real plan is still there the
 * moment the preview is switched off.
 *
 * Which to use, as a rule rather than a list of files:
 *
 *   - A screen that GATES A FEATURE reads from here. The question it is asking
 *     is "may this session use X", and for an allowlisted owner the server
 *     answers yes, so refusing locally invents a restriction they do not have.
 *
 *   - A screen that REPORTS BILLING ITSELF reads useXbarStore directly. The
 *     question there is "what is this workspace actually paying for", and a
 *     preview must not answer it — the billing page would claim you had bought
 *     the tier the owner-mode bar says you are only previewing, and the setup
 *     checklist would mark billing complete when it is not.
 *
 *   - A gate that DECIDES WHETHER A RECORD MAY BE CREATED reads the real
 *     subscription, through `enforcedSubscriptionSnapshot()` below. Previewing
 *     changes what an owner can SEE, never what they can WRITE.
 *
 * Anything that CHANGES the plan also uses the store directly: previewing
 * Enterprise must not let anyone act as though they had bought it.
 */

export type OwnerPreviewStatus = {
  authorization: OwnerPreviewAuthorization;
  /** True when an authorized owner is currently overriding the tier. */
  previewing: boolean;
  /** How far the previewed tier actually reaches. */
  reach: OwnerPreviewReach;
  /** The workspace's real subscription, untouched by any preview. */
  realSubscription: SubscriptionProfile;
  /** What the UI should render — real, or the previewed overlay. */
  effectiveSubscription: SubscriptionProfile;
};

export function useOwnerPreview(): OwnerPreviewStatus {
  const realSubscription = useXbarStore((state) => state.subscription);
  const previewTier = useOwnerPreviewStore((state) => state.previewTier);
  const sessionEmail = useCloudStore((state) => state.session?.user?.email ?? '');
  const hasCloudSession = useCloudStore((state) => Boolean(state.session));

  const authorization = useMemo(() => ownerPreviewAuthorization(sessionEmail), [sessionEmail]);

  const overlay = overlayTier(authorization, previewTier, realSubscription.tier);
  const previewing = overlay !== null;

  const effectiveSubscription = useMemo(
    () => (overlay ? buildSubscriptionForTier(realSubscription, overlay) : realSubscription),
    [overlay, realSubscription],
  );

  return {
    authorization,
    previewing,
    reach: ownerPreviewReach(authorization, hasCloudSession),
    realSubscription,
    effectiveSubscription,
  };
}

/** The subscription tier-gated UI should read. */
export function useEffectiveSubscription(): SubscriptionProfile {
  return useOwnerPreview().effectiveSubscription;
}

/**
 * The REAL subscription, for the gates that decide whether a record may exist.
 *
 * `SubscriptionEnforcement` wraps the store's own mutating actions — adding a
 * horse, creating a document intake or a sale packet, inviting a member,
 * publishing a listing — so it cannot use a hook. It briefly read the previewed
 * tier here, on the reasoning that letting the preview through "changes only
 * which local gate fires first, because every cloud write is still authorized
 * by the API against the real account".
 *
 * That reasoning was wrong, and the counter-example is the ordinary
 * configuration. With relational sync off, `saveWorkspaceBackupToCloud` falls
 * to `saveWorkspaceSnapshotToCloud`, which upserts the whole workspace payload
 * straight into `workspace_snapshots` through the Supabase client. Its RLS
 * checks that the row belongs to the signed-in user and says nothing about
 * entitlements — there is no API in that path to refuse anything. So records
 * created under a previewed tier were persisted to the cloud and loaded back
 * later, and a preview that promised to be local was not.
 *
 * Pausing cloud sync while previewing does not fix it: the over-limit records
 * still exist locally and sync the moment the preview is switched off. The
 * cause is that a preview was allowed to relax a gate on WRITES at all.
 *
 * So previewing changes what an owner sees, never what they can create. A
 * screen still unlocks — that is the point of the preview, and
 * `subscriptionCapabilityMessage` already says "You are previewing X" when the
 * action behind it refuses. Granting the capacity for real is a server-side
 * entitlement, and it has to come from the subscription record rather than from
 * a client-side overlay the server has never heard of.
 */
export function enforcedSubscriptionSnapshot(): SubscriptionProfile {
  return useXbarStore.getState().subscription;
}
