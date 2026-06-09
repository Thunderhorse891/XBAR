'use client';

import dynamic from 'next/dynamic';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, FileSearch } from 'lucide-react';
import { Header } from '@/components/layout/header';
import { DropZone } from '@/components/documents/drop-zone';
import { DocumentPreviewModal } from '@/components/documents/preview-modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { DocumentProvenance } from '@/components/shared/provenance';
import { ConfidenceBadge, MicroLabel } from '@/components/shared/status';
import { api } from '@/lib/api';
import { useDocuments, useHorses } from '@/hooks/queries';
import { useOcrStore } from '@/stores/ocr';
import type { HorseDocument } from '@/lib/types';
import { DOCUMENT_TYPE_LABELS } from '@/lib/types';

// OCR workflow modal is code-split; it loads only when an upload starts.
const OcrModal = dynamic(() => import('@/components/documents/ocr-modal'), { ssr: false });

const PAGE_SIZE = 8;

// Staged status messaging for the OCR progress bar.
const OCR_STAGES: [progress: number, text: string][] = [
  [18, 'Uploading files…'],
  [42, 'Reading registration…'],
  [64, 'Extracting Coggins and health fields…'],
  [86, 'Creating horse profiles…'],
];

function DocumentsWorkspace() {
  const params = useSearchParams();
  const ocr = useOcrStore();
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [horseFilter, setHorseFilter] = useState('all');
  const [needsReview, setNeedsReview] = useState(false);
  const [preview, setPreview] = useState<HorseDocument | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const { data: horses } = useHorses();
  const { data } = useDocuments({
    page,
    pageSize: PAGE_SIZE,
    search: search || undefined,
    type: type as never,
    horseId: horseFilter === 'all' ? undefined : horseFilter,
    needsReview: needsReview || undefined,
  });

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  // Deep link: /documents?upload=1 scrolls to and highlights the drop zone.
  useEffect(() => {
    if (params.get('upload') === '1') {
      dropRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      dropRef.current?.focus();
    }
  }, [params]);

  const startOcr = async (files: File[], errors: string[]) => {
    if (files.length === 0) {
      if (errors.length) ocr.setErrors(errors);
      return;
    }
    ocr.begin(files.length);
    if (errors.length) ocr.setErrors(errors);
    for (const [progress, text] of OCR_STAGES) {
      ocr.setStage(progress < 50 ? 'uploading' : progress < 80 ? 'reading' : 'profiling', progress, text);
      await new Promise((resolve) => setTimeout(resolve, 650));
    }
    const results = await api.runOcr(files.map((file) => ({ name: file.name, size: file.size, type: file.type })));
    ocr.setResults(results);
  };

  return (
    <>
      <Header title="Document Manager" />
      <div className="space-y-6 p-4 sm:p-6">
        <div ref={dropRef} tabIndex={-1} className="focus-visible:outline-none">
          <DropZone onFiles={startOcr} />
        </div>

        <section aria-labelledby="library-heading" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="library-heading" className="text-base font-semibold text-ink">Document library</h2>
              <p className="text-sm text-gunmetal">{data?.total ?? 0} documents · every record carries provenance and verification state.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Search documents"
              placeholder="Search title, file, or horse…"
              className="w-full max-w-xs"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            />
            <Select aria-label="Filter by horse" className="w-44" value={horseFilter} onChange={(event) => { setHorseFilter(event.target.value); setPage(0); }}>
              <option value="all">All horses</option>
              {(horses ?? []).map((horse) => (
                <option key={horse.id} value={horse.id}>{horse.name}</option>
              ))}
            </Select>
            <Select aria-label="Filter by type" className="w-44" value={type} onChange={(event) => { setType(event.target.value); setPage(0); }}>
              <option value="all">All types</option>
              {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-steel/50 px-3 py-2 text-sm text-gunmetal">
              <input
                type="checkbox"
                checked={needsReview}
                onChange={(event) => { setNeedsReview(event.target.checked); setPage(0); }}
                className="h-4 w-4 accent-[#18A8FF]"
              />
              Needs review
            </label>
          </div>

          {(data?.documents ?? []).length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="No documents match"
              body="Adjust the filters, or drop files above to start an OCR intake batch."
            />
          ) : (
            <ul className="space-y-2">
              {(data?.documents ?? []).map((doc) => (
                <li key={doc.id}>
                  <button
                    type="button"
                    onClick={() => setPreview(doc)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-steel/40 bg-surface p-3 text-left transition-colors hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <DocumentProvenance document={doc} />
                    <ConfidenceBadge value={doc.confidence} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between">
            <MicroLabel>Page {page + 1} of {totalPages}</MicroLabel>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
                <ChevronLeft aria-hidden /> Prev
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)} aria-label="Next page">
                Next <ChevronRight aria-hidden />
              </Button>
            </div>
          </div>
        </section>
      </div>

      {ocr.phase !== 'idle' && <OcrModal />}
      <DocumentPreviewModal document={preview} onClose={() => setPreview(null)} />
    </>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense fallback={null}>
      <DocumentsWorkspace />
    </Suspense>
  );
}
