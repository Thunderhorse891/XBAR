import { Link } from 'react-router-dom';
import { Panel, Pill, ProgressBar } from '@/components/app-ui';
import { billingPathForTier } from '@/lib/billingRoutes';
import { buildUsageMeters, highestUsagePressure, nextPlan, type UsagePressure } from '@/lib/commercialEngine';
import { useEffectiveSubscription } from '@/hooks/useOwnerPreview';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';

function pressureCopy(level: UsagePressure) {
  if (level === 'blocked') return 'Hard gate';
  if (level === 'upgrade') return 'Upgrade now';
  if (level === 'warning') return 'Watch capacity';
  return 'Healthy';
}

function pressureTone(level: UsagePressure) {
  if (level === 'blocked') return 'rose';
  if (level === 'upgrade' || level === 'warning') return 'amber';
  return 'blue';
}

export function UsageMeterPanel({ compact = false }: { compact?: boolean }) {
  const subscription = useEffectiveSubscription();
  const meters = buildUsageMeters(subscription);
  const pressure = highestUsagePressure(subscription);
  const visibleMeters = compact ? meters.slice(0, 4) : meters;
  const upgradeTier = nextPlan(subscription.tier);

  return (
    <Panel
      eyebrow="Plan pressure"
      title="Usage meters"
      description={
        compact
          ? undefined
          : 'Operational limits that drive upgrade timing. Warnings start at 80%, upgrade pressure at 90%, and hard gates at 100%.'
      }
      meta={
        <Pill tone={pressureTone(pressure?.pressure ?? 'clear')}>{pressureCopy(pressure?.pressure ?? 'clear')}</Pill>
      }
      action={
        // Guideline 3.1.1 forbids the call to action, not just the charge, so
        // a store build shows the pressure without a button to buy out of it.
        // The plans screen is still reachable from the nav for anyone who wants
        // to see what a tier includes.
        !pressure || pressure.pressure === 'clear' || !canPresentPurchaseFlow() ? null : (
          <Link className="button button--primary button--compact" to={billingPathForTier(upgradeTier)}>
            Upgrade to {upgradeTier}
          </Link>
        )
      }
    >
      <div className="stack-list">
        <div className="stack-item">
          <div className="stack-item__top">
            <div>
              <div className="stack-item__title">
                {!pressure || pressure.pressure === 'clear'
                  ? 'Plan capacity is healthy.'
                  : `${pressure.label} needs attention.`}
              </div>
              <div className="stack-item__copy">
                {pressure?.message ?? `${subscription.tier} still has operating room.`}
              </div>
            </div>
            <Pill tone={pressureTone(pressure?.pressure ?? 'clear')}>{subscription.tier}</Pill>
          </div>
        </div>
      </div>
      <div className="subscription-usage-grid" style={{ marginTop: 14 }}>
        {visibleMeters.map((meter) => (
          <div className="subscription-usage-card" key={meter.key}>
            <div className="subscription-usage-card__top">
              <span>{meter.label}</span>
              <strong>
                {meter.used.toLocaleString()} / {meter.limit.toLocaleString()}
              </strong>
            </div>
            <ProgressBar value={meter.percent} tone={pressureTone(meter.pressure)} />
            <div className="stack-item__copy" style={{ marginTop: 8 }}>
              {meter.percent}% used · {pressureCopy(meter.pressure)}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
