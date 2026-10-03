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
  onReview,
}: {
  documents: DocumentRecord[];
  horses: HorseRecord[];
  openingDocumentId: string;
  onOpen: (document: DocumentRecord) => void;
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
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Horse</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((document) => (
                <tr key={document.id} aria-label={`${document.title} library actions`}>
                  <td>
                    {document.title}
                    <div className="stack-item__copy">{storedFileLabel(document)}</div>
                  </td>
                  <td>{horses.find((horse) => horse.id === document.horseId)?.name ?? 'Unassigned'}</td>
                  <td>
                    <Pill tone="slate">{document.state}</Pill>
                  </td>
                  <td>
                    <div className="inline-actions inline-actions--card">
                      {hasStoredFile(document) ? (
                        <button
                          className="button button--ghost button--compact"
                          disabled={openingDocumentId === document.id}
                          onClick={() => onOpen(document)}
                        >
                          {openingDocumentId === document.id ? 'Opening...' : 'Open file'}
                        </button>
                      ) : (
                        <span>No original file attached</span>
                      )}
                      {!archived ? (
                        <button className="button button--ghost button--compact" onClick={() => onReview(document)}>
                          Review
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
