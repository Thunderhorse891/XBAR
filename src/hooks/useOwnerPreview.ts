import { useMemo } from 'react';
import type { SubscriptionProfile } from '../types/xbar';
import { buildSubscriptionForTier } from '../lib/xbarRuntime';
import {
  ownerPreviewAuthorization,
  ownerPreviewReach,
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
 * Screens that *display* or *gate on* the plan should read from here. Screens
 * that change the plan must keep using useXbarStore directly: previewing
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

  // An unauthorized visitor with a stale persisted tier gets no override:
  // authorization is re-derived here, never read from stored state.
  const previewing = authorization.authorized && previewTier !== null && previewTier !== realSubscription.tier;

  const effectiveSubscription = useMemo(() => {
    if (!previewing || !previewTier) return realSubscription;
    return buildSubscriptionForTier(realSubscription, previewTier);
  }, [previewing, previewTier, realSubscription]);

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
