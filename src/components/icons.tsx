import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3" y="3" width="7" height="10" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="17" width="7" height="4" rx="1.5" />
    </IconBase>
  );
}

export function HorsesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 4.5c1.8-1.2 4.2-1 5.8.5 1 1 1.5 2.4 1.2 3.8L15 11c-.6.8-1 1.8-1 2.8V17H10v-3c0-1-.4-2-1-2.8L8 9.5C6.8 8 6.5 6 7.5 4.5" />
      <path d="M9 4.5c.5-.3 1-.5 1.5-.5" />
      <path d="M15.5 4c.5.2.9.4 1.3.8" />
      <path d="M10 17v3" />
      <path d="M14 17v3" />
      <circle cx="13.5" cy="6.5" r=".7" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function DocumentsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 12h6" />
      <path d="M9 16h6" />
    </IconBase>
  );
}

export function OwnershipIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.4 19 6v5.4c0 4.3-2.6 7.5-7 9.2-4.4-1.7-7-4.9-7-9.2V6l7-2.6Z" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  );
}

export function MedicalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8" />
      <path d="M8 12h8" />
    </IconBase>
  );
}

export function BreedingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8.5" cy="5.5" r="2.5" />
      <circle cx="15.5" cy="5.5" r="2.5" />
      <circle cx="12" cy="18" r="2.5" />
      <path d="M8.5 8v4.5L12 15.5" />
      <path d="M15.5 8v4.5L12 15.5" />
    </IconBase>
  );
}

export function SalesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 17 8 11.5l4 3.5 5-7" />
      <path d="M14 8h6v5" />
      <path d="M3 20h18" />
    </IconBase>
  );
}

export function AssetsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14.5 3.5c1 1 1 2.5 0 3.5L5 16.5 3.5 20.5 7.5 19 17 9.5c1-1 2.5-1 3.5 0" />
      <path d="M12.5 5.5l6 6" />
    </IconBase>
  );
}

export function ExpensesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 5l1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5 1.5 1.5 1.5-1.5 1 1V20l-1-1-1.5 1.5-1.5-1.5-1.5 1.5-1.5-1.5-1.5 1.5-1.5-1.5-1.5 1.5-1.5-1.5L4 20V5Z" />
      <path d="M9 10h6" />
      <path d="M9 13h6" />
      <path d="M9 16h4" />
    </IconBase>
  );
}

export function SubscriptionIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m12 3 2.6 5.3L20 9.1l-4 3.9.9 5.5L12 15.9 7.1 18.5 8 13 4 9.1l5.4-.8L12 3Z" />
    </IconBase>
  );
}

export function SharedAccessIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98" />
      <path d="M15.41 6.51L8.59 10.49" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </IconBase>
  );
}

export function WeatherIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 16.5a3.5 3.5 0 1 1 .6-6.9A5 5 0 0 1 17 8a4 4 0 1 1 .8 7.9H7Z" />
      <path d="M9 19.5v1" />
      <path d="M12 18.5v2" />
      <path d="M15 19.5v1" />
    </IconBase>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-3.5-3.5" />
    </IconBase>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15.5 17.5h-7a2 2 0 0 1-2-2l.7-1.1c.5-.8.8-1.8.8-2.8V10a4.5 4.5 0 0 1 9 0v1.6c0 1 .3 2 .8 2.8l.7 1.1a2 2 0 0 1-2 2Z" />
      <path d="M10 19a2.3 2.3 0 0 0 4 0" />
    </IconBase>
  );
}

export function AddIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  );
}

export function DotsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </IconBase>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m15 18-6-6 6-6" />
    </IconBase>
  );
}

export function MarketplaceIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 9l1-6h16l1 6" />
      <path d="M3 9a2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0 2 2 0 0 0 4 0" />
      <path d="M5 21V9" />
      <path d="M19 21V9" />
      <rect x="9" y="14" width="6" height="7" rx="1" />
    </IconBase>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 15V3" />
      <path d="M7.5 7.5 12 3l4.5 4.5" />
      <path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4" />
    </IconBase>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="2" y="6" width="20" height="13" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M10 14h.01M14 14h.01M18 14h.01M8 18h8" />
    </IconBase>
  );
}
