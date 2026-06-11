import { create } from 'zustand';
import type { Tier } from '@/lib/types';
import { getTier } from '@/lib/auth';

const TIER_RANK: Record<Tier, number> = { basic: 0, pro: 1, business: 2 };

interface SubscriptionState {
  tier: Tier;
  hydrated: boolean;
  hydrate: () => void;
  setTier: (tier: Tier) => void;
  atLeast: (tier: Tier) => boolean;
}

export const useSubscriptionStore = create<SubscriptionState>((set, get) => ({
  tier: 'basic',
  hydrated: false,
  hydrate: () => set({ tier: getTier(), hydrated: true }),
  setTier: (tier) => set({ tier }),
  atLeast: (tier) => TIER_RANK[get().tier] >= TIER_RANK[tier],
}));
