import type { KeyboardEvent, MouseEventHandler, ReactNode } from 'react';

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
    <section className={`panel ${onContextMenu ? 'panel--contextual' : ''} ${className}`.trim()} onContextMenu={onContextMenu} title={onContextMenu ? 'Right-click for panel actions' : undefined}>
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
  const interactive = Boolean(onClick || onContextMenu);
  return (
    <div
      className={`metric-card metric-card--${tone}${interactive ? ' metric-card--interactive' : ''} ${className}`.trim()}
      title={title ?? (interactive ? `${label}. Press Enter to open${onContextMenu ? ' or Shift+F10 for actions' : ''}.` : undefined)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `${label}: ${value}` : undefined}
      onKeyDown={interactive ? (event: KeyboardEvent<HTMLDivElement>) => {
        if ((event.key === 'Enter' || event.key === ' ') && onClick) {
          event.preventDefault();
          onClick(event as unknown as Parameters<MouseEventHandler<HTMLDivElement>>[0]);
          return;
        }
        if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && onContextMenu) {
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          onContextMenu({
            ...event,
            preventDefault: () => event.preventDefault(),
            clientX: bounds.left + 24,
            clientY: bounds.top + 24,
          } as unknown as Parameters<MouseEventHandler<HTMLDivElement>>[0]);
        }
      } : undefined}
    >
      <div className="metric-card__label">{label}</div>
      <div className="metric-card__value">{value}</div>
      {showDetail && detail ? <div className="metric-card__detail">{detail}</div> : null}
      {interactive ? <span className="interactive-cue" aria-hidden="true">{onContextMenu ? 'Open / actions' : 'Open'}</span> : null}
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
