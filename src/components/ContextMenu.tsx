import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';

type MenuTone = 'default' | 'danger';

export type ContextMenuItem = {
  id: string;
  label: string;
  onSelect: () => void;
  tone?: MenuTone;
  disabled?: boolean;
};

export function ContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;

    triggerRef.current = document.activeElement;

    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        if (!items?.length) return;
        const arr = Array.from(items);
        const current = arr.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'ArrowDown'
          ? (current + 1) % arr.length
          : (current - 1 + arr.length) % arr.length;
        arr[next]?.focus();
      }
    };

    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);

    const firstItem = menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    firstItem?.focus();

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
      if (triggerRef.current instanceof HTMLElement) {
        triggerRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      style={{
        left: Math.min(x, window.innerWidth - 224),
        top: Math.min(y, window.innerHeight - Math.max(140, items.length * 44)),
      }}
      role="menu"
      aria-orientation="vertical"
    >
      {items.map((item) => (
        <button
          key={item.id}
          className={`context-menu__item${item.tone === 'danger' ? ' context-menu__item--danger' : ''}${item.disabled ? ' context-menu__item--disabled' : ''}`}
          type="button"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          role="menuitem"
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
