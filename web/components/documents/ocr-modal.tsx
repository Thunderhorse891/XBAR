'use client';

import { motion } from 'framer-motion';
import { ScanLine } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { ConfidenceBadge, MicroLabel } from '@/components/shared/status';
import { useHorses, useSaveOcrAssignments } from '@/hooks/queries';
import { useOcrStore } from '@/stores/ocr';
import { cn } from '@/lib/utils';
import { DOCUMENT_TYPE_LABELS } from '@/lib/types';

export default function OcrModal() {
  const { phase, progress, statusText, fileCount, drafts, errors, updateDraft, reset, setStage } = useOcrStore();
  const { data: horses } = useHorses();
  const saveAssignments = useSaveOcrAssignments();
  const open = phase !== 'idle' && phase !== 'done';
  const reviewing = phase === 'review' || phase === 'saving';

  const saveAll = async () => {
    setStage('saving', 100, 'Saving horse assignments…');
    await saveAssignments.mutateAsync(
      drafts.map((draft) => ({
        documentId: draft.documentId,
        horseName: draft.editedHorseName,
        action: draft.assignTo === 'create' ? 'create' : 'assign',
        horseId: draft.assignTo === 'create' ? undefined : draft.assignTo,
      })),
    );
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen && phase !== 'saving') reset(); }}>
      <DialogContent tone="command" className={cn('max-w-2xl', reviewing && 'max-w-4xl')}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-heading">
            <ScanLine className="h-5 w-5 text-accent" aria-hidden /> OCR intake — {fileCount} file{fileCount === 1 ? '' : 's'}
          </DialogTitle>
          <DialogDescription className="text-steel-muted">
            {reviewing
              ? 'Review extracted profiles before anything is written to your records.'
              : 'Reading documents and extracting horse identity fields.'}
          </DialogDescription>
        </DialogHeader>

        {/* Live region so screen readers hear OCR progress updates. */}
        <div aria-live="polite" role="status" className="space-y-2">
          <Progress value={progress} aria-label="OCR progress" />
          <p className="text-sm text-steel-strong">{statusText}</p>
        </div>

        {!reviewing && (
          <div className="relative h-28 overflow-hidden rounded-md border border-metal bg-panel-elevated" aria-hidden>
            <div className="absolute inset-y-0 w-1/3 animate-scan-line bg-gradient-to-r from-transparent via-accent-glow to-transparent" />
            <div className="flex h-full items-center justify-center">
              <MicroLabel className="text-steel-muted">Document intelligence running…</MicroLabel>
            </div>
          </div>
        )}

        {errors.length > 0 && (
          <ul className="space-y-1 rounded-md border border-danger/40 bg-danger/10 p-3" role="alert">
            {errors.map((error) => (
              <li key={error} className="text-xs text-danger">{error}</li>
            ))}
          </ul>
        )}

        {reviewing && (
          <>
            <ul className="grid max-h-[46vh] gap-3 overflow-y-auto sm:grid-cols-2">
              {drafts.map((draft) => {
                const lowConfidence = draft.confidence < 0.9;
                return (
                  <motion.li
                    key={draft.documentId}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    // Light review cards on the dark command surface.
                    className="rounded-lg border border-steel/40 bg-surface p-4 text-ink"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{draft.fileName}</p>
                        <MicroLabel>{DOCUMENT_TYPE_LABELS[draft.type]}</MicroLabel>
                      </div>
                      <ConfidenceBadge value={draft.confidence} />
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor={`name-${draft.documentId}`}>Horse name</Label>
                      <Input
                        id={`name-${draft.documentId}`}
                        value={draft.editedHorseName}
                        onChange={(event) => updateDraft(draft.documentId, { editedHorseName: event.target.value })}
                        aria-describedby={lowConfidence ? `hint-${draft.documentId}` : undefined}
                        className={cn(lowConfidence && 'border-danger focus-visible:ring-danger')}
                      />
                      {lowConfidence && (
                        <p id={`hint-${draft.documentId}`} className="text-xs text-danger">
                          Below 90% confidence — confirm this field before saving.
                        </p>
                      )}
                    </div>

                    <div className="mt-3 space-y-1.5">
                      <Label htmlFor={`assign-${draft.documentId}`}>Assign to</Label>
                      <Select
                        id={`assign-${draft.documentId}`}
                        value={draft.assignTo}
                        onChange={(event) => updateDraft(draft.documentId, { assignTo: event.target.value })}
                      >
                        <option value="create">＋ Create new horse</option>
                        {(horses ?? []).map((horse) => (
                          <option key={horse.id} value={horse.id}>{horse.name}</option>
                        ))}
                      </Select>
                    </div>

                    <dl className="mt-3 space-y-1 border-t border-steel/30 pt-2">
                      {draft.extracted.map((field) => (
                        <div key={field.field} className="flex justify-between gap-2 text-xs">
                          <dt className="text-steel-muted">{field.field}</dt>
                          <dd className={cn('font-medium', field.confidence < 0.9 ? 'text-danger' : 'text-ink-graphite')}>
                            {field.value || '—'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </motion.li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between border-t border-metal pt-4">
              <Button variant="ghost" className="text-steel-muted hover:text-surface" onClick={reset} disabled={phase === 'saving'}>
                Discard batch
              </Button>
              <Button
                onClick={saveAll}
                disabled={phase === 'saving' || drafts.some((draft) => !draft.editedHorseName.trim())}
                title={drafts.some((draft) => !draft.editedHorseName.trim()) ? 'Every document needs a horse name before saving.' : undefined}
              >
                {phase === 'saving' ? 'Saving…' : `Save all (${drafts.length})`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
