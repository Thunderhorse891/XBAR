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
 * Imperative equivalent of `useEffectiveSubscription`, for gates that run
 * outside React.
 *
 * `SubscriptionEnforcement` wraps the store's own actions, so it cannot use a
 * hook — it was therefore reading the raw subscription and refusing an
 * authorized owner's previewed tier before the request ever reached the API.
 * For a comp-allowlisted account that is simply wrong: the server grants that
 * tier, so the local gate was inventing a restriction the account does not
 * have.
 *
 * Letting the preview through here stays safe because it changes only which
 * local gate fires first. Every cloud write is still authorized by the API
 * against the real account, which knows nothing about this overlay — so a
 * local-only preview of Enterprise reaches the server and is refused there,
 * which is the honest place for that answer to come from.
 */
export function effectiveSubscriptionSnapshot(): SubscriptionProfile {
  const realSubscription = useXbarStore.getState().subscription;
  const overlay = overlayTier(
    ownerPreviewAuthorization(useCloudStore.getState().session?.user?.email ?? ''),
    useOwnerPreviewStore.getState().previewTier,
    realSubscription.tier,
  );
  return overlay ? buildSubscriptionForTier(realSubscription, overlay) : realSubscription;
}
