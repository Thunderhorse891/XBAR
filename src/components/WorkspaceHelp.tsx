import { useEffect, useRef } from 'react';
import { CloseIcon } from '@/components/icons';

export type HelpSection = {
  label: string;
  text: string;
};

export function WorkspaceHelp({
  open,
  title,
  sections,
  onClose,
}: {
  open: boolean;
  title: string;
  sections: HelpSection[];
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement;
    closeRef.current?.focus();

    const focusable = 'button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const panel = closeRef.current?.closest('.help-panel');
      if (!panel) return;
      const all = Array.from(panel.querySelectorAll<HTMLElement>(focusable));
      if (!all.length) { event.preventDefault(); return; }
      const first = all[0];
      const last = all[all.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (openerRef.current instanceof HTMLElement && openerRef.current.isConnected) {
        openerRef.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="help-backdrop" onClick={onClose} role="presentation">
      <aside
        className="help-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} guide`}
      >
        <div className="help-panel__header">
          <div>
            <div className="help-panel__kicker">Guide</div>
            <h2 className="help-panel__title">{title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="help-panel__close"
            aria-label="Close guide"
          >
            <CloseIcon style={{ width: 18, height: 18, strokeWidth: 2 }} />
          </button>
        </div>

        <div className="help-panel__sections">
          {sections.length ? sections.map((section) => (
            <div key={section.label} className="help-panel__section">
              <div className="help-panel__section-label">{section.label}</div>
              <p className="help-panel__section-text">{section.text}</p>
            </div>
          )) : (
            <p className="help-panel__section-text">No help content available for this page.</p>
          )}
        </div>
      </aside>
    </div>
  );
}
