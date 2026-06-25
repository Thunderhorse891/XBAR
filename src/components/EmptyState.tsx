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
    <div className={`empty-state${compact ? ' empty-state--compact' : ''}`}>
      {Icon && !compact ? (
        <div className="empty-state__icon" aria-hidden="true">
          <Icon style={{ width: 24, height: 24 }} />
        </div>
      ) : null}
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__description">{description}</p>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
