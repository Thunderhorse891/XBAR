import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? ' empty-state--compact' : ''}`} role="status" aria-live="polite">
      <div className="empty-state__title">{title}</div>
      <div className="empty-state__description">{description}</div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

