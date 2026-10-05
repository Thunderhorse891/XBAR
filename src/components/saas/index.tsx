import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ChipTone, TaskPriority } from '@/types/saas';

/* ------------------------------------------------------------------ Chips */
export function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={`xs-chip xs-chip--${tone}`}>
      <span className="xs-chip__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

const priorityTone: Record<TaskPriority, ChipTone> = {
  'Revenue Blocker': 'danger',
  High: 'warning',
  Medium: 'info',
  Normal: 'neutral',
  Planned: 'neutral',
};

export function PriorityChip({ priority }: { priority: TaskPriority }) {
  return <StatusChip tone={priorityTone[priority]}>{priority}</StatusChip>;
}

/* ----------------------------------------------------------- Action button */
export function ActionButton({
  children,
  onClick,
  variant = 'default',
  size,
  block,
  disabled,
  icon,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'brass' | 'ghost';
  size?: 'sm';
  block?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const cls = [
    'xs-btn',
    variant !== 'default' ? `xs-btn--${variant}` : '',
    size === 'sm' ? 'xs-btn--sm' : '',
    block ? 'xs-btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {icon}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- Filter tabs */
export function FilterTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly string[];
  active: string;
  onChange: (tab: string) => void;
}) {
  return (
    <div className="xs-tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          className={`xs-tab${active === tab ? ' xs-tab--active' : ''}`}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- Quick create menu */
export function QuickCreateMenu({
  trigger,
  items,
}: {
  trigger: (open: () => void) => ReactNode;
  items: { label: string; icon?: ReactNode; onSelect: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div className="xs-menu" ref={ref}>
      {trigger(() => setOpen((v) => !v))}
      {open ? (
        <div className="xs-menu__pop" role="menu">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="xs-menu__item"
              onClick={() => {
                // The item unmounts on selection; restore a persistent opener
                // before a programmatically opened modal captures return focus.
                ref.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus({ preventScroll: true });
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <span className="xs-menu__icon">{item.icon}</span> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- Cards */
export function Card({
  title,
  subtitle,
  link,
  onLink,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  link?: string;
  onLink?: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`xs-card ${className}`.trim()}>
      {title || link ? (
        <div className="xs-card__head">
          <div>
            {title ? <h2 className="xs-card__title">{title}</h2> : null}
            {subtitle ? <div className="xs-card__sub">{subtitle}</div> : null}
          </div>
          {link ? (
            <button type="button" className="xs-card__link" onClick={onLink}>
              {link}
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/* --------------------------------------------------------- Metric stack */
export function MetricRow({
  icon,
  value,
  label,
  onClick,
}: {
  icon: ReactNode;
  value: string | number;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="xs-metric" onClick={onClick}>
      <span className="xs-metric__icon">{icon}</span>
      <span>
        <span className="xs-metric__value">{value}</span>
        <span className="xs-metric__label">{label}</span>
      </span>
    </button>
  );
}

/* ------------------------------------------------------- Readiness donut */
export function ReadinessChart({
  score,
  segments,
  mark,
}: {
  score: number;
  segments: { label: string; value: number; tone: string }[];
  mark?: ReactNode;
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="xs-donut">
      <svg viewBox="0 0 200 200" width="200" height="200" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--xbar-surface-warm)" strokeWidth="16" />
        {segments.map((seg) => {
          const length = (seg.value / total) * circumference;
          const dash = `${length} ${circumference - length}`;
          const circle = (
            <circle
              key={seg.label}
              cx="100"
              cy="100"
              r={radius}
              fill="none"
              stroke={seg.tone}
              strokeWidth="16"
              strokeLinecap="round"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
            />
          );
          offset += length;
          return circle;
        })}
      </svg>
      <div className="xs-donut__center">
        {mark ? <span className="xs-donut__mark">{mark}</span> : null}
        <span className="xs-donut__score">{score}%</span>
        <span className="xs-donut__caption">Readiness</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- Slide-over */
export function SlideOverDrawer({
  open,
  title,
  subtitle,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  // These drawers are also opened programmatically, without a Radix Trigger.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="xs-overlay" />
        <DialogPrimitive.Content
          asChild
          {...(!subtitle ? { 'aria-describedby': undefined } : {})}
          onInteractOutside={(event) => {
            // A notification's Close/Undo control is not a request to discard
            // the draft underneath it. Keep the modal and its focus boundary.
            if (event.target instanceof Element && event.target.closest('[data-sonner-toast]')) {
              event.preventDefault();
            }
          }}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus({ preventScroll: true });
            }
          }}
        >
          <aside className="xs-drawer">
            <div className="xs-drawer__head">
              <div>
                <DialogPrimitive.Title asChild>
                  <h2 className="xs-drawer__title">{title}</h2>
                </DialogPrimitive.Title>
                {subtitle ? (
                  <DialogPrimitive.Description asChild>
                    <div className="xs-drawer__sub">{subtitle}</div>
                  </DialogPrimitive.Description>
                ) : null}
              </div>
              <DialogPrimitive.Close asChild>
                <button type="button" className="xs-iconbtn" aria-label="Close">
                  <X size={16} />
                </button>
              </DialogPrimitive.Close>
            </div>
            <div className="xs-drawer__body">{children}</div>
            {footer ? <div className="xs-drawer__foot">{footer}</div> : null}
          </aside>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ----------------------------------------------------- Setup progress ring */
export function ProgressRing({ value, size = 22 }: { value: number; size?: number }) {
  const stroke = 3;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--xbar-border)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--xbar-brass)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

/* --------------------------------------------------------- Page header */
export function PageHead({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="xs-page__head">
      <div>
        {eyebrow ? <div className="xs-eyebrow">{eyebrow}</div> : null}
        <h1 className="xs-title">{title}</h1>
        {subtitle ? <p className="xs-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="xs-topbar__right">{actions}</div> : null}
    </div>
  );
}
