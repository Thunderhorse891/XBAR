import './documentDossier.css';
import { useState } from 'react';
import { Panel, Pill } from '@/components/app-ui';
import { EmptyState } from '@/components/EmptyState';
import { hasStoredFile, storedFileLabel } from '@/lib/storedFiles';
import type { DocumentRecord, HorseRecord } from '@/types/xbar';

/** Browsing only: recovery mutations await an authoritative cloud lifecycle guard. */
export function DocumentLibrary({
  documents,
  horses,
  openingDocumentId,
  onOpen,
  onDownload,
  onReview,
  canReview = true,
}: {
  canReview?: boolean;
  documents: DocumentRecord[];
  horses: HorseRecord[];
  openingDocumentId: string;
  onOpen: (document: DocumentRecord) => void;
  onDownload?: (document: DocumentRecord) => void;
  onReview: (document: DocumentRecord) => void;
}) {
  const [archived, setArchived] = useState(false);
  const activeCount = documents.filter((document) => document.state !== 'Archived').length;
  const visible = documents.filter((document) => (document.state === 'Archived') === archived);
  return (
    <Panel title="Document library" description="View current and archived originals.">
      <div className="inline-actions" role="group" aria-label="Document library filter">
        <button
          className={`button button--${archived ? 'ghost' : 'primary'} button--compact`}
          aria-pressed={!archived}
          onClick={() => setArchived(false)}
        >
          Active ({activeCount})
        </button>
        <button
          className={`button button--${archived ? 'primary' : 'ghost'} button--compact`}
          aria-pressed={archived}
          onClick={() => setArchived(true)}
        >
          Archived ({documents.length - activeCount})
        </button>
      </div>
      {archived ? (
        <p className="stack-item__copy">
          Archived originals stay here. Restore and move controls aren’t available yet.
        </p>
      ) : null}
      {visible.length ? (
        <div className="document-file-grid" aria-label="Original documents">
          {visible.map((document) => (
            <article
              className="document-file-card"
              role="group"
              key={document.id}
              aria-label={`${document.title} library actions`}
            >
              <div className="document-file-cover" aria-label={`${document.type} file summary`}>
                <span>ORIGINAL DOCUMENT</span>
                <strong>{document.type}</strong>
                <small>
                  <span>{document.mimeType?.split('/')[1]?.toUpperCase() ?? 'FILE'}</span> ·{' '}
                  <span>{storedFileLabel(document)}</span>
                </small>
              </div>
              <div className="document-file-body">
                <h3>{document.title}</h3>
                <div className="document-file-meta">
                  <span>{horses.find((horse) => horse.id === document.horseId)?.name ?? 'Unassigned'}</span>
                  <span>{document.fileName || 'Original filename unavailable'}</span>
                  <Pill tone={document.state === 'Needs Review' || document.state === 'Matched' ? 'amber' : 'slate'}>
                    {document.state === 'Queued' ? 'Reading file' : document.state}
                  </Pill>
                </div>
                <div className="document-file-actions">
                  {hasStoredFile(document) ? (
                    <button
                      className="button button--primary button--compact"
                      disabled={Boolean(openingDocumentId)}
                      aria-busy={openingDocumentId === document.id}
                      onClick={() => onOpen(document)}
                    >
                      {openingDocumentId === document.id ? 'Opening...' : 'Open file'}
                    </button>
                  ) : (
                    <span>No original file attached</span>
                  )}
                  {onDownload && hasStoredFile(document) ? (
                    <button
                      className="button button--ghost button--compact"
                      disabled={Boolean(openingDocumentId)}
                      onClick={() => onDownload(document)}
                    >
                      Download original
                    </button>
                  ) : null}
                  {!archived && canReview ? (
                    <button className="button button--ghost button--compact" onClick={() => onReview(document)}>
                      Review
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title={archived ? 'No archived documents' : 'No active documents'}
          description={
            archived
              ? 'Documents removed from review appear here.'
              : 'Upload a file, or check Archived for retained originals.'
          }
        />
      )}
    </Panel>
  );
}
