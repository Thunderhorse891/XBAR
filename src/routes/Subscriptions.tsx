import { MetricCard, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { startManagedCheckout } from '@/lib/billingApi';
import { formatCurrency, formatDateLabel } from '@/lib/format';
import { getStripePaymentLink, isBillingConfigured, stripeConfig } from '@/lib/platformConfig';
import { subscriptionTierConfig } from '@/lib/xbarRuntime';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export default function Subscriptions() {
  const subscription = useXbarStore((state) => state.subscription);
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const billingConfigured = isBillingConfigured();
  const session = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const pushToast = useUiStore((state) => state.pushToast);

  return (
    <>
      <PageHeader
        eyebrow="Subscriptions"
        title="Billing"
        actions={
          <>
            <Pill tone={billingConfigured ? 'emerald' : 'slate'}>{billingConfigured ? 'Stripe links live' : 'Manual billing'}</Pill>
            <Pill tone="slate">{subscription.tier}</Pill>
          </>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Tier" value={subscription.tier} detail="Current plan" tone="blue" />
        <MetricCard label="Renews" value={formatDateLabel(subscription.renewalDate)} detail="Next billing date" tone="slate" />
        <MetricCard
          label="Seats"
          value={`${subscription.usage.seatsUsed}/${subscription.usage.seatLimit}`}
          detail="Licensed users"
          tone="emerald"
        />
        <MetricCard
          label="Storage"
          value={`${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB`}
          detail="Ranch files"
          tone="blue"
        />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="State" title="Billing">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">{formatCurrency(subscription.monthlyRate)}/mo</div>
                <Pill tone="blue">{subscription.tier}</Pill>
              </div>
              <div className="inline-metrics">
                <span>{subscription.billingState}</span>
                <span>{subscription.sharedAccessEnabled ? 'Shared access on' : 'Shared access off'}</span>
                <span>{subscription.brandedListings ? 'Branded links on' : 'Branded links off'}</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Checkout</div>
                <Pill tone={billingConfigured ? 'emerald' : 'slate'}>{billingConfigured ? 'Configured' : 'Not configured'}</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Billing portal</div>
                <Pill tone={stripeConfig.billingPortalUrl ? 'emerald' : 'slate'}>
                  {stripeConfig.billingPortalUrl ? 'Available' : 'Unavailable'}
                </Pill>
              </div>
            </div>
          </div>
          <div className="inline-actions">
            {stripeConfig.billingPortalUrl && canManageBilling ? (
              <a className="button button--ghost button--compact" href={stripeConfig.billingPortalUrl} target="_blank" rel="noreferrer">
                Manage billing
              </a>
            ) : null}
          </div>
        </Panel>

        <Panel eyebrow="Usage" title="Ranch">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Seats</div>
                <strong>{subscription.usage.seatsUsed}/{subscription.usage.seatLimit}</strong>
              </div>
              <ProgressBar value={(subscription.usage.seatsUsed / subscription.usage.seatLimit) * 100} />
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Storage</div>
                <strong>{subscription.usage.storageUsedGb}/{subscription.usage.storageLimitGb} GB</strong>
              </div>
              <ProgressBar value={(subscription.usage.storageUsedGb / subscription.usage.storageLimitGb) * 100} tone="blue" />
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Documents</div>
                <strong>{subscription.usage.documentsProcessed}/{subscription.usage.documentLimit}</strong>
              </div>
              <ProgressBar value={(subscription.usage.documentsProcessed / subscription.usage.documentLimit) * 100} tone="slate" />
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Shared seats</div>
                <strong>{subscription.usage.sharedAccessSeatsUsed}/{subscription.usage.sharedAccessSeatLimit}</strong>
              </div>
              <ProgressBar
                value={
                  subscription.usage.sharedAccessSeatLimit
                    ? (subscription.usage.sharedAccessSeatsUsed / subscription.usage.sharedAccessSeatLimit) * 100
                    : 0
                }
                tone="emerald"
              />
            </div>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Checkout" title="Plans">
        {!billingConfigured && (
          <div className="billing-notice">
            Self-serve checkout is not yet active — Stripe payment links have not been configured for this deployment. Contact your administrator to upgrade your plan.
          </div>
        )}
        <div className="detail-grid">
          {tiers.map((tier) => {
            const config = subscriptionTierConfig[tier];
            const current = tier === subscription.tier;
            const paymentLink = getStripePaymentLink(tier);

            return (
              <div key={tier} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{tier}</div>
                  <Pill tone={current ? 'blue' : 'slate'}>{current ? 'Current' : 'Available'}</Pill>
                </div>
                <div className="inline-metrics">
                  <span>{formatCurrency(config.monthlyRate)}/mo</span>
                  <span>{config.limits.seatLimit} seats</span>
                  <span>{config.limits.storageLimitGb} GB</span>
                  <span>{config.limits.sharedAccessSeatLimit} shared</span>
                </div>
                <div className="token-row">
                  {config.featureFlags.map((flag) => (
                    <Pill key={flag} tone="blue">
                      {flag}
                    </Pill>
                  ))}
                </div>
                <div className="inline-actions">
                  {!current && canManageBilling ? (
                    billingConfigured && paymentLink ? (
                      <button
                        className="button button--primary button--compact"
                        type="button"
                        onClick={async () => {
                          const managedCheckout = await startManagedCheckout({
                            tier,
                            workspaceId,
                            accessToken: session?.access_token ?? '',
                          });
                          if (managedCheckout.ok) {
                            window.location.href = managedCheckout.url;
                            return;
                          }
                          pushToast({ title: 'Managed checkout unavailable', message: managedCheckout.message, tone: 'error' });
                          window.open(paymentLink, '_blank', 'noopener,noreferrer');
                        }}
                      >
                        Open checkout
                      </button>
                    ) : (
                      <div>
                        <button className="button button--ghost button--compact" type="button" disabled title="Stripe not configured">
                          Checkout unavailable
                        </button>
                        <p style={{ marginTop: '6px', fontSize: '11px', color: 'var(--muted)', fontStyle: 'italic' }}>
                          Contact your admin to configure billing.
                        </p>
                      </div>
                    )
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
