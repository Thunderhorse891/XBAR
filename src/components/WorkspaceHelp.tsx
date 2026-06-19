import { useEffect } from 'react';
import { XbarMark } from '@/components/BrandMark';

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
  useEffect(() => {
    if (!open) {
      return;
    }

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
    <div className="workspace-help-overlay fixed inset-0 z-[120] flex items-center justify-end p-4" onClick={onClose} role="presentation">
      <aside
        className="workspace-help-drawer w-full max-w-[360px] p-5"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} guide`}
      >
        <div className="workspace-help-drawer__header flex items-start justify-between gap-4">
          <div className="workspace-help-drawer__title">
            <span className="workspace-help-drawer__mark"><XbarMark tone="mono" /></span>
            <div>
              <div className="workspace-help-drawer__eyebrow text-[10px] font-semibold uppercase tracking-[0.28em]">Guide</div>
              <h2 className="mt-2 text-lg font-bold tracking-[-0.04em]">{title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="workspace-help-drawer__close inline-flex h-9 w-9 items-center justify-center"
            aria-label="Close guide"
          >
            ×
          </button>
        </div>

        <div className="workspace-help-drawer__sections mt-5 flex flex-col gap-2.5">
          {sections.map((section) => (
            <div key={section.label} className="workspace-help-drawer__section rounded-md px-4 py-3">
              <div className="workspace-help-drawer__section-label text-[11px] font-semibold uppercase tracking-[0.18em]">{section.label}</div>
              <p className="mt-1.5 text-sm leading-6">{section.text}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
