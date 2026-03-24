import { MetricCard, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCurrency } from '@/lib/format';
import { useXbarStore } from '@/store/useXbarStore';

export default function Subscriptions() {
  const subscription = useXbarStore((state) => state.subscription);
  const tiers = [
    { name: 'Starter', detail: 'Registry basics, limited OCR, no owner portal', tone: 'slate' as const },
    { name: 'Professional', detail: 'Current plan: branded packets, role views, owner portal foundation', tone: 'blue' as const },
    { name: 'Ranch Ops', detail: 'Higher seat counts, deeper OCR throughput, expanded portal capacity', tone: 'emerald' as const },
    { name: 'Enterprise', detail: 'Custom integrations, branded domains, and portfolio-grade governance', tone: 'amber' as const },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Subscriptions"
        title="Plan and feature gating"
        description="This module makes the business model visible: tiering, seat posture, OCR limits, storage, owner portal capacity, and upgrade state all live in the product."
      />

      <div className="metric-grid">
        <MetricCard label="Current tier" value={subscription.tier} detail={`${subscription.billingState} · renews ${subscription.renewalDate}`} />
        <MetricCard label="Seats" value={`${subscription.usage.seatsUsed}/${subscription.usage.seatLimit}`} detail="Internal users on the current plan" tone="blue" />
        <MetricCard label="OCR usage" value={`${subscription.usage.ocrProcessed}/${subscription.usage.ocrLimit}`} detail="Monthly page volume against plan limit" tone="amber" />
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

        <Panel eyebrow="Usage" title="Seat, OCR, storage, and portal capacity">
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
          {tiers.map((tier) => (
            <div key={tier.name} className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">{tier.name}</div>
                <Pill tone={tier.tone}>{tier.name === subscription.tier ? 'Current' : 'Available'}</Pill>
              </div>
              <div className="stack-item__copy">{tier.detail}</div>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
