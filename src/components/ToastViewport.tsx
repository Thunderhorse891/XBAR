import { createPortal } from 'react-dom';
import { useEffect } from 'react';
import { useUiStore } from '@/store/useUiStore';

function ToastCard({
  id,
  title,
  message,
  tone,
  duration,
}: {
  id: string;
  title?: string;
  message: string;
  tone: 'success' | 'error' | 'warning' | 'info';
  duration: number;
}) {
  const removeToast = useUiStore((state) => state.removeToast);

  useEffect(() => {
    const timer = window.setTimeout(() => removeToast(id), duration);
    return () => window.clearTimeout(timer);
  }, [duration, id, removeToast]);

  return (
    <div className={`toast toast--${tone}`} role="status">
      <div className="toast__body">
        {title ? <div className="toast__title">{title}</div> : null}
        <div className="toast__message">{message}</div>
      </div>
      <button className="toast__dismiss" type="button" onClick={() => removeToast(id)} aria-label="Dismiss notification">
        Dismiss
      </button>
    </div>
  );
}

export function ToastViewport() {
  const toasts = useUiStore((state) => state.toasts);

  if (!toasts.length || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} {...toast} />
      ))}
    </div>,
    document.body,
  );
}

