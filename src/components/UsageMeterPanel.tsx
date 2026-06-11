import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Panel, Pill, ProgressBar } from '@/components/app-ui';
import { countLocalSalePacketGenerations, localSalePacketLogChangedEvent } from '@/lib/localSalePacketLog';
import {
  buildUpgradePressure,
  buildUsageMeters,
  formatUsageValue,
  getUpgradePath,
  usageMeterTone,
} from '@/lib/subscriptionUsage';
import { useXbarStore } from '@/store/useXbarStore';

function pressureCopy(level: string) {
  if (level === 'hardGate') return 'Hard gate';
  if (level === 'upgrade') return 'Upgrade now';
  if (level === 'warning') return 'Watch capacity';
  return 'Healthy';
}

export function UsageMeterPanel({ compact = false }: { compact?: boolean }) {
  const subscription = useXbarStore((state) => state.subscription);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const [salePacketCount, setSalePacketCount] = useState(() => countLocalSalePacketGenerations());

  useEffect(() => {
    const update = () => setSalePacketCount(countLocalSalePacketGenerations());
    update();
    window.addEventListener(localSalePacketLogChangedEvent, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(localSalePacketLogChangedEvent, update);
      window.removeEventListener('storage', update);
    };
  }, []);

  const meters = useMemo(() => buildUsageMeters({
    subscription,
    horsesUsed: horses.length,
    documentsUsed: documents.length,
    salePacketsGenerated: salePacketCount,
  }), [documents.length, horses.length, salePacketCount, subscription]);
  const pressure = useMemo(() => buildUpgradePressure(subscription, meters), [meters, subscription]);
  const visibleMeters = compact ? meters.slice(0, 4) : meters;

  return (
    <Panel
      eyebrow="Plan pressure"
      title="Usage meters"
      description={compact ? undefined : 'Operational limits that drive upgrade timing. Warnings start at 80%, upgrade pressure at 90%, and hard gates at 100%.'}
      meta={<Pill tone={usageMeterTone(pressure.level)}>{pressureCopy(pressure.level)}</Pill>}
      action={pressure.level === 'clear' ? null : <Link className="button button--primary button--compact" to={getUpgradePath(pressure.ctaTier)}>Upgrade to {pressure.ctaTier}</Link>}
    >
      <div className="stack-list">
        <div className="stack-item">
          <div className="stack-item__top">
            <div>
              <div className="stack-item__title">{pressure.headline}</div>
              <div className="stack-item__copy">{pressure.message}</div>
            </div>
            <Pill tone={usageMeterTone(pressure.level)}>{subscription.tier}</Pill>
          </div>
        </div>
      </div>
      <div className="subscription-usage-grid" style={{ marginTop: 14 }}>
        {visibleMeters.map((meter) => (
          <div className="subscription-usage-card" key={meter.key}>
            <div className="subscription-usage-card__top">
              <span>{meter.label}</span>
              <strong>{formatUsageValue(meter.used, meter.unit)} / {formatUsageValue(meter.limit, meter.unit)}</strong>
            </div>
            <ProgressBar value={meter.percent} tone={usageMeterTone(meter.level)} />
            <div className="stack-item__copy" style={{ marginTop: 8 }}>{meter.percent}% used · {pressureCopy(meter.level)}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
