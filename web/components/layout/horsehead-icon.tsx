import * as React from 'react';

// Minimal line-art horse mark consistent with Lucide's 24px / 2px-stroke grid.
export function HorseheadIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      {...props}
    >
      <path d="M5 21c0-4 1.5-7 4-9l7-7 1 4 3 2-2 2h-3l-2 2c-1.5 1.5-2 3.5-2 6" />
      <path d="M15 5l-1.5-2" />
    </svg>
  );
}
