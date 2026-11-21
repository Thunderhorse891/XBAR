import { PageHeader, Panel } from '@/components/app-ui';
import { useCloudStore } from '@/store/useCloudStore';
import { useWorkspaceHydrated, useWorkspaceReady, useXbarStore } from '@/store/useXbarStore';

// Packaged builds use this read-only screen, not a disabled web checkout.
// Do not read checkout-return URLs, fetch a catalog, or offer web plan changes.
export default function NativeBillingStatus() {
  const subscription = useXbarStore((state) => state.subscription);
  const workspaceHydrated = useWorkspaceHydrated();
  const workspaceReady = useWorkspaceReady();
  const hasCloudSession = useCloudStore((state) => Boolean(state.session));
  const cloudWorkspaceReady = useCloudStore((state) => Boolean(state.workspaceId && state.autosaveReady));
  const canShowPlan = workspaceHydrated && workspaceReady && (!hasCloudSession || cloudWorkspaceReady);

  return (
    <>
      <PageHeader
        eyebrow="Workspace account"
        title="Billing status"
        description="View the plan recorded for this workspace."
      />
      <Panel title="Current workspace plan" description="Purchases and plan changes are not available in this app.">
        <p className="panel__description" role="status">
          {canShowPlan ? subscription.tier : 'Workspace plan not available yet.'}
        </p>
      </Panel>
    </>
  );
}
