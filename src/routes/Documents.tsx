import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { EmptyState } from '@/components/EmptyState';
import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { formatDateTimeLabel } from '@/lib/format';
import { buildDocumentTrustProfile } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { DocumentRecord, DocumentSource } from '@/types/xbar';

const sources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Shared Upload', 'Sales Packet'];

export default function Documents() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);
  const intakeBatches = useXbarStore((state) => state.intakeBatches);
  const subscription = useXbarStore((state) => state.subscription);
  const createDocumentIntake = useXbarStore((state) => state.createDocumentIntake);
  const reviewDocument = useXbarStore((state) => state.reviewDocument);
  const discardDocument = useXbarStore((state) => state.discardDocument);
  const pushToast = useUiStore((state) => state.pushToast);

  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<DocumentSource>('Bulk Intake');
  const [horseId, setHorseId] = useState('');
  const [uploadedBy, setUploadedBy] = useState('Ops Desk');
  const [batchLabel, setBatchLabel] = useState('Live intake batch');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{ uploadedBy?: string; files?: string }>({});
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});
  const [menuState, setMenuState] = useState<{ documentId: string; x: number; y: number } | null>(null);
  const [openingDocumentId, setOpeningDocumentId] = useState('');

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');
  const buyerSafeDocuments = documents.filter((document) => buildDocumentTrustProfile(document, horses).readyForProfile);
  const uploadOpen = searchParams.get('upload') === '1';
  const menuDocument = documents.find((document) => document.id === menuState?.documentId);
  const menuHorseId = menuDocument ? reviewAssignments[menuDocument.id] ?? menuDocument.horseId : undefined;
  const openDocument = async (document: Pick<DocumentRecord, 'id' | 'title' | 'fileUrl' | 'storagePath'>) => {
    const previewWindow = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (previewWindow) {
      previewWindow.opener = null;
    }

    setOpeningDocumentId(document.id);
    const access = await getDocumentAccessUrl(document);
    setOpeningDocumentId('');

    if (!access.ok) {
      previewWindow?.close();
      pushToast({
        title: 'File unavailable',
        message: access.message,
        tone: 'error',
      });
      return;
    }

    if (previewWindow) {
      previewWindow.location.href = access.url;
      previewWindow.focus();
      return;
    }

    window.open(access.url, '_blank', 'noopener,noreferrer');
  };
  const menuItems = menuDocument
    ? [
        ...(menuDocument.fileUrl || menuDocument.storagePath
          ? [
              {
                id: 'open-file',
                label: 'Open file',
                onSelect: () => {
                  void openDocument(menuDocument);
                },
              },
            ]
          : []),
        {
          id: 'approve',
          label: 'Approve document',
          onSelect: () => {
            const result = reviewDocument(menuDocument.id, menuHorseId);
            pushToast({
              title: result.ok ? 'Document approved' : 'Approval blocked',
              message: result.message,
              tone: result.ok ? 'success' : 'error',
            });
          },
        },
        {
          id: 'discard',
          label: 'Discard document',
          onSelect: () => {
            const result = discardDocument(menuDocument.id);
            pushToast({
              title: result.ok ? 'Document discarded' : 'Discard blocked',
              message: result.message,
              tone: result.ok ? 'warning' : 'error',
            });
          },
          tone: 'danger' as const,
        },
        ...(menuHorseId
          ? [
              {
                id: 'open-horse',
                label: 'Open horse profile',
                onSelect: () => navigate(`/horses/${menuHorseId}`),
              },
            ]
          : []),
      ]
    : [];

  const handleIntake = async () => {
    const nextErrors: { uploadedBy?: string; files?: string } = {};
    if (!uploadedBy.trim()) {
      nextErrors.uploadedBy = 'Uploaded by is required.';
    }
    if (!files.length) {
      nextErrors.files = 'Select at least one file.';
    }

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      return;
    }

    setIsSubmitting(true);
    const result = await createDocumentIntake({
      files,
      horseId: horseId || undefined,
      source,
      uploadedBy,
      label: batchLabel,
    });

    pushToast({
      title: result.ok ? 'Document intake updated' : 'Document intake blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setFiles([]);
      setBatchLabel('Live intake batch');
      setSearchParams({});
    }
    setIsSubmitting(false);
  };

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Document intake and review"
        description="Intake, assignment, records."
      />

      <div className="callout">
        <strong>Manual review:</strong> New uploads are assigned during intake review. No automatic extraction is running.
      </div>

      <div className="metric-grid">
        <MetricCard label="Document vault" value={`${documents.length}`} detail="Registration, medical, transfer, insurance, and media records" />
        <MetricCard label="Needs review" value={`${reviewQueue.length}`} detail="Files waiting on manual assignment" tone="amber" />
        <MetricCard label="Buyer-safe docs" value={`${buyerSafeDocuments.length}`} detail="Approved documents strong enough for buyer-facing packet surfaces" tone="emerald" />
        <MetricCard label="Storage used" value={`${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB`} detail="Workspace file storage against the current contract" tone="blue" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          eyebrow="Live intake"
          title="Upload files"
          description="Add files and review them manually."
          action={
            <Pill tone={uploadOpen ? 'blue' : 'slate'}>
              {uploadOpen ? 'Top-bar launch' : `${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB used`}
            </Pill>
          }
        >
          <div className="form-grid">
            <label className="field-stack">
              <span className="field-label">Batch label</span>
              <input className="field-input" value={batchLabel} onChange={(event) => setBatchLabel(event.target.value)} />
            </label>
            <label className="field-stack">
              <span className="field-label">Source</span>
              <select className="field-input" value={source} onChange={(event) => setSource(event.target.value as DocumentSource)}>
                {sources.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Uploaded by</span>
              <input className="field-input" value={uploadedBy} onChange={(event) => {
                setUploadedBy(event.target.value);
                setFormErrors((current) => ({ ...current, uploadedBy: undefined }));
              }} />
              {formErrors.uploadedBy ? <span className="field-error">{formErrors.uploadedBy}</span> : null}
            </label>
            <label className="field-stack">
              <span className="field-label">Attach to horse</span>
              <select className="field-input" value={horseId} onChange={(event) => setHorseId(event.target.value)}>
                <option value="">Try local file-name match</option>
                {horses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Files</span>
              <input
                className="field-input field-input--file"
                type="file"
                multiple
                accept=".pdf,.txt,.csv,image/*"
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                  setFormErrors((current) => ({ ...current, files: undefined }));
                }}
              />
              {formErrors.files ? <span className="field-error">{formErrors.files}</span> : null}
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary" type="button" onClick={handleIntake} disabled={isSubmitting || !uploadedBy.trim() || !files.length}>
              {isSubmitting ? 'Adding documents...' : 'Add documents'}
            </button>
            <div className="detail-block subtle">
              {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected for intake.` : 'Choose files to add to the queue.'}
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Batch intake" title="Queue states" description="Recent intake activity.">
          {intakeBatches.length ? (
            <div className="stack-list">
              {intakeBatches.map((batch) => (
                <div key={batch.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{batch.label}</div>
                      <div className="stack-item__copy">
                        {batch.fileCount} files · {batch.source} · {formatDateTimeLabel(batch.receivedAt)}
                      </div>
                    </div>
                    <Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>
                      {batch.state}
                    </Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{batch.processedCount}/{batch.fileCount} logged</span>
                    <span>{batch.matchedCount} matched</span>
                    <span>{batch.needsReviewCount} waiting on review</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No intake batches yet"
              description="Upload a batch to start the queue."
            />
          )}
        </Panel>
      </div>

      <Panel eyebrow="Review workbench" title="Confidence and match review" description="Approve and assign.">
        {reviewQueue.length ? (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Current horse</th>
                  <th>Status</th>
                  <th>Assign horse</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reviewQueue.map((document) => {
                  const trust = buildDocumentTrustProfile(document, horses);
                  const selectedHorse = horses.find((horse) => horse.id === (reviewAssignments[document.id] ?? document.horseId));
                  return (
                    <tr
                      key={document.id}
                      className="table-row--interactive"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenuState({ documentId: document.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      <td>
                        <div className="table-cell__stack">
                          <strong>{document.title}</strong>
                          <span>{document.type}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell__stack">
                          <span>{selectedHorse?.name ?? document.entities.horseName ?? 'Unassigned'}</span>
                          <span>{document.source}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell__stack">
                          <Pill tone={document.state === 'Ready' ? 'emerald' : document.state === 'Matched' ? 'blue' : trust.tone}>{document.state}</Pill>
                          <span>{document.duplicateRisk === 'Possible Duplicate' ? 'Duplicate review needed' : 'Manual assignment required'}</span>
                        </div>
                      </td>
                      <td>
                        <select
                          className="field-input field-input--compact"
                          value={reviewAssignments[document.id] ?? document.horseId ?? ''}
                          onChange={(event) =>
                            setReviewAssignments((current) => ({
                              ...current,
                              [document.id]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Select horse</option>
                          {horses.map((horse) => (
                            <option key={horse.id} value={horse.id}>
                              {horse.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <div className="inline-actions inline-actions--card">
                          {document.fileUrl || document.storagePath ? (
                            <button
                              className="button button--ghost button--compact"
                              type="button"
                              onClick={() => void openDocument(document)}
                              disabled={openingDocumentId === document.id}
                            >
                              {openingDocumentId === document.id ? 'Opening...' : 'Open file'}
                            </button>
                          ) : null}
                          <button
                            className="button button--ghost button--compact"
                            type="button"
                            onClick={() => {
                              const result = reviewDocument(document.id, reviewAssignments[document.id] ?? document.horseId);
                              pushToast({
                                title: result.ok ? 'Document approved' : 'Approval blocked',
                                message: result.message,
                                tone: result.ok ? 'success' : 'error',
                              });
                            }}
                          >
                            Approve
                          </button>
                          <button
                            className="button button--ghost button--compact"
                            type="button"
                            onClick={() => {
                              const result = discardDocument(document.id);
                              pushToast({
                                title: result.ok ? 'Document discarded' : 'Discard blocked',
                                message: result.message,
                                tone: result.ok ? 'warning' : 'error',
                              });
                            }}
                          >
                            Discard
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="Review queue is clear"
            description="Nothing is waiting on review."
          />
        )}
      </Panel>

      {duplicates.length ? (
        <Panel eyebrow="Duplicates" title="Potential duplicate uploads">
          <div className="stack-list">
            {duplicates.map((document) => {
              const trust = buildDocumentTrustProfile(document, horses);
              return (
                <div key={document.id} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{document.title}</div>
                    <Pill tone="rose">{document.duplicateRisk}</Pill>
                  </div>
                  <div className="stack-item__copy">{trust.duplicateSummary}</div>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <ContextMenu open={Boolean(menuDocument)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
