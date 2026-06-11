'use client';

import { FileText, Image as ImageIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ConfidenceBadge, MicroLabel, VerificationBadge } from '@/components/shared/status';
import type { HorseDocument } from '@/lib/types';
import { DOCUMENT_TYPE_LABELS } from '@/lib/types';
import { formatBytes, formatDate } from '@/lib/utils';

export function DocumentPreviewModal({
  document,
  onClose,
}: {
  document: HorseDocument | null;
  onClose: () => void;
}) {
  const isImage = document?.mimeType.startsWith('image/') ?? false;
  const Icon = isImage ? ImageIcon : FileText;

  return (
    <Dialog open={Boolean(document)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl p-0 overflow-hidden">
        {document && (
          <div className="grid md:grid-cols-[1fr_260px]">
            {/* Light document body */}
            <div className="p-6">
              <DialogHeader>
                <DialogTitle>{document.title}</DialogTitle>
              </DialogHeader>
              <div className="mt-4 flex aspect-[3/4] max-h-[55vh] w-full items-center justify-center rounded-md border border-steel/40 bg-canvas">
                <div className="text-center">
                  <Icon className="mx-auto h-12 w-12 text-steel" aria-hidden />
                  <p className="mt-3 text-sm font-medium text-gunmetal">{document.fileName}</p>
                  <p className="text-xs text-steel-muted">
                    {isImage ? 'Image preview' : 'PDF preview'} renders here when connected to document storage.
                  </p>
                </div>
              </div>
            </div>
            {/* Dark metadata sidebar */}
            <aside className="space-y-4 border-t border-metal bg-panel-strong p-5 text-surface md:border-l md:border-t-0" aria-label="Document metadata">
              <MicroLabel className="text-steel-strong">Provenance</MicroLabel>
              <dl className="space-y-3 text-sm">
                <MetaRow label="Type"><Badge variant="graphite">{DOCUMENT_TYPE_LABELS[document.type]}</Badge></MetaRow>
                <MetaRow label="Verification"><VerificationBadge state={document.verification} /></MetaRow>
                <MetaRow label="OCR confidence"><ConfidenceBadge value={document.confidence} /></MetaRow>
                <MetaRow label="Matched horse">{document.horseName ?? 'Unassigned'}</MetaRow>
                <MetaRow label="Uploaded">{formatDate(document.uploadedAt)} by {document.uploadedBy}</MetaRow>
                <MetaRow label="File size">{formatBytes(document.sizeBytes)}</MetaRow>
              </dl>
              {Object.keys(document.extracted).length > 0 && (
                <>
                  <MicroLabel className="text-steel-strong">Extracted fields</MicroLabel>
                  <dl className="space-y-1.5 text-xs">
                    {Object.entries(document.extracted).map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <dt className="capitalize text-steel-muted">{key.replace(/([A-Z])/g, ' $1')}</dt>
                        <dd className="font-medium text-heading">{value || '—'}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-xs text-steel-muted">{label}</dt>
      <dd className="text-right text-xs font-medium text-heading">{children}</dd>
    </div>
  );
}
