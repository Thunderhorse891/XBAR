import { cn } from '@/lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  className,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-3 rounded-lg border border-dashed border-steel bg-canvas p-8', className)}>
      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-blueline bg-accent-glow" aria-hidden>
        <Icon className="h-6 w-6 text-accent-strong" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-gunmetal">{body}</p>
      </div>
      {action}
    </div>
  );
}
