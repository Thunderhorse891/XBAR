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
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </IconBase>
  );
}

export function HorsesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 6.2c1.4-1.6 3.6-2.5 5.6-2.2 1.9.3 3.7 1.6 4.5 3.4.8 1.9.4 4.2-1 5.7l-1.7 1.8c-.6.6-1 1.5-1 2.4V20l-2-1.2L10 20v-3.1c0-.9-.3-1.8-.9-2.4l-1.5-1.6c-1.4-1.5-1.8-3.8-1.1-5.7.2-.5.4-.8.5-1Z" />
      <path d="M10.7 7.6c.8.2 1.5.8 2 1.5" />
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
      <path d="M8.5 11.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M16.5 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
      <path d="M4.5 19c0-2.8 2.5-5 5.6-5s5.4 2.2 5.4 5" />
      <path d="M14.8 19c.2-1.6 1.7-3 3.7-3 1 0 1.9.3 2.6.9" />
    </IconBase>
  );
}

export function MedicalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 21s-6-3.9-8.2-8.2C2 9.8 3.5 6 7 6c2 0 3.1 1.2 5 3.5C13.9 7.2 15 6 17 6c3.5 0 5 3.8 3.2 6.8C18 17.1 12 21 12 21Z" />
      <path d="M12 9v6" />
      <path d="M9 12h6" />
    </IconBase>
  );
}

export function BreedingIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M12 10c-3.3 0-5-1.7-5-5" />
      <path d="M12 10c3.3 0 5-1.7 5-5" />
      <path d="M12 14c-3.3 0-5 1.7-5 5" />
      <path d="M12 14c3.3 0 5 1.7 5 5" />
    </IconBase>
  );
}

export function SalesIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 17.5 10 11l4 4 6-8" />
      <path d="M15 7h5v5" />
      <path d="M4 20h16" />
    </IconBase>
  );
}

export function WeatherIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 17.5h8.2A3.8 3.8 0 0 0 16 10a5 5 0 0 0-9.7 1.6A3.2 3.2 0 0 0 8 17.5Z" />
      <path d="m10.5 20 1.5-2.4h-1.8L12 15" />
    </IconBase>
  );
}

export function AssetsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 8.5h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9Z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
      <path d="M9.5 13h5" />
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

export function PortalIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 4.5h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2Z" />
      <path d="M14 12H8" />
      <path d="m11 9 3 3-3 3" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h8" />
      <path d="M4 17h16" />
      <path d="M16 7h4" />
      <path d="M4 12h16" />
      <circle cx="14" cy="7" r="2" />
      <circle cx="8" cy="12" r="2" />
      <circle cx="13" cy="17" r="2" />
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
