import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';

type MenuTone = 'default' | 'danger';
export type ContextMenuItem = { id: string; label: string; onSelect: () => void; tone?: MenuTone; disabled?: boolean; disabledReason?: string };

export function ContextMenu({ open, x, y, items, onClose }: { open: boolean; x: number; y: number; items: ContextMenuItem[]; onClose: () => void }) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus());
    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      if (!buttons.length) return;
      const current = Math.max(0, buttons.indexOf(document.activeElement as HTMLButtonElement));
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current - 1 + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    window.addEventListener('click', close); window.addEventListener('contextmenu', close); window.addEventListener('resize', close); window.addEventListener('scroll', close, true); window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('click', close); window.removeEventListener('contextmenu', close); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', onKeyDown); };
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(<div ref={menuRef} className="context-menu" style={{ left: Math.max(8, Math.min(x, window.innerWidth - 224)), top: Math.max(8, Math.min(y, window.innerHeight - Math.max(140, items.length * 48))) }} role="menu" aria-label="Record actions" onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
    <div className="context-menu__hint">Actions <span>Esc to close</span></div>
    {items.map((item) => <button key={item.id} className={`context-menu__item${item.tone === 'danger' ? ' context-menu__item--danger' : ''}`} type="button" disabled={item.disabled} aria-disabled={item.disabled} title={item.disabled ? item.disabledReason ?? 'This action is unavailable.' : item.label} onClick={() => { if (item.disabled) return; item.onSelect(); onClose(); }} role="menuitem"><span>{item.label}</span>{item.disabled && item.disabledReason ? <small>{item.disabledReason}</small> : null}</button>)}
  </div>, document.body);
}
