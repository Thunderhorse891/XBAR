import { MetricCard, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCurrency, formatDateLabel } from '@/lib/format';
import { getStripePaymentLink, isBillingConfigured, stripeConfig } from '@/lib/platformConfig';
import { buildRevenueBlueprint } from '@/lib/xbarGrowth';
import { subscriptionTierConfig } from '@/lib/xbarRuntime';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export default function Subscriptions() {
  const subscription = useXbarStore((state) => state.subscription);
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const revenuePlan = buildRevenueBlueprint(subscription);

  return (
    <>
      <PageHeader
        eyebrow="Subscriptions"
        title="Billing"
        actions={
          <>
            <Pill tone={isBillingConfigured() ? 'emerald' : 'slate'}>{isBillingConfigured() ? 'Billing live' : 'Manual billing'}</Pill>
            <Pill tone="slate">{subscription.tier}</Pill>
          </>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Current tier" value={subscription.tier} detail={`${subscription.billingState} · renews ${formatDateLabel(subscription.renewalDate)}`} />
        <MetricCard label="Current ARR" value={formatCurrency(revenuePlan.currentArr)} detail="Annual value at this tier" tone="blue" />
        <MetricCard label="Customers to $10M" value={`${revenuePlan.customersNeededAtCurrentTier}`} detail="At this tier only" tone="amber" />
        <MetricCard label="Recommended mix" value={formatCurrency(revenuePlan.recommendedMixArr)} detail={revenuePlan.recommendedMixLabel} tone="slate" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Billing" title="Posture">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">{formatCurrency(subscription.monthlyRate)}/mo</div>
                <Pill tone="blue">{subscription.tier}</Pill>
              </div>
              <div className="inline-metrics">
                <span>{subscription.billingState}</span>
                <span>Shared access {subscription.sharedAccessEnabled ? 'enabled' : 'disabled'}</span>
                <span>Branded listings {subscription.brandedListings ? 'enabled' : 'disabled'}</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Feature gates</div>
              <div className="token-row">
                {subscription.featureFlags.map((flag) => (
                  <Pill key={flag} tone="blue">
                    {flag}
                  </Pill>
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Usage" title="Usage">
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
              <ProgressBar value={(subscription.usage.storageUsedGb / subscription.usage.storageLimitGb) * 100} tone="amber" />
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Shared-access seats</div>
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

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel eyebrow="Revenue" title="Path to $10M">
          <div className="stack-list">
            {revenuePlan.scenarios.map((scenario) => (
              <div key={scenario.tier} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{scenario.tier}</div>
                    <div className="stack-item__copy">{formatCurrency(scenario.annualContractValue)} per customer</div>
                  </div>
                  <Pill tone={scenario.tier === subscription.tier ? 'blue' : scenario.tier === 'Enterprise' ? 'amber' : 'emerald'}>
                    {scenario.customersNeeded} customers
                  </Pill>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Pricing" title="Drivers">
          <div className="bullet-list">
            {revenuePlan.motions.map((motion) => (
              <div key={motion} className="bullet-list__item">
                {motion}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Packaging" title="Tiers">
        <div className="detail-grid">
          {tiers.map((tier) => {
            const config = subscriptionTierConfig[tier];
            const current = tier === subscription.tier;
            return (
              <div key={tier} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{tier}</div>
                  <Pill tone={current ? 'blue' : tier === 'Enterprise' ? 'amber' : tier === 'Ranch Ops' ? 'emerald' : 'slate'}>
                    {current ? 'Current' : 'Available'}
                  </Pill>
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
                  {current && stripeConfig.billingPortalUrl && canManageBilling ? (
                    <a className="button button--ghost button--compact" href={stripeConfig.billingPortalUrl} target="_blank" rel="noreferrer">
                      Manage billing
                    </a>
                  ) : null}
                  {!current && getStripePaymentLink(tier) && canManageBilling ? (
                    <a className="button button--primary button--compact" href={getStripePaymentLink(tier)} target="_blank" rel="noreferrer">
                      Start checkout
                    </a>
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
