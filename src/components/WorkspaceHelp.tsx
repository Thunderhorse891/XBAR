import { useEffect, useRef } from 'react';

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

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
            ×
          </button>
        </div>

        <div className="help-panel__sections">
          {sections.map((section) => (
            <div key={section.label} className="help-panel__section">
              <div className="help-panel__section-label">{section.label}</div>
              <p className="help-panel__section-text">{section.text}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
