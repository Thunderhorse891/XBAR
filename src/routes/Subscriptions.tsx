import { MetricCard, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCurrency, formatDateLabel } from '@/lib/format';
import { buildRevenueBlueprint } from '@/lib/xbarGrowth';
import { subscriptionTierConfig } from '@/lib/xbarRuntime';
import { useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export default function Subscriptions() {
  const subscription = useXbarStore((state) => state.subscription);
  const revenuePlan = buildRevenueBlueprint(subscription);

  return (
    <>
      <PageHeader
        eyebrow="Subscriptions"
        title="Contract"
        description="Usage, limits, revenue."
      />

      <div className="callout callout--warning">
        <strong>Contract tracking:</strong> Billing is managed off-platform for this workspace.
      </div>

      <div className="metric-grid">
        <MetricCard label="Current tier" value={subscription.tier} detail={`${subscription.billingState} · renews ${formatDateLabel(subscription.renewalDate)}`} />
        <MetricCard label="Current ARR" value={formatCurrency(revenuePlan.currentArr)} detail="Annual value at this tier" tone="blue" />
        <MetricCard label="Customers to $10M" value={`${revenuePlan.customersNeededAtCurrentTier}`} detail="At this tier only" tone="amber" />
        <MetricCard label="Recommended mix" value={formatCurrency(revenuePlan.recommendedMixArr)} detail={revenuePlan.recommendedMixLabel} tone="slate" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Billing" title="Commercial posture">
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

        <Panel eyebrow="Usage" title="Seats, storage, access">
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
        <Panel eyebrow="Revenue" title="Path to $10M ARR" description="Scenarios.">
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
                <div className="stack-item__copy">{scenario.summary}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Pricing" title="Why teams pay more" description="Drivers.">
          <div className="bullet-list">
            {revenuePlan.motions.map((motion) => (
              <div key={motion} className="bullet-list__item">
                {motion}
              </div>
            ))}
          </div>
          <div className="detail-block subtle">
            Trust, ownership clarity, buyer-safe profiles, and mobile execution.
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Packaging" title="Product tiers" description="Read-only tiers.">
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
                <div className="stack-item__copy">
                  {formatCurrency(config.monthlyRate)}/mo · {config.limits.seatLimit} seats · {config.limits.storageLimitGb} GB storage · {config.limits.sharedAccessSeatLimit} shared-access seats
                </div>
                <div className="token-row">
                  {config.featureFlags.map((flag) => (
                    <Pill key={flag} tone="blue">
                      {flag}
                    </Pill>
                  ))}
                </div>
                <div className="stack-item__copy">{current ? 'This is the active contract on this workspace.' : 'Package reference only.'}</div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
