import { useCallback, useEffect, useId, useRef, useState } from 'react';

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
};

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({ open: false, title: '', message: '' });
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const titleId = useId();

  const confirm = useCallback((title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      triggerRef.current = document.activeElement;
      resolveRef.current = resolve;
      setState({ open: true, title, message });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    resolveRef.current?.(true);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  const handleCancel = useCallback(() => {
    resolveRef.current?.(false);
    resolveRef.current = null;
    setState((s) => ({ ...s, open: false }));
  }, []);

  useEffect(() => {
    if (!state.open) return;

    const focusable = 'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { handleCancel(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const all = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(focusable));
      if (!all.length) { e.preventDefault(); return; }
      const first = all[0];
      const last = all[all.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };

    window.addEventListener('keydown', trap);
    return () => {
      window.removeEventListener('keydown', trap);
      if (triggerRef.current instanceof HTMLElement && triggerRef.current.isConnected) {
        triggerRef.current.focus();
      }
    };
  }, [state.open, handleCancel]);

  const dialog = state.open ? (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
      <div className="confirm-dialog">
        <h3 className="confirm-dialog__title" id={titleId}>{state.title}</h3>
        <p className="confirm-dialog__message">{state.message}</p>
        <div className="confirm-dialog__actions">
          <button className="button button--ghost button--compact" type="button" onClick={handleCancel} autoFocus>Cancel</button>
          <button className="button button--primary button--compact" type="button" onClick={handleConfirm}>Confirm</button>
        </div>
      </div>
    </div>
  ) : null;

  return { confirm, dialog };
}
