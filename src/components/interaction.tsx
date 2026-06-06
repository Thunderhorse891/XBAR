import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { DotsIcon } from '@/components/icons';

export function activateOnKeyboard<T extends HTMLElement>(onActivate: () => void) {
  return (event: KeyboardEvent<T>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onActivate();
    }
  };
}

export function openContextMenuOnKeyboard<T extends HTMLElement>(onOpen: (x: number, y: number) => void) {
  return (event: KeyboardEvent<T>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onOpen(bounds.left + Math.min(bounds.width, 32), bounds.top + Math.min(bounds.height, 32));
  };
}

export function ActionMenuButton({
  label = 'Open actions',
  onOpen,
  disabled = false,
  disabledReason,
  className = '',
}: {
  label?: string;
  onOpen: (x: number, y: number) => void;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const explanation = disabled ? disabledReason ?? 'This action is unavailable.' : `${label}. You can also right-click the record or press Shift+F10.`;
  return (
    <button
      type="button"
      className={`icon-button icon-button--compact action-menu-button ${className}`.trim()}
      aria-label={label}
      aria-haspopup="menu"
      aria-disabled={disabled}
      disabled={disabled}
      title={explanation}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        onOpen(bounds.right - 4, bounds.bottom + 8);
      }}
    >
      <DotsIcon className="icon-button__icon" />
    </button>
  );
}

export function LockedAction({
  children,
  reason,
  className = '',
}: {
  children: ReactNode;
  reason: string;
  className?: string;
}) {
  return (
    <span className={`locked-action ${className}`.trim()} title={reason} aria-label={reason}>
      {children}
      <span className="locked-action__reason" role="status">{reason}</span>
    </span>
  );
}
