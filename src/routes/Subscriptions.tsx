import { useState } from 'react';
import { MetricCard, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCurrency } from '@/lib/format';
import { subscriptionTierConfig } from '@/lib/xbarRuntime';
import { useXbarStore } from '@/store/useXbarStore';
import type { SubscriptionTier } from '@/types/xbar';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export default function Subscriptions() {
  const subscription = useXbarStore((state) => state.subscription);
  const changeSubscriptionTier = useXbarStore((state) => state.changeSubscriptionTier);
  const [message, setMessage] = useState('');

  return (
    <>
      <PageHeader
        eyebrow="Subscriptions"
        title="Plan and feature gating"
        description="This module changes the current workspace plan posture: limits update immediately, and document-processing/storage rules follow the active tier."
      />

      {message ? <div className="status-banner">{message}</div> : null}

      <div className="metric-grid">
        <MetricCard label="Current tier" value={subscription.tier} detail={`${subscription.billingState} · renews ${subscription.renewalDate}`} />
        <MetricCard label="Seats" value={`${subscription.usage.seatsUsed}/${subscription.usage.seatLimit}`} detail="Internal users on the current plan" tone="blue" />
        <MetricCard label="Processing usage" value={`${subscription.usage.ocrProcessed}/${subscription.usage.ocrLimit}`} detail="Monthly document-page volume against the current plan limit" tone="amber" />
        <MetricCard label="Storage" value={`${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB`} detail="Operational document and media footprint" tone="slate" />
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
                <span>Owner portal {subscription.ownerPortalEnabled ? 'enabled' : 'disabled'}</span>
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

        <Panel eyebrow="Usage" title="Seat, processing, storage, and portal capacity">
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
                <div className="stack-item__title">OCR pages</div>
                <strong>{subscription.usage.ocrProcessed}/{subscription.usage.ocrLimit}</strong>
              </div>
              <ProgressBar value={(subscription.usage.ocrProcessed / subscription.usage.ocrLimit) * 100} tone="amber" />
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Portal seats</div>
                <strong>{subscription.usage.portalSeatsUsed}/{subscription.usage.portalSeatLimit}</strong>
              </div>
              <ProgressBar value={(subscription.usage.portalSeatsUsed / subscription.usage.portalSeatLimit) * 100} tone="emerald" />
            </div>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Tier design" title="Product packaging">
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
                  {formatCurrency(config.monthlyRate)}/mo · {config.limits.seatLimit} seats · {config.limits.ocrLimit} processing pages · {config.limits.storageLimitGb} GB storage
                </div>
                <div className="token-row">
                  {config.featureFlags.map((flag) => (
                    <Pill key={flag} tone="blue">
                      {flag}
                    </Pill>
                  ))}
                </div>
                {!current ? (
                  <div className="inline-actions">
                    <button
                      className="button button--ghost button--compact"
                      type="button"
                      onClick={() => {
                        changeSubscriptionTier(tier);
                        setMessage(`${tier} is now active in this workspace.`);
                      }}
                    >
                      Switch to {tier}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
