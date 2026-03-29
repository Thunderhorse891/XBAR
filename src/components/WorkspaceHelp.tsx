import { useEffect } from 'react';

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
    <div className="fixed inset-0 z-[120] flex items-center justify-end bg-[#d9e2ea]/54 p-4 backdrop-blur-[2px]" onClick={onClose} role="presentation">
      <aside
        className="w-full max-w-[360px] rounded-[10px] border border-[#d7e0e8] bg-[linear-gradient(180deg,#ffffff_0%,#f7fafc_100%)] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} guide`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#7a8c9a]">Guide</div>
            <h2 className="mt-2 text-lg font-bold tracking-[-0.04em] text-[#202225]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#d7e0e8] text-[#667085] transition-all duration-150 ease-[ease] hover:border-[#4A90B8]/30 hover:bg-[#f5f9fc] hover:text-[#202225]"
            aria-label="Close guide"
          >
            ×
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          {sections.map((section) => (
            <div key={section.label} className="rounded-md border border-[#d7e0e8] bg-[#f8fbfd] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5f7484]">{section.label}</div>
              <p className="mt-1.5 text-sm leading-6 text-[#475467]">{section.text}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
