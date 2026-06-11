import { Link } from 'react-router-dom';
import { highestUsagePressure } from '@/lib/commercialEngine';
import { useXbarStore } from '@/store/useXbarStore';

export function CommercialPressureBanner() {
  const subscription = useXbarStore((state) => state.subscription);
  const meter = highestUsagePressure(subscription);
  if (!meter || meter.pressure === 'clear') return null;

  return (
    <section className={`commercial-pressure commercial-pressure--${meter.pressure}`} aria-label="Plan capacity warning">
      <div>
        <strong>{meter.pressure === 'blocked' ? `${meter.label} limit reached` : `${meter.label} at ${meter.percent}%`}</strong>
        <span>{meter.message}</span>
      </div>
      <Link to="/subscriptions" className="button button--primary button--compact">Upgrade to unlock</Link>
    </section>
  );
}
