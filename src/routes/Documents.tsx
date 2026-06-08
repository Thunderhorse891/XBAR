import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useConfirm } from '@/components/ConfirmDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { MetricCard, Panel, Pill, SurfaceTabs } from '@/components/app-ui';
import { EmptyState } from '@/components/EmptyState';
import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { formatDateTimeLabel } from '@/lib/format';
import { buildDocumentTrustProfile } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useCloudStore } from '@/store/useCloudStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { DocumentRecord, DocumentSource } from '@/types/xbar';
import { documentSources } from '@/features/documents/constants';
import type { DocumentsView } from '@/features/documents/types';

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
  const addHorse = useXbarStore((state) => state.addHorse);
  const pushToast = useUiStore((state) => state.pushToast);
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');
  const canReviewDocuments = useCurrentRoleCapability('reviewDocuments');
  const { confirm, dialog: confirmDialog } = useConfirm();
  const session = useCloudStore((state) => state.session);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || workspaceProfile.ranchManagerName || workspaceProfile.defaultOwnerName || 'Ranch Staff';

  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<DocumentSource>('Bulk Intake');
  const [horseId, setHorseId] = useState('');
  const [uploadedBy, setUploadedBy] = useState(currentUserName);
  const [batchLabel, setBatchLabel] = useState('Live upload batch');
  const [createHorseFromBatch, setCreateHorseFromBatch] = useState(false);
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
  const [activeView, setActiveView] = useState<DocumentsView>(uploadOpen ? 'Upload' : 'Review');
  const menuDocument = menuState?.type === 'document' ? documents.find((document) => document.id === menuState.documentId) : undefined;
  const menuHorseId = menuDocument ? reviewAssignments[menuDocument.id] ?? menuDocument.horseId : undefined;

  useEffect(() => {
    if (uploadOpen) {
      setActiveView('Upload');
    }
  }, [uploadOpen]);
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
                onSelect: async () => {
                  if (!await confirm('Discard document', `Discard "${menuDocument.title}"? This marks the document as discarded and removes it from the active vault.`)) return;
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
                  id: 'jump-upload',
                  label: 'Jump to upload',
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
                  id: 'focus-upload',
                  label: 'Focus upload',
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
      createHorseFromBatch,
    });

    pushToast({
      title: result.ok ? 'Document upload updated' : 'Document upload blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setFiles([]);
      setBatchLabel('Live upload batch');
      setCreateHorseFromBatch(false);
      setSearchParams({});
    }
    setIsSubmitting(false);
  };

  return (
    <>
      {confirmDialog}
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Document Vault</span>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Total files</span><strong>{documents.length}</strong></div>
            <div className="surface-hero__stat">
              <span>Review queue</span>
              <strong className={reviewQueue.length ? 'text-amber' : 'text-emerald'}>{reviewQueue.length}</strong>
            </div>
            <div className="surface-hero__stat"><span>Ready to share</span><strong className="text-emerald">{buyerSafeDocuments.length}</strong></div>
            <div className="surface-hero__stat">
              <span>Duplicates</span>
              <strong className={duplicates.length ? 'text-amber' : 'text-emerald'}>{duplicates.length}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard
          label="Vault"
          value={`${documents.length}`}
          tone="slate"
          title="Registration, medical, transfer, insurance, and media records"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#3D6B4F]/12 hover:bg-[#faf5ee]"
          onClick={() => scrollToSection('documents-review')}
          onContextMenu={(event) => openSurfaceMenu('vault', event)}
        />
        <MetricCard
          label="Queue"
          value={`${reviewQueue.length}`}
          tone="slate"
          title="Files waiting on manual assignment"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#3D6B4F]/12 hover:bg-[#faf5ee]"
          onClick={() => scrollToSection('documents-review')}
          onContextMenu={(event) => openSurfaceMenu('review', event)}
        />
        <MetricCard
          label="Ready docs"
          value={`${buyerSafeDocuments.length}`}
          tone="emerald"
          title="Approved documents cleared for sale packet surfaces"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#3D6B4F]/12 hover:bg-[#faf5ee]"
          href="/shared-access"
          onContextMenu={(event) => openSurfaceMenu('buyer', event)}
        />
        <MetricCard
          label="Storage"
          value={`${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB`}
          tone="slate"
          title="Ranch file storage against the current contract"
          className="cursor-pointer transition-all duration-150 ease-[ease] hover:border-[#3D6B4F]/12 hover:bg-[#faf5ee]"
          href="/subscriptions"
          onContextMenu={(event) => openSurfaceMenu('storage', event)}
        />
      </div>

      <section className="surface-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SurfaceTabs
            items={['Review', 'Upload', 'Batches', 'Flags']}
            active={activeView}
            onChange={(view) => setActiveView(view as DocumentsView)}
          />
          <div className="flex flex-wrap gap-2">
            <Pill tone="slate">{reviewQueue.length} review</Pill>
            <Pill tone="blue">{intakeBatches.length} uploads</Pill>
            <Pill tone="emerald">{buyerSafeDocuments.length} clear</Pill>
          </div>
        </div>
      </section>

      {activeView === 'Upload' ? (
      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          title="Upload"
          action={
            <Pill tone={uploadOpen ? 'blue' : 'slate'}>{uploadOpen ? 'Top-bar launch' : `${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB used`}</Pill>
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
                {documentSources.map((item) => (
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
              <select
                className="field-input"
                value={horseId}
                onChange={(event) => {
                  const nextHorseId = event.target.value;
                  setHorseId(nextHorseId);
                  if (nextHorseId) {
                    setCreateHorseFromBatch(false);
                  }
                }}
                disabled={!canUploadDocuments}
              >
                <option value="">Try local file-name match</option>
                {horses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <button
                type="button"
                    className={`button button--ghost button--compact justify-start ${createHorseFromBatch ? 'border-[#3D6B4F] bg-[#EDF4EE] text-[#3D6B4F]' : ''}`}
                onClick={() => setCreateHorseFromBatch((current) => !current)}
                disabled={!canUploadDocuments || Boolean(horseId)}
              >
                {createHorseFromBatch ? 'Create from docs' : 'Review only'}
              </button>
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Files</span>
              <input
                ref={fileInputRef}
                className="field-input field-input--file"
                type="file"
                multiple
                accept=".pdf,.txt,.csv,image/*"
                aria-describedby={formErrors.files ? 'docs-files-error' : undefined}
                onChange={(event) => {
                  setFiles(Array.from(event.target.files ?? []));
                  setFormErrors((current) => ({ ...current, files: undefined }));
                }}
                disabled={!canUploadDocuments}
              />
              {formErrors.files ? <span id="docs-files-error" className="field-error" role="alert">{formErrors.files}</span> : null}
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary" type="button" onClick={handleIntake} disabled={!canUploadDocuments || isSubmitting || !uploadedBy.trim() || !files.length}>
              {isSubmitting ? 'Adding...' : 'Add docs'}
            </button>
            <Pill tone={files.length ? 'blue' : 'slate'}>{files.length ? `${files.length} queued` : 'No files'}</Pill>
          </div>
        </Panel>

      </div>
      ) : null}

      {activeView === 'Review' ? (
      <Panel title="Review" className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('review', event)}>
        {reviewQueue.length ? (
          <div id="documents-review" className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Document</th>
                  <th scope="col">Current horse</th>
                  <th scope="col">Status</th>
                  <th scope="col">Assign horse</th>
                  <th scope="col">Action</th>
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
                          <span>{document.duplicateRisk === 'Possible Duplicate' ? 'Duplicate check' : 'Manual match'}</span>
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
                          {document.type === 'Registration' && !document.horseId && !reviewAssignments[document.id] && (document.entities.horseName || document.entities.registrationNumber) && (
                            <button
                              className="button button--primary button--compact"
                              type="button"
                              disabled={!canReviewDocuments}
                              title="Create a horse record from the registration data extracted from this document"
                              onClick={() => {
                                const entities = document.entities;
                                const horseName = (entities.horseName ?? entities.registrationNumber ?? 'New Horse').trim().toUpperCase();
                                const result = addHorse({
                                  name: horseName,
                                  barnName: horseName.split(' ').slice(0, 2).join(' '),
                                  segment: 'Sale Prospect',
                                  status: 'Sale Prep',
                                  sex: (entities.sex as import('@/types/xbar').HorseSex | undefined) ?? 'Mare',
                                  owner: entities.ownerName ?? (workspaceProfile.defaultOwnerName || 'Pending Owner'),
                                  ownerEntity: workspaceProfile.defaultOwnerEntity || workspaceProfile.businessName || '',
                                  aqhaNumber: entities.registrationNumber ?? '',
                                  registrationNumber: entities.registrationNumber ?? '',
                                  barn: workspaceProfile.defaultBarn || 'Main Barn',
                                  pasture: workspaceProfile.defaultPasture || 'Pending Pasture',
                                  breed: entities.breed,
                                  color: entities.color,
                                  foaledOn: entities.foaledOn,
                                  sire: entities.sire,
                                  dam: entities.dam,
                                });
                                if (result.ok && result.id) {
                                  reviewDocument(document.id, result.id);
                                  pushToast({ title: 'Horse created', message: `${horseName} added from registration certificate.`, tone: 'success' });
                                } else {
                                  pushToast({ title: 'Creation blocked', message: result.message, tone: 'error' });
                                }
                              }}
                            >
                              Create horse
                            </button>
                          )}
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
                            onClick={async () => {
                              if (!await confirm('Discard document', `Discard "${document.title}"? This marks the document as discarded and removes it from the active vault.`)) return;
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
            description="Nothing is waiting."
          />
        )}
      </Panel>
      ) : null}

      {activeView === 'Flags' ? (
        <Panel title="Flags" className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('duplicates', event)}>
          {duplicates.length ? (
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
          ) : (
            <EmptyState compact title="No review flags" description="Duplicate flags land here." />
          )}
        </Panel>
      ) : null}

      {activeView === 'Batches' ? (
        <Panel title="Batches" className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('batches', event)}>
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
                    <span>{batch.needsReviewCount} waiting</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No document uploads" description="Upload files to start the queue." />
          )}
        </Panel>
      ) : null}

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
