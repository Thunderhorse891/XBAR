import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ChipTone } from '@/data/xbarSaasMock';

/* ------------------------------------------------------------------ Chips */
export function StatusChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return (
    <span className={`xs-chip xs-chip--${tone}`}>
      <span className="xs-chip__dot" aria-hidden="true" />
      {children}
    </span>
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
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <button type="button" className="xs-overlay" aria-label="Close panel" onClick={onClose} />
      <aside className="xs-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="xs-drawer__head">
          <div>
            <h2 className="xs-drawer__title">{title}</h2>
            {subtitle ? <div className="xs-drawer__sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="xs-iconbtn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="xs-drawer__body">{children}</div>
        {footer ? <div className="xs-drawer__foot">{footer}</div> : null}
      </aside>
    </>
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
