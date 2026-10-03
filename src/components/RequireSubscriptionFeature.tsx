import type { ReactNode } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { requestFeatureUpgrade } from '@/store/useUpgradeStore';
import { sharedListingGate } from '@/lib/subscriptionGates';
import { useEffectiveSubscription } from '@/hooks/useOwnerPreview';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';

export function RequireSharedListings({ children }: { children: ReactNode }) {
  const subscription = useEffectiveSubscription();
  const blocked = sharedListingGate(subscription);

  if (!blocked) return <>{children}</>;

  return (
    <EmptyState
      title="Unlock sale listings"
      description={blocked}
      action={
        canPresentPurchaseFlow() ? (
          <button
            className="button button--primary"
            type="button"
            onClick={() => requestFeatureUpgrade('buyerDealRoom')}
          >
            Compare billing
          </button>
        ) : null
      }
    />
  );
}
