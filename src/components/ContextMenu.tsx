import { useCallback, useEffect, useMemo, useRef } from 'react';

interface ContextMenuOption {
  label: string;
  hint?: string;
  tone?: 'default' | 'danger';
  action: () => void;
}

interface ContextMenuProps {
  options: ContextMenuOption[];
  x: number;
  y: number;
  onClose: () => void;
}

export default function ContextMenu({ options, x, y, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  const position = useMemo(() => {
    if (typeof window === 'undefined') {
      return { left: x, top: y };
    }

    const estimatedWidth = 280;
    const estimatedHeight = Math.max(140, options.length * 56);
    const padding = 16;

    return {
      left: Math.min(x, window.innerWidth - estimatedWidth - padding),
      top: Math.min(y, window.innerHeight - estimatedHeight - padding),
    };
  }, [options.length, x, y]);

  const handleClick = useCallback(
    (e: React.MouseEvent, action: () => void) => {
      e.stopPropagation();
      action();
      onClose();
    },
    [onClose]
  );

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={position}
      role="menu"
      aria-label="Quick actions"
    >
      {options.map(({ label, hint, tone = 'default', action }, i) => (
        <button
          key={i}
          onClick={(e) => handleClick(e, action)}
          className={`context-menu__item${tone === 'danger' ? ' context-menu__item--danger' : ''}`}
          type="button"
          role="menuitem"
        >
          <span className="context-menu__label">{label}</span>
          {hint ? <span className="context-menu__hint">{hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
