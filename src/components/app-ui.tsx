import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';

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

function HoverText({
  as = 'span',
  className,
  value,
  children,
}: {
  as?: 'div' | 'span' | 'p' | 'h1' | 'h2';
  className?: string;
  value: ReactNode;
  children: ReactNode;
}) {
  const tooltip = toHoverText(value);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const ref = useRef<HTMLElement | null>(null);
  const Component = as;

  const updatePosition = () => {
    if (!ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    const maxWidth = Math.min(340, window.innerWidth - 24);
    const centeredLeft = bounds.left + bounds.width / 2 - maxWidth / 2;
    setPosition({
      left: Math.min(Math.max(12, centeredLeft), window.innerWidth - maxWidth - 12),
      top: Math.max(12, bounds.bottom + 10),
    });
  };

  useEffect(() => {
    if (!open) return;

    const handleViewportChange = () => updatePosition();
    window.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      window.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [open]);

  return (
    <>
      <Component
        ref={(node) => {
          ref.current = node as HTMLElement | null;
        }}
        className={className}
        data-hover={tooltip}
        onMouseEnter={() => {
          if (!tooltip) return;
          updatePosition();
          setOpen(true);
        }}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => {
          if (!tooltip) return;
          updatePosition();
          setOpen(true);
        }}
        onBlur={() => setOpen(false)}
      >
        {children}
      </Component>
      {open && tooltip && typeof document !== 'undefined'
        ? createPortal(
            <div className="hover-bubble" style={position} role="tooltip">
              {tooltip}
            </div>,
            document.body,
          )
        : null}
    </>
  );
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
          <HoverText as="div" className="eyebrow hover-copy" value={eyebrow}>
            {eyebrow}
          </HoverText>
        ) : null}
        <HoverText as="h1" className="page-title hover-copy" value={title}>
          {title}
        </HoverText>
        <HoverText as="p" className="page-description hover-copy" value={description}>
          {description}
        </HoverText>
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
            <HoverText as="div" className="panel__eyebrow hover-copy" value={eyebrow}>
              {eyebrow}
            </HoverText>
          ) : null}
          <div className="panel__title-row">
            <HoverText as="h2" className="panel__title hover-copy" value={title}>
              {title}
            </HoverText>
            {meta ? <div className="panel__meta">{meta}</div> : null}
          </div>
          {description ? (
            <HoverText as="p" className="panel__description hover-copy" value={description}>
              {description}
            </HoverText>
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
    <div className={`metric-card metric-card--${tone}`}>
      <HoverText as="div" className="metric-card__label hover-copy" value={label}>
        {label}
      </HoverText>
      <HoverText as="div" className="metric-card__value hover-copy" value={value}>
        {value}
      </HoverText>
      <HoverText as="div" className="metric-card__detail hover-copy" value={detail}>
        {detail}
      </HoverText>
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
    <HoverText as="span" className={`pill pill--${tone} hover-copy`} value={title}>
      {children}
    </HoverText>
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
      <HoverText as="span" className="key-value__label hover-copy" value={label}>
        {label}
      </HoverText>
      <HoverText as="span" className="key-value__value hover-copy" value={toHoverText(value)}>
        {value}
      </HoverText>
    </div>
  );
}
