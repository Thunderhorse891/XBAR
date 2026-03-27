import { useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { EmptyState } from '@/components/EmptyState';
import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { formatDateTimeLabel } from '@/lib/format';
import { buildDocumentTrustProfile } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
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
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');
  const canReviewDocuments = useCurrentRoleCapability('reviewDocuments');

  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<DocumentSource>('Bulk Intake');
  const [horseId, setHorseId] = useState('');
  const [uploadedBy, setUploadedBy] = useState('Ops Desk');
  const [batchLabel, setBatchLabel] = useState('Live intake batch');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{ uploadedBy?: string; files?: string }>({});
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});
  const [menuState, setMenuState] = useState<
    | { type: 'document'; documentId: string; x: number; y: number }
    | { type: 'surface'; surfaceId: 'vault' | 'review' | 'buyer' | 'storage' | 'intake' | 'batches' | 'duplicates'; x: number; y: number }
    | null
  >(null);
  const [openingDocumentId, setOpeningDocumentId] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');
  const buyerSafeDocuments = documents.filter((document) => buildDocumentTrustProfile(document, horses).readyForProfile);
  const uploadOpen = searchParams.get('upload') === '1';
  const menuDocument = menuState?.type === 'document' ? documents.find((document) => document.id === menuState.documentId) : undefined;
  const menuHorseId = menuDocument ? reviewAssignments[menuDocument.id] ?? menuDocument.horseId : undefined;
  const accessModeLabel =
    canUploadDocuments && !canReviewDocuments
      ? 'Upload only'
      : !canUploadDocuments && canReviewDocuments
        ? 'Review only'
        : !canUploadDocuments && !canReviewDocuments
          ? 'Read only'
          : 'Full access';
  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const openSurfaceMenu = (
    surfaceId: 'vault' | 'review' | 'buyer' | 'storage' | 'intake' | 'batches' | 'duplicates',
    event: MouseEvent,
  ) => {
    event.preventDefault();
    setMenuState({ type: 'surface', surfaceId, x: event.clientX, y: event.clientY });
  };
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
  const menuItems =
    menuDocument
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
        ...(canReviewDocuments
          ? [
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
            ]
          : []),
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
    : menuState?.type === 'surface'
      ? [
          ...(menuState.surfaceId === 'vault'
            ? [
                {
                  id: 'jump-intake',
                  label: 'Jump to intake',
                  onSelect: () => scrollToSection('documents-intake'),
                },
                {
                  id: 'jump-review',
                  label: 'Jump to review',
                  onSelect: () => scrollToSection('documents-review'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'review'
            ? [
                {
                  id: 'focus-review',
                  label: 'Focus queue',
                  onSelect: () => scrollToSection('documents-review'),
                },
                ...(reviewQueue[0] && (reviewQueue[0].fileUrl || reviewQueue[0].storagePath)
                  ? [
                      {
                        id: 'open-next',
                        label: 'Open next file',
                        onSelect: () => {
                          void openDocument(reviewQueue[0]);
                        },
                      },
                    ]
                  : []),
              ]
            : []),
          ...(menuState.surfaceId === 'buyer'
            ? [
                {
                  id: 'open-shared',
                  label: 'Open shared access',
                  onSelect: () => navigate('/shared-access'),
                },
                {
                  id: 'focus-review-buyer',
                  label: 'Jump to review',
                  onSelect: () => scrollToSection('documents-review'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'storage'
            ? [
                {
                  id: 'open-subscriptions',
                  label: 'Open subscriptions',
                  onSelect: () => navigate('/subscriptions'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'intake'
            ? [
                ...(canUploadDocuments
                  ? [
                      {
                        id: 'choose-files',
                        label: 'Choose files',
                        onSelect: () => fileInputRef.current?.click(),
                      },
                    ]
                  : []),
                {
                  id: 'focus-intake',
                  label: 'Focus intake',
                  onSelect: () => scrollToSection('documents-intake'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'batches'
            ? [
                {
                  id: 'focus-batches',
                  label: 'Focus batches',
                  onSelect: () => scrollToSection('documents-batches'),
                },
                {
                  id: 'focus-review-from-batches',
                  label: 'Jump to review',
                  onSelect: () => scrollToSection('documents-review'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'duplicates'
            ? [
                {
                  id: 'focus-duplicates',
                  label: 'Focus duplicates',
                  onSelect: () => scrollToSection('documents-duplicates'),
                },
                {
                  id: 'focus-review-from-duplicates',
                  label: 'Jump to review',
                  onSelect: () => scrollToSection('documents-review'),
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
        title="Document Desk"
        actions={
          <div className="flex flex-wrap gap-2">
            <Pill tone="slate">Manual queue</Pill>
            <Pill tone="blue">{accessModeLabel}</Pill>
          </div>
        }
      />

      <div className="metric-grid">
        <MetricCard
          label="Vault"
          value={`${documents.length}`}
          tone="slate"
          title="Registration, medical, transfer, insurance, and media records"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#0f1724]/10 hover:bg-[#fbfcfd]"
          onClick={() => scrollToSection('documents-review')}
          onContextMenu={(event) => openSurfaceMenu('vault', event)}
        />
        <MetricCard
          label="Review"
          value={`${reviewQueue.length}`}
          tone="slate"
          title="Files waiting on manual assignment"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#0f1724]/10 hover:bg-[#fbfcfd]"
          onClick={() => scrollToSection('documents-review')}
          onContextMenu={(event) => openSurfaceMenu('review', event)}
        />
        <MetricCard
          label="Buyer-safe"
          value={`${buyerSafeDocuments.length}`}
          tone="emerald"
          title="Approved documents cleared for buyer-facing packet surfaces"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#0f1724]/10 hover:bg-[#fbfcfd]"
          onClick={() => navigate('/shared-access')}
          onContextMenu={(event) => openSurfaceMenu('buyer', event)}
        />
        <MetricCard
          label="Storage"
          value={`${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB`}
          tone="slate"
          title="Workspace file storage against the current contract"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#0f1724]/10 hover:bg-[#fbfcfd]"
          onClick={() => navigate('/subscriptions')}
          onContextMenu={(event) => openSurfaceMenu('storage', event)}
        />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          eyebrow="Intake"
          title="Add files"
          action={
            <Pill tone={uploadOpen ? 'blue' : 'slate'}>
              {uploadOpen ? 'Top-bar launch' : `${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB used`}
            </Pill>
          }
          className="cursor-context-menu"
          onContextMenu={(event) => openSurfaceMenu('intake', event)}
        >
          <div id="documents-intake" className="form-grid">
            <label className="field-stack">
              <span className="field-label">Batch label</span>
              <input className="field-input" value={batchLabel} onChange={(event) => setBatchLabel(event.target.value)} disabled={!canUploadDocuments} />
            </label>
            <label className="field-stack">
              <span className="field-label">Source</span>
              <select className="field-input" value={source} onChange={(event) => setSource(event.target.value as DocumentSource)} disabled={!canUploadDocuments}>
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
              }} disabled={!canUploadDocuments} />
              {formErrors.uploadedBy ? <span className="field-error">{formErrors.uploadedBy}</span> : null}
            </label>
            <label className="field-stack">
              <span className="field-label">Attach to horse</span>
              <select className="field-input" value={horseId} onChange={(event) => setHorseId(event.target.value)} disabled={!canUploadDocuments}>
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
                ref={fileInputRef}
                className="field-input field-input--file"
                type="file"
                multiple
                accept=".pdf,.txt,.csv,image/*"
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                  setFormErrors((current) => ({ ...current, files: undefined }));
                }}
                disabled={!canUploadDocuments}
              />
              {formErrors.files ? <span className="field-error">{formErrors.files}</span> : null}
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary" type="button" onClick={handleIntake} disabled={!canUploadDocuments || isSubmitting || !uploadedBy.trim() || !files.length}>
              {isSubmitting ? 'Adding documents...' : 'Add documents'}
            </button>
            <Pill tone={files.length ? 'blue' : 'slate'}>{files.length ? `${files.length} queued` : 'No files'}</Pill>
          </div>
        </Panel>

        <Panel eyebrow="Batches" title="Queue states" className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('batches', event)}>
          {intakeBatches.length ? (
            <div id="documents-batches" className="stack-list">
              {intakeBatches.map((batch) => (
                <div key={batch.id} className="stack-item" onContextMenu={(event) => openSurfaceMenu('batches', event)}>
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

      <Panel eyebrow="Review" title="Queue" className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('review', event)}>
        {reviewQueue.length ? (
          <div id="documents-review" className="table-shell">
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
                        setMenuState({ type: 'document', documentId: document.id, x: event.clientX, y: event.clientY });
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
                          disabled={!canReviewDocuments}
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
                            disabled={!canReviewDocuments}
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
                            disabled={!canReviewDocuments}
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
        <Panel eyebrow="Duplicates" title="Review flags" className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('duplicates', event)}>
          <div id="documents-duplicates" className="stack-list">
            {duplicates.map((document) => {
              const trust = buildDocumentTrustProfile(document, horses);
              return (
                <div key={document.id} className="stack-item" onContextMenu={(event) => openSurfaceMenu('duplicates', event)}>
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

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
