import type { ComponentType, ReactNode, SVGProps } from 'react';

export function EmptyState({
  title,
  description,
  action,
  icon: Icon,
  compact = false,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state${compact ? ' empty-state--compact' : ''}`} role="status" aria-live="polite">
      {Icon && !compact ? (
        <div className="empty-state__icon" aria-hidden="true">
          <Icon style={{ width: 24, height: 24 }} />
        </div>
      ) : null}
      <div className="empty-state__title">{title}</div>
      <div className="empty-state__description">{description}</div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

