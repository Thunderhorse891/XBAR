import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { billingPathForTier } from '@/lib/billingRoutes';
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
          <Link className="button button--primary" to={billingPathForTier('Professional')}>
            Compare billing
          </Link>
        ) : null
      }
    />
  );
}
