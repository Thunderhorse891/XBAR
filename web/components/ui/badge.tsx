import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-micro',
  {
    variants: {
      variant: {
        // No green in the system: verified states render in XBAR blue.
        verified: 'bg-accent-glow text-accent-strong border border-blueline',
        pending: 'bg-warning/15 text-warning border border-warning/40',
        blocked: 'bg-danger/15 text-danger border border-danger/40',
        steel: 'bg-steel/20 text-gunmetal border border-steel/50',
        graphite: 'bg-ink-graphite text-surface border border-metal',
        blue: 'bg-accent text-ink border border-accent',
        outline: 'border border-steel text-gunmetal',
      },
    },
    defaultVariants: { variant: 'steel' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
