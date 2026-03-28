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
    <div className="fixed inset-0 z-[120] flex items-center justify-end bg-[#f0e9e1]/70 p-4 backdrop-blur-[2px]" onClick={onClose} role="presentation">
      <aside
        className="w-full max-w-[360px] rounded-[12px] border border-[#e5ddd2] bg-[#fffdfb] p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${title} guide`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8f8276]">Guide</div>
            <h2 className="mt-2 text-lg font-bold tracking-[-0.04em] text-[#202225]">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#dce4ec] text-[#667085] transition-all duration-150 ease-[ease] hover:border-[#202225]/20 hover:text-[#202225]"
            aria-label="Close guide"
          >
            ×
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-2.5">
          {sections.map((section) => (
            <div key={section.label} className="rounded-md border border-[#e5ddd2] bg-[#fcfaf7] px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b6f63]">{section.label}</div>
              <p className="mt-1.5 text-sm leading-6 text-[#475467]">{section.text}</p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
