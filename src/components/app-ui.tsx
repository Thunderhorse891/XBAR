import type { CSSProperties, KeyboardEvent, MouseEventHandler, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useUiStore } from '@/store/useUiStore';

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';

/** Inset left status edge for marking blocked / ready / attention states. */
type StatusEdge = 'blue' | 'amber' | 'rose';

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
  edge,
  onContextMenu,
  surfaceId,
  style,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  showDescription?: boolean;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  edge?: StatusEdge;
  onContextMenu?: MouseEventHandler<HTMLElement>;
  surfaceId?: string;
  style?: CSSProperties;
}) {
  const mode = useUiStore((state) => (surfaceId ? state.surfaceModes[surfaceId] ?? 'expanded' : 'expanded'));
  const sendSurfaceEvent = useUiStore((state) => state.sendSurfaceEvent);
  const statefulClassName = surfaceId ? `panel--stateful panel--${mode}` : '';

  return (
    <Card
      className={`panel ${onContextMenu ? 'panel--contextual' : ''} ${statefulClassName} ${edge ? `panel--edge-${edge}` : ''} ${className}`.trim()}
      data-surface-id={surfaceId}
      onContextMenu={onContextMenu}
      style={style}
      title={onContextMenu ? 'Right-click for panel actions' : undefined}
    >
      <div className="panel__header">
        <div>
          {eyebrow ? <div className="panel__eyebrow">{eyebrow}</div> : null}
          <div className="panel__title-row">
            <h2 className="panel__title">{title}</h2>
            {meta ? <div className="panel__meta">{meta}</div> : null}
          </div>
          {showDescription && description ? <p className="panel__description">{description}</p> : null}
        </div>
        {action || surfaceId ? (
          <div className="panel__action">
            {action}
            {surfaceId ? (
              <div className="panel__display-controls" aria-label={`${title} display controls`}>
                <button
                  type="button"
                  aria-label={mode === 'collapsed' ? `Expand ${title}` : `Collapse ${title}`}
                  aria-pressed={mode === 'collapsed'}
                  onClick={() => sendSurfaceEvent(surfaceId, mode === 'collapsed' ? 'expand' : 'collapse')}
                >
                  {mode === 'collapsed' ? 'Expand' : 'Collapse'}
                </button>
                <button
                  type="button"
                  aria-label={`${mode === 'detailed' ? 'Restore' : 'Show detailed'} ${title}`}
                  aria-pressed={mode === 'detailed'}
                  onClick={() => sendSurfaceEvent(surfaceId, mode === 'detailed' ? 'expand' : 'detail')}
                >
                  {mode === 'detailed' ? 'Restore' : 'Detail'}
                </button>
                <button
                  type="button"
                  aria-label={`${mode === 'focus' ? 'Exit focus for' : 'Focus'} ${title}`}
                  aria-pressed={mode === 'focus'}
                  onClick={() => sendSurfaceEvent(surfaceId, mode === 'focus' ? 'expand' : 'focus')}
                >
                  {mode === 'focus' ? 'Exit focus' : 'Focus'}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {mode === 'collapsed' ? null : children}
    </Card>
  );
}

export function MetricCard({
  label,
  value,
  detail,
  showDetail = true,
  tone = 'blue',
  className = '',
  edge,
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
  edge?: StatusEdge;
  title?: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
}) {
  const interactive = Boolean(onClick || onContextMenu);
  return (
    <Card
      className={`metric-card metric-card--${tone}${interactive ? ' metric-card--interactive' : ''}${edge ? ` metric-card--edge-${edge}` : ''} ${className}`.trim()}
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
    </Card>
  );
}

export function Pill({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <Badge variant="outline" className={`pill pill--${tone}`}>{children}</Badge>;
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
    <Tabs value={active} onValueChange={onChange}>
      <TabsList className={`surface-tabs ${className}`.trim()}>
        {items.map((item) => (
          <TabsTrigger
            key={item}
            value={item}
            className={`surface-tab${active === item ? ' surface-tab--active' : ''}`}
          >
            {item}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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
