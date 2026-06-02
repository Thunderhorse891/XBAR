import { createPortal } from 'react-dom';
import { useEffect } from 'react';

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
  useEffect(() => {
    if (!open) return;

    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="context-menu"
      style={{
        left: Math.min(x, window.innerWidth - 224),
        top: Math.min(y, window.innerHeight - Math.max(140, items.length * 44)),
      }}
      role="menu"
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
