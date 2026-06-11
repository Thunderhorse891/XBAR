import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { MetricCard, Panel, Pill, SurfaceTabs } from '@/components/app-ui';
import { EmptyState } from '@/components/EmptyState';
import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { formatDateTimeLabel } from '@/lib/format';
import { downloadLegalHtml, legalDocuments, openPrintableLegalDocument } from '@/lib/legalDocuments';
import { buildDocumentTrustProfile } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useCloudStore } from '@/store/useCloudStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { DocumentRecord, DocumentSource } from '@/types/xbar';
import { documentSources } from '@/features/documents/constants';
import type { DocumentsView } from '@/features/documents/types';

type SurfaceId = 'vault' | 'verify' | 'buyer' | 'storage' | 'intake' | 'legal' | 'batches' | 'duplicates';

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
  const session = useCloudStore((state) => state.session);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || workspaceProfile.ranchManagerName || workspaceProfile.defaultOwnerName || 'Ranch Staff';

  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<DocumentSource>('Bulk Intake');
  const [horseId, setHorseId] = useState('');
  const [uploadedBy, setUploadedBy] = useState(currentUserName);
  const [batchLabel, setBatchLabel] = useState('Proof intake batch');
  const [createHorseFromBatch, setCreateHorseFromBatch] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<{ uploadedBy?: string; files?: string }>({});
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});
  const [menuState, setMenuState] = useState<
    | { type: 'document'; documentId: string; x: number; y: number }
    | { type: 'surface'; surfaceId: SurfaceId; x: number; y: number }
    | null
  >(null);
  const [openingDocumentId, setOpeningDocumentId] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');
  const buyerSafeDocuments = documents.filter((document) => buildDocumentTrustProfile(document, horses).readyForProfile);
  const matchedDocuments = documents.filter((document) => document.state === 'Matched' || document.state === 'Ready');
  const releaseBlockedCount = reviewQueue.length + duplicates.length;
  const uploadOpen = searchParams.get('upload') === '1';
  const [activeView, setActiveView] = useState<DocumentsView>(uploadOpen ? 'Intake' : 'Verify');
  const menuDocument = menuState?.type === 'document' ? documents.find((document) => document.id === menuState.documentId) : undefined;
  const menuHorseId = menuDocument ? reviewAssignments[menuDocument.id] ?? menuDocument.horseId : undefined;

  useEffect(() => {
    if (uploadOpen) setActiveView('Intake');
  }, [uploadOpen]);

  const scrollToSection = (sectionId: string) => {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openSurfaceMenu = (surfaceId: SurfaceId, event: MouseEvent) => {
    event.preventDefault();
    setMenuState({ type: 'surface', surfaceId, x: event.clientX, y: event.clientY });
  };

  const openDocument = async (document: Pick<DocumentRecord, 'id' | 'title' | 'fileUrl' | 'storagePath'>) => {
    const previewWindow = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (previewWindow) previewWindow.opener = null;

    setOpeningDocumentId(document.id);
    const access = await getDocumentAccessUrl(document);
    setOpeningDocumentId('');

    if (!access.ok) {
      previewWindow?.close();
      pushToast({ title: 'Proof file unavailable', message: access.message, tone: 'error' });
      return;
    }

    if (previewWindow) {
      previewWindow.location.href = access.url;
      previewWindow.focus();
      return;
    }

    window.open(access.url, '_blank', 'noopener,noreferrer');
  };

  const previewLegalDocument = (legalDoc: (typeof legalDocuments)[number]) => {
    const opened = openPrintableLegalDocument(legalDoc);
    pushToast({
      title: opened ? 'Legal document opened' : 'Preview blocked',
      message: opened ? `${legalDoc.shortTitle} opened in a printable PDF-ready tab.` : 'Allow popups to preview and print the legal document.',
      tone: opened ? 'success' : 'error',
    });
  };

  const downloadLegalDocument = (legalDoc: (typeof legalDocuments)[number]) => {
    downloadLegalHtml(legalDoc);
    pushToast({ title: 'Legal document exported', message: `${legalDoc.shortTitle} downloaded as a PDF-ready file. Open it and print to PDF.`, tone: 'success' });
  };

  const menuItems = menuDocument
    ? [
        ...(menuDocument.fileUrl || menuDocument.storagePath
          ? [{ id: 'open-file', label: 'Open proof file', onSelect: () => void openDocument(menuDocument) }]
          : []),
        ...(canReviewDocuments
          ? [
              {
                id: 'approve',
                label: 'Verify and release proof',
                onSelect: () => {
                  const result = reviewDocument(menuDocument.id, menuHorseId);
                  pushToast({ title: result.ok ? 'Proof verified' : 'Verification blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                },
              },
              {
                id: 'discard',
                label: 'Reject proof file',
                onSelect: () => {
                  const result = discardDocument(menuDocument.id);
                  pushToast({ title: result.ok ? 'Proof rejected' : 'Reject blocked', message: result.message, tone: result.ok ? 'warning' : 'error' });
                },
                tone: 'danger' as const,
              },
            ]
          : []),
        ...(menuHorseId ? [{ id: 'open-horse', label: 'Open command file', onSelect: () => navigate(`/horses/${menuHorseId}`) }] : []),
      ]
    : menuState?.type === 'surface'
      ? [
          ...(menuState.surfaceId === 'vault'
            ? [
                { id: 'jump-intake', label: 'Jump to proof intake', onSelect: () => scrollToSection('documents-intake') },
                { id: 'jump-verify', label: 'Jump to verification queue', onSelect: () => scrollToSection('documents-review') },
              ]
            : []),
          ...(menuState.surfaceId === 'verify'
            ? [
                { id: 'focus-verify', label: 'Focus verification queue', onSelect: () => scrollToSection('documents-review') },
                ...(reviewQueue[0] && (reviewQueue[0].fileUrl || reviewQueue[0].storagePath)
                  ? [{ id: 'open-next', label: 'Open next proof file', onSelect: () => void openDocument(reviewQueue[0]) }]
                  : []),
              ]
            : []),
          ...(menuState.surfaceId === 'buyer'
            ? [
                { id: 'open-shared', label: 'Open Buyer Packet', onSelect: () => navigate('/shared-access') },
                { id: 'focus-buyer-review', label: 'Jump to verification queue', onSelect: () => scrollToSection('documents-review') },
              ]
            : []),
          ...(menuState.surfaceId === 'storage'
            ? [{ id: 'open-plan-control', label: 'Open Plan Control', onSelect: () => navigate('/subscriptions') }]
            : []),
          ...(menuState.surfaceId === 'intake'
            ? [
                ...(canUploadDocuments ? [{ id: 'choose-files', label: 'Choose proof files', onSelect: () => fileInputRef.current?.click() }] : []),
                { id: 'focus-intake', label: 'Focus proof intake', onSelect: () => scrollToSection('documents-intake') },
              ]
            : []),
          ...(menuState.surfaceId === 'legal'
            ? [
                { id: 'focus-legal', label: 'Open legal documents', onSelect: () => setActiveView('Legal') },
                { id: 'open-terms', label: 'Open Terms page', onSelect: () => navigate('/terms') },
              ]
            : []),
          ...(menuState.surfaceId === 'batches'
            ? [
                { id: 'focus-batches', label: 'Focus intake batches', onSelect: () => scrollToSection('documents-batches') },
                { id: 'focus-verify-from-batches', label: 'Jump to verification queue', onSelect: () => scrollToSection('documents-review') },
              ]
            : []),
          ...(menuState.surfaceId === 'duplicates'
            ? [
                { id: 'focus-duplicates', label: 'Focus proof flags', onSelect: () => scrollToSection('documents-duplicates') },
                { id: 'focus-verify-from-duplicates', label: 'Jump to verification queue', onSelect: () => scrollToSection('documents-review') },
              ]
            : []),
        ]
      : [];

  const handleIntake = async () => {
    const nextErrors: { uploadedBy?: string; files?: string } = {};
    if (!uploadedBy.trim()) nextErrors.uploadedBy = 'Uploaded by is required.';
    if (!files.length) nextErrors.files = 'Select at least one proof file.';

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setIsSubmitting(true);
    const result = await createDocumentIntake({ files, horseId: horseId || undefined, source, uploadedBy, label: batchLabel, createHorseFromBatch });

    pushToast({ title: result.ok ? 'Proof intake logged' : 'Proof intake blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) {
      setFiles([]);
      setBatchLabel('Proof intake batch');
      setCreateHorseFromBatch(false);
      setSearchParams({});
    }
    setIsSubmitting(false);
  };

  return (
    <>
      <div className="surface-hero surface-hero--dark proof-vault-hero">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Proof Vault</span>
            <h1>Document intelligence for intake, match, verification, legal protection, and release.</h1>
            <p className="command-center-briefing__copy">
              Control the evidence chain behind command files, title transfer, care status, operating cost, buyer packet release, and XBAR LLC commercial protection.
            </p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Proof files</span><strong>{documents.length}</strong></div>
            <div className="surface-hero__stat"><span>Verify queue</span><strong style={{ color: reviewQueue.length ? 'var(--amber)' : 'var(--emerald)' }}>{reviewQueue.length}</strong></div>
            <div className="surface-hero__stat"><span>Legal docs</span><strong>{legalDocuments.length}</strong></div>
            <div className="surface-hero__stat"><span>Blocked release</span><strong style={{ color: releaseBlockedCount ? 'var(--amber)' : 'var(--emerald)' }}>{releaseBlockedCount}</strong></div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Vault control" value={`${documents.length}`} detail={`${matchedDocuments.length} matched or ready`} tone="slate" title="Registration, medical, transfer, insurance, receipt, and media proof" onClick={() => scrollToSection('documents-review')} onContextMenu={(event) => openSurfaceMenu('vault', event)} />
        <MetricCard label="Verification queue" value={`${reviewQueue.length}`} detail="Files waiting on assignment or release decision" tone={reviewQueue.length ? 'amber' : 'emerald'} onClick={() => scrollToSection('documents-review')} onContextMenu={(event) => openSurfaceMenu('verify', event)} />
        <MetricCard label="Buyer release" value={`${buyerSafeDocuments.length}`} detail="Approved proof cleared for buyer packet surfaces" tone="emerald" onClick={() => navigate('/shared-access')} onContextMenu={(event) => openSurfaceMenu('buyer', event)} />
        <MetricCard label="Legal packet" value={`${legalDocuments.length}`} detail="Terms, privacy, billing, trademark, disclaimer, acceptable use" tone="blue" onClick={() => setActiveView('Legal')} onContextMenu={(event) => openSurfaceMenu('legal', event)} />
      </div>

      <section className="surface-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SurfaceTabs items={['Verify', 'Intake', 'Legal', 'Batches', 'Flags']} active={activeView} onChange={(view) => setActiveView(view as DocumentsView)} />
          <div className="flex flex-wrap gap-2">
            <Pill tone={reviewQueue.length ? 'amber' : 'emerald'}>{reviewQueue.length} verify</Pill>
            <Pill tone="blue">{legalDocuments.length} legal docs</Pill>
            <Pill tone="emerald">{buyerSafeDocuments.length} release-ready</Pill>
          </div>
        </div>
      </section>

      {activeView === 'Legal' ? (
        <Panel eyebrow="XBAR LLC legal packet" title="PDF-ready legal documents for charging customers" description="Terms, privacy, billing, trademark, acceptable use, and equine disclaimer documents. These are operational baseline documents and should be reviewed by counsel before final public launch." className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('legal', event)}>
          <div className="stack-list">
            {legalDocuments.map((legalDoc) => (
              <div key={legalDoc.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{legalDoc.shortTitle}</div>
                    <div className="stack-item__copy">{legalDoc.purpose}</div>
                  </div>
                  <Pill tone={legalDoc.id === 'trademark-notice' ? 'amber' : 'blue'}>{legalDoc.id === 'trademark-notice' ? 'TM' : 'Legal'}</Pill>
                </div>
                <div className="stack-item__copy">{legalDoc.notice}</div>
                <div className="inline-actions inline-actions--card">
                  <button className="button button--primary button--compact" type="button" onClick={() => previewLegalDocument(legalDoc)}>Preview / print PDF</button>
                  <button className="button button--ghost button--compact" type="button" onClick={() => downloadLegalDocument(legalDoc)}>Download PDF-ready file</button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {activeView === 'Intake' ? (
        <div className="dashboard-grid dashboard-grid--primary">
          <Panel eyebrow="Proof intake" title="Add evidence to the vault" description="Files enter review before they are trusted by command files, title transfer, care status, or buyer packet release." action={<Pill tone={uploadOpen ? 'blue' : 'slate'}>{uploadOpen ? 'Top-bar launch' : `${subscription.usage.storageUsedGb}/${subscription.usage.storageLimitGb} GB used`}</Pill>} className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('intake', event)}>
            <div id="documents-intake" className="form-grid">
              <label className="field-stack"><span className="field-label">Intake batch label</span><input className="field-input" value={batchLabel} onChange={(event) => setBatchLabel(event.target.value)} disabled={!canUploadDocuments} /></label>
              <label className="field-stack"><span className="field-label">Evidence source</span><select className="field-input" value={source} onChange={(event) => setSource(event.target.value as DocumentSource)} disabled={!canUploadDocuments}>{documentSources.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              <label className="field-stack"><span className="field-label">Intake owner</span><input className="field-input" value={uploadedBy} onChange={(event) => { setUploadedBy(event.target.value); setFormErrors((current) => ({ ...current, uploadedBy: undefined })); }} disabled={!canUploadDocuments} />{formErrors.uploadedBy ? <span className="field-error">{formErrors.uploadedBy}</span> : null}</label>
              <label className="field-stack"><span className="field-label">Attach to command file</span><select className="field-input" value={horseId} onChange={(event) => { const nextHorseId = event.target.value; setHorseId(nextHorseId); if (nextHorseId) setCreateHorseFromBatch(false); }} disabled={!canUploadDocuments}><option value="">Attempt local file-name match</option>{horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}</select></label>
              <label className="field-stack"><span className="field-label">Command file creation</span><button type="button" className={`button button--ghost button--compact justify-start ${createHorseFromBatch ? 'border-[#2D8CFF] bg-[#EAF4FF] text-[#11151B]' : ''}`} onClick={() => setCreateHorseFromBatch((current) => !current)} disabled={!canUploadDocuments || Boolean(horseId)}>{createHorseFromBatch ? 'Create command file from proof' : 'Verify only'}</button></label>
              <label className="field-stack field-stack--wide"><span className="field-label">Proof files</span><input ref={fileInputRef} className="field-input field-input--file" type="file" multiple accept=".pdf,.txt,.csv,image/*" onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setFormErrors((current) => ({ ...current, files: undefined })); }} disabled={!canUploadDocuments} />{formErrors.files ? <span className="field-error">{formErrors.files}</span> : null}</label>
            </div>
            <div className="inline-actions">
              <button className="button button--primary" type="button" onClick={handleIntake} disabled={!canUploadDocuments || isSubmitting || !uploadedBy.trim() || !files.length}>{isSubmitting ? 'Logging intake...' : 'Log proof intake'}</button>
              <Pill tone={files.length ? 'blue' : 'slate'}>{files.length ? `${files.length} queued` : 'No proof files'}</Pill>
            </div>
          </Panel>
        </div>
      ) : null}

      {activeView === 'Verify' ? (
        <Panel eyebrow="Verification queue" title="Match, verify, or reject proof" description="Only verified proof should influence title release, buyer packets, care readiness, or operating decisions." className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('verify', event)}>
          {reviewQueue.length ? (
            <div id="documents-review" className="table-shell">
              <table className="data-table">
                <thead><tr><th>Proof file</th><th>Command file</th><th>Trust state</th><th>Assign file</th><th>Decision</th></tr></thead>
                <tbody>
                  {reviewQueue.map((document) => {
                    const trust = buildDocumentTrustProfile(document, horses);
                    const selectedHorse = horses.find((horse) => horse.id === (reviewAssignments[document.id] ?? document.horseId));
                    return (
                      <tr key={document.id} className="table-row--contextual" role="group" tabIndex={0} aria-label={`${document.title} proof verification actions`} title="Use row actions or press Shift+F10 for more proof actions." onKeyDown={(event) => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); setMenuState({ type: 'document', documentId: document.id, x: bounds.left + 32, y: bounds.top + 32 }); } }} onContextMenu={(event) => { event.preventDefault(); setMenuState({ type: 'document', documentId: document.id, x: event.clientX, y: event.clientY }); }}>
                        <td><div className="table-cell__stack"><strong>{document.title}</strong><span>{document.type}</span></div></td>
                        <td><div className="table-cell__stack"><span>{selectedHorse?.name ?? document.entities.horseName ?? 'Unassigned'}</span><span>{document.source}</span></div></td>
                        <td><div className="table-cell__stack"><Pill tone={document.state === 'Ready' ? 'emerald' : document.state === 'Matched' ? 'blue' : trust.tone}>{document.state}</Pill><span>{document.duplicateRisk === 'Possible Duplicate' ? 'Duplicate review required' : 'Manual verification'}</span></div></td>
                        <td><select className="field-input field-input--compact" value={reviewAssignments[document.id] ?? document.horseId ?? ''} onChange={(event) => setReviewAssignments((current) => ({ ...current, [document.id]: event.target.value }))} disabled={!canReviewDocuments}><option value="">Select command file</option>{horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}</select></td>
                        <td><div className="inline-actions inline-actions--card">{document.fileUrl || document.storagePath ? <button className="button button--ghost button--compact" type="button" onClick={() => void openDocument(document)} disabled={openingDocumentId === document.id}>{openingDocumentId === document.id ? 'Opening...' : 'Open proof'}</button> : null}<button className="button button--ghost button--compact" type="button" onClick={() => { const result = reviewDocument(document.id, reviewAssignments[document.id] ?? document.horseId); pushToast({ title: result.ok ? 'Proof verified' : 'Verification blocked', message: result.message, tone: result.ok ? 'success' : 'error' }); }} disabled={!canReviewDocuments}>Verify</button><button className="button button--ghost button--compact" type="button" onClick={() => { const result = discardDocument(document.id); pushToast({ title: result.ok ? 'Proof rejected' : 'Reject blocked', message: result.message, tone: result.ok ? 'warning' : 'error' }); }} disabled={!canReviewDocuments}>Reject</button></div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyState title="Verification queue is clear" description="No proof is waiting for assignment, verification, or release decision." />}
        </Panel>
      ) : null}

      {activeView === 'Flags' ? (
        <Panel eyebrow="Proof flags" title="Duplicates and release blockers" description="Resolve duplicate risk before proof is allowed to influence buyer-facing or title-transfer workflows." className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('duplicates', event)}>
          {duplicates.length ? <div id="documents-duplicates" className="stack-list">{duplicates.map((document) => { const trust = buildDocumentTrustProfile(document, horses); return <div key={document.id} className="stack-item" onContextMenu={(event) => openSurfaceMenu('duplicates', event)}><div className="stack-item__top"><div className="stack-item__title">{document.title}</div><Pill tone="rose">{document.duplicateRisk}</Pill></div><div className="stack-item__copy">{trust.duplicateSummary}</div></div>; })}</div> : <EmptyState compact title="No proof flags" description="Duplicate and release-blocker flags land here." />}
        </Panel>
      ) : null}

      {activeView === 'Batches' ? (
        <Panel eyebrow="Intake batches" title="Proof intake history" description="Track how evidence entered the vault, how much was matched, and what still requires verification." className="cursor-context-menu" onContextMenu={(event) => openSurfaceMenu('batches', event)}>
          {intakeBatches.length ? <div id="documents-batches" className="stack-list">{intakeBatches.map((batch) => <div key={batch.id} className="stack-item" onContextMenu={(event) => openSurfaceMenu('batches', event)}><div className="stack-item__top"><div><div className="stack-item__title">{batch.label}</div><div className="stack-item__copy">{batch.fileCount} files · {batch.source} · {formatDateTimeLabel(batch.receivedAt)}</div></div><Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>{batch.state}</Pill></div><div className="inline-metrics"><span>{batch.processedCount}/{batch.fileCount} logged</span><span>{batch.matchedCount} matched</span><span>{batch.needsReviewCount} waiting</span></div></div>)}</div> : <EmptyState compact title="No proof intake batches" description="Upload proof files to start the queue." />}
        </Panel>
      ) : null}

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
