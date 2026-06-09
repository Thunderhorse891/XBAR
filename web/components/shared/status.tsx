import { ShieldCheck, Clock3, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { VerificationState } from '@/lib/types';
import { cn, daysUntil, formatDate, initials } from '@/lib/utils';

// Every status explains why it exists — the title attribute carries the reason.
const VERIFICATION_META: Record<VerificationState, { label: string; reason: string; variant: 'verified' | 'pending' | 'blocked'; icon: typeof ShieldCheck }> = {
  verified: { label: 'Verified', reason: 'OCR extraction matched registry data above the 90% confidence threshold.', variant: 'verified', icon: ShieldCheck },
  pending: { label: 'Pending review', reason: 'Extraction confidence is below 90% — a person must confirm the fields.', variant: 'pending', icon: Clock3 },
  blocked: { label: 'Blocked', reason: 'Required data is missing or expired; downstream workflows are paused.', variant: 'blocked', icon: ShieldAlert },
};

export function VerificationBadge({ state }: { state: VerificationState }) {
  const meta = VERIFICATION_META[state];
  const Icon = meta.icon;
  return (
    <Badge variant={meta.variant} title={meta.reason}>
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </Badge>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  // No green: high confidence renders in XBAR blue.
  const variant = pct > 90 ? 'verified' : pct >= 70 ? 'pending' : 'blocked';
  const reason =
    pct > 90
      ? 'High confidence — fields auto-accepted.'
      : pct >= 70
        ? 'Medium confidence — review highlighted fields.'
        : 'Low confidence — manual correction required before saving.';
  return (
    <Badge variant={variant} title={reason}>
      {pct}% confidence
    </Badge>
  );
}

export function ExpiryBadge({ label, dueAt }: { label: string; dueAt: string | null | undefined }) {
  const days = daysUntil(dueAt);
  if (days === null) return null;
  if (days < 0) {
    return (
      <Badge variant="blocked" title={`${label} expired ${formatDate(dueAt)} — renew before generating packets.`}>
        {label} expired {Math.abs(days)}d ago
      </Badge>
    );
  }
  if (days <= 7) {
    return (
      <Badge variant="blocked" title={`${label} expires ${formatDate(dueAt)}.`}>
        {label} expires in {days}d
      </Badge>
    );
  }
  if (days <= 30) {
    return (
      <Badge variant="pending" title={`${label} expires ${formatDate(dueAt)}.`}>
        {label} due in {days}d
      </Badge>
    );
  }
  return null;
}

export function MicroLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('text-[11px] font-semibold uppercase tracking-micro text-steel-muted', className)}>
      {children}
    </span>
  );
}

export function HorseAvatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg border border-metal bg-ink-graphite font-semibold text-surface',
        size === 'sm' && 'h-10 w-10 text-xs',
        size === 'md' && 'h-12 w-12 text-sm sm:h-[60px] sm:w-[60px] sm:text-base',
        size === 'lg' && 'h-16 w-16 text-lg sm:h-24 sm:w-24 sm:text-2xl',
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}
