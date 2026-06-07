import { useCallback, useRef, useState } from 'react';

type ConfirmState = {
  open: boolean;
  title: string;
  message: string;
};

export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({ open: false, title: '', message: '' });
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((title: string, message: string): Promise<boolean> => {
    return new Promise((resolve) => {
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

  const dialog = state.open ? (
    <div className="confirm-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="confirm-dialog">
        <h3 className="confirm-dialog__title" id="confirm-title">{state.title}</h3>
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
