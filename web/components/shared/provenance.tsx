import { FileText, Image as ImageIcon } from 'lucide-react';
import type { HorseDocument } from '@/lib/types';
import { DOCUMENT_TYPE_LABELS } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { VerificationBadge, MicroLabel } from './status';
import { formatBytes, formatDate } from '@/lib/utils';

// Provenance line: file title, document type, uploaded date, matched horse,
// verification state — required on every document row in the system.
export function DocumentProvenance({ document, compact = false }: { document: HorseDocument; compact?: boolean }) {
  const Icon = document.mimeType.startsWith('image/') ? ImageIcon : FileText;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div
        aria-hidden
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-steel/50 bg-canvas text-gunmetal sm:h-[60px] sm:w-[60px]"
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink">{document.title}</p>
          <Badge variant="outline">{DOCUMENT_TYPE_LABELS[document.type]}</Badge>
          <VerificationBadge state={document.verification} />
        </div>
        <p className="mt-0.5 truncate text-xs text-steel-muted">
          {document.fileName} · {formatBytes(document.sizeBytes)} · uploaded {formatDate(document.uploadedAt)} by {document.uploadedBy}
        </p>
        {!compact && (
          <MicroLabel className="mt-1 block">
            {document.horseName ? `Matched: ${document.horseName}` : 'Unmatched — assign to a horse'}
          </MicroLabel>
        )}
      </div>
    </div>
  );
}
