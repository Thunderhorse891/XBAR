import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SubscriptionTier } from '../types/xbar';
import { isPreviewableTier } from '../lib/ownerPreview';

/*
 * Which tier the owner is currently looking at.
 *
 * Kept in its own store, deliberately separate from the subscription in
 * useXbarStore. That separation is the fix: the previous implementation wrote
 * the previewed tier into the real subscription, so previewing destroyed the
 * record of what the workspace was actually on and the change synced to the
 * cloud. Nothing here is ever written back into the subscription, which is what
 * makes "return to my real plan" a no-op rather than a repair.
 *
 * This state is persisted for convenience — reloading during a session should
 * not drop you back out of the tier you were inspecting. Persistence is not
 * authorization: `ownerPreviewAuthorization()` is consulted separately on every
 * read, and it depends only on build-time configuration and the server's comp
 * allowlist. Editing this key in devtools changes which tier the overlay would
 * show, never whether the overlay is allowed to exist.
 */

type OwnerPreviewState = {
  /** Tier being previewed, or null when viewing the real plan. */
  previewTier: SubscriptionTier | null;
  setPreviewTier: (tier: SubscriptionTier) => void;
  clearPreview: () => void;
};

export const useOwnerPreviewStore = create<OwnerPreviewState>()(
  persist(
    (set) => ({
      previewTier: null,
      setPreviewTier: (tier) => set({ previewTier: isPreviewableTier(tier) ? tier : null }),
      clearPreview: () => set({ previewTier: null }),
    }),
    {
      name: 'xbar-owner-preview',
      // Rehydrating a hand-edited value must not smuggle in a tier that does
      // not exist; an unrecognized value reads as "not previewing".
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<OwnerPreviewState>;
        return {
          ...current,
          previewTier: isPreviewableTier(stored.previewTier) ? stored.previewTier : null,
        };
      },
    },
  ),
);
