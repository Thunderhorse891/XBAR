import { Link } from 'react-router-dom';
import type { OperationalValuePulse as OperationalValuePulseModel } from '@/lib/operationalValuePulse';
import './operationalValuePulse.css';

type OperationalValuePulseProps = {
  pulse: OperationalValuePulseModel;
};

export function OperationalValuePulse({ pulse }: OperationalValuePulseProps) {
  return (
    <section className={`operational-value-pulse operational-value-pulse--${pulse.tone}`} aria-labelledby="operational-value-title">
      <div className="operational-value-pulse__summary">
        <div className="operational-value-pulse__eyebrow">Operational value pulse</div>
        <div className="operational-value-pulse__heading-row">
          <div>
            <h2 id="operational-value-title" className="operational-value-pulse__title">{pulse.headline}</h2>
            <p className="operational-value-pulse__copy">{pulse.summary}</p>
          </div>
          <div className="operational-value-pulse__score" aria-label={`Operational control score ${pulse.score} out of 100`}>
            <strong>{pulse.score}</strong>
            <span>control score</span>
          </div>
        </div>
        <div className="operational-value-pulse__next">
          <div>
            <span className="operational-value-pulse__next-label">Highest-value next move</span>
            <strong>{pulse.nextAction.label}</strong>
            <span>{pulse.nextAction.detail}</span>
          </div>
          <Link className="button button--primary button--compact" to={pulse.nextAction.path}>
            Take action
          </Link>
        </div>
      </div>

      <div className="operational-value-pulse__signals" aria-label="Operational value signals">
        {pulse.signals.map((signal) => (
          <Link key={signal.label} className={`operational-value-signal operational-value-signal--${signal.state}`} to={signal.path}>
            <span className="operational-value-signal__label">{signal.label}</span>
            <strong className="operational-value-signal__value">{signal.value}</strong>
            <span className="operational-value-signal__detail">{signal.detail}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
