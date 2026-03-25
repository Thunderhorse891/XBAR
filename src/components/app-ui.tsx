import type { ReactNode } from 'react';

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';

function toHoverText(value: ReactNode): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value.map((item) => toHoverText(item)).filter(Boolean);
    return parts.length ? parts.join(' ') : undefined;
  }

  return undefined;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow ? (
          <div className="eyebrow hover-copy" title={eyebrow}>
            {eyebrow}
          </div>
        ) : null}
        <h1 className="page-title hover-copy" title={title}>
          {title}
        </h1>
        <p className="page-description hover-copy" title={description}>
          {description}
        </p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  eyebrow,
  title,
  description,
  meta,
  action,
  children,
  className = '',
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      <div className="panel__header">
        <div>
          {eyebrow ? (
            <div className="panel__eyebrow hover-copy" title={eyebrow}>
              {eyebrow}
            </div>
          ) : null}
          <div className="panel__title-row">
            <h2 className="panel__title hover-copy" title={title}>
              {title}
            </h2>
            {meta ? <div className="panel__meta">{meta}</div> : null}
          </div>
          {description ? (
            <p className="panel__description hover-copy" title={description}>
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="panel__action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  tone = 'blue',
}: {
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <div className={`metric-card metric-card--${tone}`} title={`${label}: ${value}. ${detail}`}>
      <div className="metric-card__label hover-copy" title={label}>
        {label}
      </div>
      <div className="metric-card__value hover-copy" title={value}>
        {value}
      </div>
      <div className="metric-card__detail hover-copy" title={detail}>
        {detail}
      </div>
    </div>
  );
}

export function Pill({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const title = toHoverText(children);
  return (
    <span className={`pill pill--${tone} hover-copy`} title={title}>
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  tone = 'blue',
}: {
  value: number;
  tone?: Tone;
}) {
  return (
    <div className="progress-track" aria-hidden="true">
      <div className={`progress-bar progress-bar--${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function KeyValue({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="key-value">
      <span className="key-value__label hover-copy" title={label}>
        {label}
      </span>
      <span className="key-value__value hover-copy" title={toHoverText(value)}>
        {value}
      </span>
    </div>
  );
}
