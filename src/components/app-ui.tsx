import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  KeyboardEvent,
  MouseEventHandler,
  ReactNode,
  SelectHTMLAttributes,
  TableHTMLAttributes,
} from 'react';

type Tone = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  children,
  variant = 'secondary',
  loading = false,
  className = '',
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      className={joinClasses('button', `button--${variant}`, loading && 'button--loading', className)}
      disabled={disabled || loading}
    >
      {loading ? <span className="button__spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return <section className={joinClasses('card', interactive && 'card--interactive', className)}>{children}</section>;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={joinClasses('field-input', className)} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={joinClasses('field-input field-select', className)}>
      {children}
    </select>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function MotionPanel({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={joinClasses('motion-panel', className)}>{children}</div>;
}

export function Modal({
  title,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-panel__header">
          <div>
            <h2 id="modal-title" className="modal-panel__title">{title}</h2>
            {description ? <p className="modal-panel__description">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        {children}
      </section>
    </div>
  );
}

export function DataTable({
  children,
  className = '',
  ...props
}: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="table-shell">
      <table {...props} className={joinClasses('data-table', className)}>
        {children}
      </table>
    </div>
  );
}

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
    <header className="page-header motion-panel">
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
    <section className={`panel motion-panel ${className}`.trim()} onContextMenu={onContextMenu}>
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
  return (
    <div
      className={`metric-card motion-panel metric-card--${tone}${onClick || onContextMenu ? ' metric-card--interactive' : ''} ${className}`.trim()}
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
