import { create } from 'zustand';
import { canPresentPurchaseFlow } from '../lib/nativePlatform';
import type { UpgradeFeature } from '../lib/upgradeOffer';
import { useCloudStore } from './useCloudStore';

export type UpgradePromptRequest = {
  feature: UpgradeFeature;
  attemptId: string;
  accountId: string;
  workspaceId: string;
  trigger?: HTMLElement;
};
export const useUpgradeStore = create<{ prompt: UpgradePromptRequest | null }>(() => ({ prompt: null }));

/** Call only from an intentional feature action, never while rendering a locked section. */
export function requestFeatureUpgrade(feature: UpgradeFeature) {
  if (!canPresentPurchaseFlow() || useUpgradeStore.getState().prompt) return;
  const cloud = useCloudStore.getState();
  useUpgradeStore.setState({
    prompt: {
      feature,
      attemptId: crypto.randomUUID(),
      accountId: cloud.session?.user.id ?? '',
      workspaceId: cloud.workspaceId,
      trigger: document.activeElement instanceof HTMLElement ? document.activeElement : undefined,
    },
  });
}

export function closeUpgradePrompt() {
  useUpgradeStore.setState({ prompt: null });
}
