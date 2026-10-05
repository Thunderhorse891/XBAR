'use client';

import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from 'lucide-react';
import { Toaster as Sonner } from 'sonner';
import './actionFeedback.css';

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      expand
      containerAriaLabel="Action notifications"
      offset={{ top: 'max(24px, env(safe-area-inset-top))', right: 24 }}
      mobileOffset={{ top: 'max(16px, env(safe-area-inset-top))', left: 16, right: 16 }}
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            'group xbar-action-toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.xbar-action-toast]:text-muted-foreground',
          actionButton: 'group-[.xbar-action-toast]:bg-primary group-[.xbar-action-toast]:text-primary-foreground',
          cancelButton: 'group-[.xbar-action-toast]:bg-muted group-[.xbar-action-toast]:text-muted-foreground',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
