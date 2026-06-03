import type { KeyboardEvent, MouseEventHandler, ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';

export function PageHeader({
  eyebrow,
  title,
  description,
  showDescription = true,
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
  showDescription = true,
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
  showDetail = true,
  tone = 'blue',
  className = '',
  title,
  href,
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
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  onContextMenu?: MouseEventHandler<HTMLElement>;
}) {
  const cls = `metric-card metric-card--${tone}${href || onClick || onContextMenu ? ' metric-card--interactive' : ''} ${className}`.trim();
  const inner = (
    <>
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      {showDetail && detail ? <div className="metric-card__detail">{detail}</div> : null}
    </>
  );
  if (href) {
    return (
      <Link className={cls} to={href} title={title} onClick={onClick as MouseEventHandler<HTMLAnchorElement>} onContextMenu={onContextMenu as MouseEventHandler<HTMLAnchorElement>}>
        {inner}
      </Link>
    );
  }
  return (
    <div
      className={cls}
      title={title}
      onClick={onClick as MouseEventHandler<HTMLDivElement>}
      onContextMenu={onContextMenu as MouseEventHandler<HTMLDivElement>}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (onClick as MouseEventHandler<HTMLDivElement>)(e as unknown as Parameters<MouseEventHandler<HTMLDivElement>>[0]); } } : undefined}
    >
      {inner}
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
