import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CommandBrief } from '@/components/CommandBrief';
import { ContextMenu } from '@/components/ContextMenu';
import { Panel, Pill } from '@/components/app-ui';
import { EmptyState } from '@/components/EmptyState';
import { SalePacketWizard } from '@/components/SalePacketWizard';
import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { formatDateTimeLabel } from '@/lib/format';
import { downloadLegalHtml, legalDocuments, openPrintableLegalDocument } from '@/lib/legalDocuments';
import { buildDocumentTrustProfile } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useCloudStore } from '@/store/useCloudStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { normalizeOwnershipRecord } from '@/store/xbarStoreLogic';
import type { DocumentRecord, DocumentSource } from '@/types/xbar';
import { documentSources } from '@/features/documents/constants';

const SHARED_ACCESS_PATH = '/shared-access';
const STALE_REVIEW_MS = 3 * 24 * 60 * 60 * 1000;

type PipelineStage = 'Upload' | 'Processing' | 'Review' | 'Proof' | 'Share';

const PIPELINE_STAGES: { id: PipelineStage; label: string; hint: string }[] = [
  { id: 'Upload', label: 'Upload', hint: 'Bring files in: choose documents, tag a source, and optionally attach a horse.' },
  { id: 'Processing', label: 'OCR / Processing', hint: 'OCR runs locally; extracted fields appear here while files are queued.' },
  { id: 'Review', label: 'Review', hint: 'Confirm the extracted match, assign the right horse, then approve or discard.' },
  { id: 'Proof', label: 'Proof', hint: 'Use approved documents as ownership proof on the horse’s proof chain.' },
  { id: 'Share', label: 'Share', hint: 'Bundle approved documents into watermarked sale packets and hand off to Shared Access.' },
];

type SurfaceId = 'review' | 'buyer' | 'intake' | 'batches' | 'duplicates' | 'processing' | 'proof';

