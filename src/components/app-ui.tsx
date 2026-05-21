import type { KeyboardEvent, MouseEventHandler, ReactNode } from 'react';

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';

export function PageHeader({
  eyebrow,
  title,
  description,
  showDescription = false,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  showDescription?: boolean;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="page-title">{title}</h1>
        {showDescription && description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  eyebrow,
  title,
  description,
  showDescription = false,
  meta,
  action,
  children,
  className = '',
  onContextMenu,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  showDescription?: boolean;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  onContextMenu?: MouseEventHandler<HTMLElement>;
}) {
  return (
    <section className={`panel ${className}`.trim()} onContextMenu={onContextMenu}>
      <div className="panel__header">
        <div>
          {eyebrow ? <div className="panel__eyebrow">{eyebrow}</div> : null}
          <div className="panel__title-row">
            <h2 className="panel__title">{title}</h2>
            {meta ? <div className="panel__meta">{meta}</div> : null}
          </div>
          {showDescription && description ? <p className="panel__description">{description}</p> : null}
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
  showDetail = false,
  tone = 'blue',
  className = '',
  title,
  onClick,
  onContextMenu,
}: {
  label: string;
  value: string;
  detail?: string;
  showDetail?: boolean;
  tone?: Tone;
  className?: string;
  title?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className={`metric-card metric-card--${tone}${onClick || onContextMenu ? ' metric-card--interactive' : ''} ${className}`.trim()}
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e as unknown as Parameters<MouseEventHandler<HTMLDivElement>>[0]); } } : undefined}
    >
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      {showDetail && detail ? <div className="metric-card__detail">{detail}</div> : null}
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
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function SurfaceTabs({
  items,
  active,
  onChange,
  className = '',
}: {
  items: readonly string[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`surface-tabs ${className}`.trim()} role="tablist" aria-orientation="horizontal">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          role="tab"
          aria-selected={active === item}
          className={`surface-tab${active === item ? ' surface-tab--active' : ''}`}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
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
      <span className="key-value__label">{label}</span>
      <span className="key-value__value">{value}</span>
    </div>
  );
}