export default function Documents() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);
  const intakeBatches = useXbarStore((state) => state.intakeBatches);
  const subscription = useXbarStore((state) => state.subscription);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const salePacketBuilds = useXbarStore((state) => state.salePacketBuilds);
  const createDocumentIntake = useXbarStore((state) => state.createDocumentIntake);
  const reviewDocument = useXbarStore((state) => state.reviewDocument);
  const discardDocument = useXbarStore((state) => state.discardDocument);
  const ensureOwnershipRecord = useXbarStore((state) => state.ensureOwnershipRecord);
  const linkOwnershipProof = useXbarStore((state) => state.linkOwnershipProof);
  const updateHorse = useXbarStore((state) => state.updateHorse);
  const recordAuditEvent = useXbarStore((state) => state.recordAuditEvent);
  const pushToast = useUiStore((state) => state.pushToast);
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');
  const canReviewDocuments = useCurrentRoleCapability('reviewDocuments');
  const session = useCloudStore((state) => state.session);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || workspaceProfile.ranchManagerName || workspaceProfile.defaultOwnerName || 'Ranch Staff';

  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<DocumentSource>('Bulk Intake');
  const [horseId, setHorseId] = useState('');
  const [uploadedBy, setUploadedBy] = useState(currentUserName);
  const [batchLabel, setBatchLabel] = useState('Live upload batch');
  const [packetBuildingHorseId, setPacketBuildingHorseId] = useState('');
  const [createHorseFromBatch, setCreateHorseFromBatch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{ uploadedBy?: string; files?: string }>({});
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});
  const [proofSelections, setProofSelections] = useState<Record<string, string>>({});
  const [menuState, setMenuState] = useState<
    | { type: 'document'; documentId: string; x: number; y: number }
    | { type: 'surface'; surfaceId: SurfaceId; x: number; y: number }
    | null
  >(null);
  const [openingDocumentId, setOpeningDocumentId] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const uploadOpen = searchParams.get('upload') === '1';
  const [activeStage, setActiveStage] = useState<PipelineStage>(uploadOpen ? 'Upload' : 'Review');

  useEffect(() => {
    if (uploadOpen) {
      setActiveStage('Upload');
    }
  }, [uploadOpen]);

  // Stage buckets — each document lives in exactly one workflow stage.
  const queuedDocuments = documents.filter((document) => document.state === 'Queued');
  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const readyDocuments = documents.filter((document) => document.state === 'Ready');
  const proofDocuments = readyDocuments.filter((document) => Boolean(document.horseId));
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');
  const buyerSafeDocuments = documents.filter((document) => buildDocumentTrustProfile(document, horses).readyForProfile);
  const processingBatches = intakeBatches.filter((batch) => batch.state !== 'Completed');
  const unmatchedDocuments = documents.filter((document) => !document.horseId && document.state !== 'Archived');
  const staleReviewCount = reviewQueue.filter((document) => {
    const uploaded = Date.parse(document.uploadedAt);
    return Number.isFinite(uploaded) && Date.now() - uploaded > STALE_REVIEW_MS;
  }).length;

  // Proof chain context: which documents already back an ownership requirement.
  const proofLinksByDocumentId = useMemo(() => {
    const links = new Map<string, string[]>();
    ownershipRecords.forEach((record) => {
      const normalized = normalizeOwnershipRecord(record);
      (normalized.proofRequirements ?? []).forEach((requirement) => {
        if (requirement.documentId) {
          links.set(requirement.documentId, [...(links.get(requirement.documentId) ?? []), requirement.label]);
        }
      });
    });
    return links;
  }, [ownershipRecords]);
  const proofLinkedCount = documents.filter((document) => proofLinksByDocumentId.has(document.id)).length;

  const stageCounts: Record<PipelineStage, number> = {
    Upload: documents.length,
    Processing: queuedDocuments.length,
    Review: reviewQueue.length,
    Proof: proofDocuments.length,
    Share: readyDocuments.length,
  };

  const heroStatus =
    staleReviewCount > 0 || unmatchedDocuments.length > 0
      ? { label: 'Pipeline blocked', tone: 'rose' as const }
      : reviewQueue.length > 0
        ? { label: 'Review pending', tone: 'amber' as const }
        : { label: 'Pipeline clear', tone: 'blue' as const };

  const heroRisks = [
    ...(reviewQueue.length
      ? [{ label: `${reviewQueue.length} ${reviewQueue.length === 1 ? 'document needs' : 'documents need'} review`, severity: staleReviewCount > 0 ? ('rose' as const) : ('amber' as const) }]
      : []),
    ...(unmatchedDocuments.length
      ? [{ label: `${unmatchedDocuments.length} ${unmatchedDocuments.length === 1 ? 'document' : 'documents'} not matched to a horse`, severity: 'rose' as const }]
      : []),
  ];

  const applyExtractedFacts = (document: DocumentRecord) => {
    const targetId = reviewAssignments[document.id] ?? document.horseId ?? '';
    const horse = horses.find((item) => item.id === targetId);
    if (!horse) {
      pushToast({ title: 'Pick a horse first', message: 'Select which horse these facts belong to, then apply.', tone: 'warning' });
      return;
    }
    const applied: string[] = [];
    const patch: { registrationNumber?: string; owner?: string } = {};
    if (document.entities.registrationNumber && !horse.registrationNumber.trim()) {
      patch.registrationNumber = document.entities.registrationNumber;
      applied.push(`registration # ${document.entities.registrationNumber}`);
    }
    if (document.entities.ownerName && !horse.owner.trim()) {
      patch.owner = document.entities.ownerName;
      applied.push(`owner ${document.entities.ownerName}`);
    }
    if (!applied.length) {
      pushToast({ title: 'Nothing new to apply', message: `${horse.name} already has values for every fact this document extracted. Existing data is never overwritten.`, tone: 'info' });
      return;
    }
    const result = updateHorse(horse.id, patch);
    if (result.ok) {
      recordAuditEvent({
        actor: currentUserName,
        action: 'updated',
        entityType: 'horse',
        entityId: horse.id,
        summary: `OCR facts accepted from "${document.title}": ${applied.join(', ')}`,
        context: { documentId: document.id },
      });
    }
    pushToast({
      title: result.ok ? 'Facts applied to record' : 'Apply blocked',
      message: result.ok ? `${horse.name} updated: ${applied.join(', ')}. Logged to the audit trail.` : result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const menuDocument = menuState?.type === 'document' ? documents.find((document) => document.id === menuState.documentId) : undefined;
  const menuHorseId = menuDocument ? reviewAssignments[menuDocument.id] ?? menuDocument.horseId : undefined;

  const goToStage = (stage: PipelineStage) => {
    setActiveStage(stage);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const openSurfaceMenu = (surfaceId: SurfaceId, event: MouseEvent) => {
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
          ...(menuState.surfaceId === 'review'
            ? [
                ...(reviewQueue[0] && (reviewQueue[0].fileUrl || reviewQueue[0].storagePath)
                  ? [
                      {
                        id: 'open-next',
                        label: 'Open next file in queue',
                        onSelect: () => {
                          void openDocument(reviewQueue[0]);
                        },
                      },
                    ]
                  : []),
                {
                  id: 'go-upload-from-review',
                  label: 'Go to Upload stage',
                  onSelect: () => goToStage('Upload'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'buyer'
            ? [
                {
                  id: 'open-shared',
                  label: 'Open Shared Access workspace (Sale Listings)',
                  onSelect: () => navigate(SHARED_ACCESS_PATH),
                },
                {
                  id: 'go-proof-from-buyer',
                  label: 'Go to Proof stage',
                  onSelect: () => goToStage('Proof'),
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
                  id: 'go-processing-from-intake',
                  label: 'Go to OCR / Processing stage',
                  onSelect: () => goToStage('Processing'),
                },
                {
                  id: 'open-subscriptions',
                  label: 'Open Subscriptions page (storage plan)',
                  onSelect: () => navigate('/subscriptions'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'batches'
            ? [
                {
                  id: 'go-processing-from-batches',
                  label: 'Go to OCR / Processing stage',
                  onSelect: () => goToStage('Processing'),
                },
                {
                  id: 'go-review-from-batches',
                  label: 'Go to Review stage',
                  onSelect: () => goToStage('Review'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'duplicates'
            ? [
                {
                  id: 'go-review-from-duplicates',
                  label: 'Go to Review stage',
                  onSelect: () => goToStage('Review'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'processing'
            ? [
                {
                  id: 'go-upload-from-processing',
                  label: 'Go to Upload stage',
                  onSelect: () => goToStage('Upload'),
                },
                {
                  id: 'go-review-from-processing',
                  label: 'Go to Review stage',
                  onSelect: () => goToStage('Review'),
                },
              ]
            : []),
          ...(menuState.surfaceId === 'proof'
            ? [
                {
                  id: 'open-ownership',
                  label: 'Open Ownership page (proof chains)',
                  onSelect: () => navigate('/ownership'),
                },
                {
                  id: 'go-share-from-proof',
                  label: 'Go to Share stage',
                  onSelect: () => goToStage('Share'),
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

  const handleCreateOwnershipRecord = (targetHorseId: string) => {
    const result = ensureOwnershipRecord(targetHorseId);
    pushToast({
      title: result.ok ? 'Ownership record ready' : 'Ownership record blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const handleLinkProof = (document: DocumentRecord) => {
    if (!document.horseId) {
      return;
    }
    let recordId = ownershipRecords.find((record) => record.horseId === document.horseId)?.id;
    if (!recordId) {
      const ensured = ensureOwnershipRecord(document.horseId);
      if (!ensured.ok || !ensured.recordId) {
        pushToast({ title: 'Ownership record blocked', message: ensured.message, tone: 'error' });
        return;
      }
      recordId = ensured.recordId;
    }
    const requirementId = proofSelections[document.id];
    if (!requirementId) {
      pushToast({ title: 'Pick a requirement', message: 'Choose which proof requirement this document satisfies.', tone: 'warning' });
      return;
    }
    const result = linkOwnershipProof(recordId, requirementId, document.id);
    pushToast({
      title: result.ok ? 'Proof linked' : 'Proof link blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setProofSelections((current) => ({ ...current, [document.id]: '' }));
    }
  };

  // Packet generation is the guided premium workflow (release gate, margin
  // intelligence, buyer capture, deal-room logging) — see SalePacketWizard.

  const shareGroups = horses
    .map((horse) => ({ horse, documents: readyDocuments.filter((document) => document.horseId === horse.id) }))
    .filter((group) => group.documents.length > 0);
  const unassignedReadyDocuments = readyDocuments.filter((document) => !document.horseId);
  const activeStageMeta = PIPELINE_STAGES.find((stage) => stage.id === activeStage) ?? PIPELINE_STAGES[0];

  return (
    <>
      <CommandBrief
        eyebrow="Document Vault"
        entity="Your Documents"
        status={heroStatus}
        summary="Every file moves through one path: upload, local OCR, human review, ownership proof, then watermarked sharing."
        evidence={[
          { label: 'Uploaded total', value: String(documents.length) },
          { label: 'Processing', value: String(queuedDocuments.length) },
          { label: 'Needs review', value: String(reviewQueue.length) },
          { label: 'Proof-linked', value: String(proofLinkedCount) },
          { label: 'Share-ready', value: String(buyerSafeDocuments.length) },
        ]}
        risks={heroRisks}
        nextAction={
          reviewQueue.length
            ? { label: `Open review queue (${reviewQueue.length})`, onClick: () => goToStage('Review') }
            : { label: 'Upload documents', onClick: () => goToStage('Upload') }
        }
        secondaryActions={[{ label: 'Open Shared Access workspace', to: SHARED_ACCESS_PATH }]}
        variant="wide"
      />

      <section className="surface-panel">
        <div className="surface-tabs" role="tablist" aria-orientation="horizontal" aria-label="Document pipeline stages">
          {PIPELINE_STAGES.map((stage, index) => (
            <button
              key={stage.id}
              type="button"
              role="tab"
              aria-selected={activeStage === stage.id}
              className={`surface-tab${activeStage === stage.id ? ' surface-tab--active' : ''}`}
              onClick={() => setActiveStage(stage.id)}
            >
              {index + 1}. {stage.label} ({stageCounts[stage.id]})
            </button>
          ))}
        </div>
        <p className="panel__description" style={{ marginTop: 10, marginBottom: 0 }}>{activeStageMeta.hint}</p>
      </section>

      {activeStage === 'Upload' ? (
        <>
          <Panel
            title="Stage 1 · Upload"
            description="New files enter the pipeline here, then move to local OCR automatically."
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
                {isSubmitting ? 'Adding...' : 'Add docs'}
              </button>
              <Pill tone={files.length ? 'blue' : 'slate'}>{files.length ? `${files.length} queued` : 'No files'}</Pill>
            </div>
          </Panel>

          <Panel
            title="Recent intake batches"
            description="Each upload lands as a batch and feeds the OCR stage."
            className="cursor-context-menu"
            onContextMenu={(event) => openSurfaceMenu('batches', event)}
          >
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
                      <Pill tone={batch.state === 'Completed' ? 'blue' : 'amber'}>{batch.state}</Pill>
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
              <EmptyState
                compact
                title="No document uploads yet"
                description="Add files above to start the pipeline — OCR picks them up automatically."
              />
            )}
          </Panel>
        </>
      ) : null}

      {activeStage === 'Processing' ? (
        <Panel
          title="Stage 2 · OCR / Processing"
          description="OCR runs locally; fields below were extracted automatically."
          className="cursor-context-menu"
          onContextMenu={(event) => openSurfaceMenu('processing', event)}
        >
          {queuedDocuments.length || processingBatches.length ? (
            <div className="stack-list">
              {processingBatches.map((batch) => (
                <div key={batch.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{batch.label}</div>
                      <div className="stack-item__copy">
                        Batch still processing · {batch.processedCount}/{batch.fileCount} files logged · {formatDateTimeLabel(batch.receivedAt)}
                      </div>
                    </div>
                    <Pill tone="amber">{batch.state}</Pill>
                  </div>
                </div>
              ))}
              {queuedDocuments.map((document) => {
                const horse = horses.find((item) => item.id === document.horseId);
                const entityRows = [
                  { label: 'Horse name', value: document.entities.horseName },
                  { label: 'Registration #', value: document.entities.registrationNumber },
                  { label: 'Owner', value: document.entities.ownerName },
                  { label: 'Exam date', value: document.entities.examDate },
                  { label: 'Veterinarian', value: document.entities.veterinarian },
                ].filter((row) => Boolean(row.value));
                return (
                  <div key={document.id} className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{document.title}</div>
                        <div className="stack-item__copy">
                          {document.type} · {document.source} · {horse?.name ?? 'No horse match yet'}
                        </div>
                      </div>
                      <Pill tone="amber">In OCR · {Math.round(document.confidence * 100)}% confidence</Pill>
                    </div>
                    {entityRows.length ? (
                      <div className="inline-metrics">
                        {entityRows.map((row) => (
                          <span key={row.label}>{row.label}: {row.value}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="stack-item__copy">No fields extracted yet — this file is still in the OCR queue.</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              compact
              title="Nothing is processing"
              description="OCR is idle. Upload documents in stage 1 to feed the queue."
              action={
                <button className="button button--ghost button--compact" type="button" onClick={() => goToStage('Upload')}>
                  Go to Upload stage
                </button>
              }
            />
          )}
        </Panel>
      ) : null}

      {activeStage === 'Review' ? (
        <>
          <Panel
            title="Stage 3 · Review"
            description="Confirm OCR matches, assign the horse, then approve or discard."
            className="cursor-context-menu"
            onContextMenu={(event) => openSurfaceMenu('review', event)}
          >
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
                          className="table-row--contextual"
                          role="group"
                          tabIndex={0}
                          aria-label={`${document.title} review actions`}
                          title="Use the row actions or press Shift+F10 for more document actions."
                          onKeyDown={(event) => {
                            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                              event.preventDefault();
                              const bounds = event.currentTarget.getBoundingClientRect();
                              setMenuState({ type: 'document', documentId: document.id, x: bounds.left + 32, y: bounds.top + 32 });
                            }
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            setMenuState({ type: 'document', documentId: document.id, x: event.clientX, y: event.clientY });
                          }}
                        >
                          <td>
                            <div className="table-cell__stack">
                              <strong>{document.title}</strong>
                              <span>{document.type} · {Math.round(document.confidence * 100)}% OCR confidence</span>
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
                              <Pill tone={document.state === 'Ready' ? 'blue' : document.state === 'Matched' ? 'blue' : trust.tone}>{document.state}</Pill>
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
                              <button
                                className="button button--ghost button--compact"
                                type="button"
                                onClick={() => applyExtractedFacts(document)}
                                disabled={!canReviewDocuments}
                                title="Copy extracted facts into empty fields on the horse record (never overwrites)."
                              >
                                Apply facts
                              </button>
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
                description="Approved documents continue to the Proof stage; upload more files to keep the pipeline moving."
                action={
                  <button className="button button--ghost button--compact" type="button" onClick={() => goToStage('Upload')}>
                    Go to Upload stage
                  </button>
                }
              />
            )}
          </Panel>

          <Panel title="Duplicate flags" className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('duplicates', event)}>
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
              <EmptyState compact title="No duplicate flags" description="Possible duplicates surface here during review." />
            )}
          </Panel>
        </>
      ) : null}

      {activeStage === 'Proof' ? (
        <Panel
          title="Stage 4 · Proof"
          description="Attach approved documents to the horse's ownership proof chain."
          className="cursor-context-menu"
          onContextMenu={(event) => openSurfaceMenu('proof', event)}
        >
          {proofDocuments.length ? (
            <div className="stack-list">
              {proofDocuments.map((document) => {
                const horse = horses.find((item) => item.id === document.horseId);
                const record = ownershipRecords.find((item) => item.horseId === document.horseId);
                const normalized = record ? normalizeOwnershipRecord(record) : undefined;
                const requirements = normalized?.proofRequirements ?? [];
                const linkedLabels = proofLinksByDocumentId.get(document.id) ?? [];
                return (
                  <div key={document.id} className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{document.title}</div>
                        <div className="stack-item__copy">
                          {document.type} · {horse?.name ?? 'Unknown horse'} · approved {formatDateTimeLabel(document.uploadedAt)}
                        </div>
                      </div>
                      <div className="inline-actions inline-actions--card">
                        {linkedLabels.length ? (
                          linkedLabels.map((label) => (
                            <Pill key={label} tone="blue">Linked: {label}</Pill>
                          ))
                        ) : (
                          <Pill tone="slate">Not linked yet</Pill>
                        )}
                      </div>
                    </div>
                    {record && normalized ? (
                      <div className="inline-actions">
                        <label className="field-stack" style={{ minWidth: 260 }}>
                          <span className="field-label">Use as ownership proof…</span>
                          <select
                            className="field-input field-input--compact"
                            value={proofSelections[document.id] ?? ''}
                            onChange={(event) =>
                              setProofSelections((current) => ({ ...current, [document.id]: event.target.value }))
                            }
                          >
                            <option value="">Select proof requirement</option>
                            {requirements.map((requirement) => (
                              <option key={requirement.id} value={requirement.id}>
                                {requirement.label} — {requirement.status}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={() => handleLinkProof(document)}
                          disabled={!proofSelections[document.id]}
                        >
                          Link proof
                        </button>
                      </div>
                    ) : (
                      <div className="inline-actions">
                        <span className="stack-item__copy">No ownership record exists for {horse?.name ?? 'this horse'} yet.</span>
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={() => document.horseId && handleCreateOwnershipRecord(document.horseId)}
                        >
                          Create ownership record
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              title="No approved documents to use as proof"
              description="Approve documents in the Review stage (with a horse assigned) and they appear here for ownership proof linking."
              action={
                <button className="button button--ghost button--compact" type="button" onClick={() => goToStage('Review')}>
                  Go to Review stage
                </button>
              }
            />
          )}
        </Panel>
      ) : null}

      {activeStage === 'Share' ? (
        <>
          <Panel
            title="Stage 5 · Share"
            description="Bundle each horse's approved documents into a watermarked sale packet."
            action={
              <button className="button button--ghost button--compact" type="button" onClick={() => navigate(SHARED_ACCESS_PATH)}>
                Open Shared Access workspace
              </button>
            }
            className="cursor-context-menu"
            onContextMenu={(event) => openSurfaceMenu('buyer', event)}
          >
            {shareGroups.length ? (
              <div className="stack-list">
                {shareGroups.map((group) => (
                  <div key={group.horse.id} className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{group.horse.name}</div>
                        <div className="stack-item__copy">
                          {group.documents.length} approved {group.documents.length === 1 ? 'document' : 'documents'}: {group.documents.map((document) => document.title).join(', ')}
                        </div>
                      </div>
                      <button
                        className="button button--primary button--compact"
                        type="button"
                        onClick={() => setPacketBuildingHorseId(group.horse.id)}
                      >
                        Start sale packet generator
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No documents are share-ready"
                description="Approve documents and assign them to a horse, then bundle them here as a watermarked sale packet."
                action={
                  <button className="button button--ghost button--compact" type="button" onClick={() => goToStage('Review')}>
                    Go to Review stage
                  </button>
                }
              />
            )}
            {unassignedReadyDocuments.length ? (
              <p className="panel__description" style={{ marginTop: 12, marginBottom: 0 }}>
                {unassignedReadyDocuments.length} approved {unassignedReadyDocuments.length === 1 ? 'document is' : 'documents are'} not matched to a horse and cannot join a packet yet.
              </p>
            ) : null}
          </Panel>

          <Panel title="Generated sale packets" description="Watermarked builds already created from this pipeline.">
            {salePacketBuilds.length ? (
              <div className="stack-list">
                {salePacketBuilds.map((packet) => {
                  const horse = horses.find((item) => item.id === packet.horseId);
                  return (
                    <div key={packet.id} className="stack-item">
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{horse?.name ?? 'Unknown horse'} · {packet.fileName ?? 'Sale packet'}</div>
                          <div className="stack-item__copy">
                            {packet.documentIds.length} documents · watermark "{packet.watermark}" · {formatDateTimeLabel(packet.createdAt)} by {packet.createdBy}
                          </div>
                        </div>
                        <div className="inline-actions" style={{ alignItems: 'center' }}>
                          {packet.downloadUrl ? (
                            <a className="button button--ghost button--compact" href={packet.downloadUrl} target="_blank" rel="noreferrer">
                              Download PDF
                            </a>
                          ) : null}
                          <Pill tone={packet.status === 'shared' ? 'blue' : packet.status === 'generated' ? 'blue' : 'amber'}>{packet.status}</Pill>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState compact title="No sale packets yet" description="Generate a packet above and it will be listed here for hand-off." />
            )}
          </Panel>

          <Panel title="Legal & commerce documents" description="XBAR LLC(TM) terms, policies, and the equine records disclaimer — include them with buyer hand-offs.">
            <div className="stack-list">
              {legalDocuments.map((legalDoc) => (
                <div key={legalDoc.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{legalDoc.shortTitle}</div>
                      <div className="stack-item__copy">{legalDoc.purpose}</div>
                    </div>
                    <div className="inline-actions">
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={() => {
                          const opened = openPrintableLegalDocument(legalDoc);
                          pushToast({
                            title: opened ? 'Legal document opened' : 'Preview blocked',
                            message: opened ? `${legalDoc.shortTitle} opened in a printable PDF-ready tab.` : 'Allow popups to preview and print the legal document.',
                            tone: opened ? 'success' : 'error',
                          });
                        }}
                      >
                        Preview / print
                      </button>
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={() => {
                          downloadLegalHtml(legalDoc);
                          pushToast({ title: 'Legal document exported', message: `${legalDoc.shortTitle} downloaded as a print-ready file.`, tone: 'success' });
                        }}
                      >
                        Download
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </>
      ) : null}

      <SalePacketWizard
        open={Boolean(packetBuildingHorseId)}
        initialHorseId={packetBuildingHorseId || null}
        onClose={() => setPacketBuildingHorseId('')}
      />
      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
