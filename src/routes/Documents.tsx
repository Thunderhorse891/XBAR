import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { EmptyState } from '@/components/EmptyState';
import { formatDateTimeLabel, formatPercent } from '@/lib/format';
import { buildDocumentTrustProfile } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { DocumentSource } from '@/types/xbar';

const sources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Owner Portal', 'Sales Packet'];

export default function Documents() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);
  const ocrBatches = useXbarStore((state) => state.ocrBatches);
  const subscription = useXbarStore((state) => state.subscription);
  const createOCRIntake = useXbarStore((state) => state.createOCRIntake);
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

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting');
  const matched = documents.filter((document) => document.state === 'Matched' || document.state === 'Ready');
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');
  const buyerSafeDocuments = documents.filter((document) => buildDocumentTrustProfile(document, horses).readyForProfile);
  const uploadOpen = searchParams.get('upload') === '1';
  const menuDocument = documents.find((document) => document.id === menuState?.documentId);
  const menuHorseId = menuDocument ? reviewAssignments[menuDocument.id] ?? menuDocument.horseId : undefined;
  const menuItems = menuDocument
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
    const result = await createOCRIntake({
      files,
      horseId: horseId || undefined,
      source,
      uploadedBy,
      label: batchLabel,
    });

    pushToast({
      title: result.ok ? 'OCR intake updated' : 'OCR intake blocked',
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
        description="Scan, review, trust, promote."
      />

      <div className="callout callout--warning">
        <strong>Preview mode:</strong> External OCR is not connected in this build. Image and PDF intake stays local and uses simulated extraction states.
      </div>

      <div className="metric-grid">
        <MetricCard label="Document vault" value={`${documents.length}`} detail="Registration, medical, transfer, insurance, and media records" />
        <MetricCard label="Needs review" value={`${reviewQueue.length}`} detail="Human review queue before facts become trusted profile data" tone="amber" />
        <MetricCard label="Buyer-safe docs" value={`${buyerSafeDocuments.length}`} detail="Approved documents strong enough for buyer-facing packet surfaces" tone="emerald" />
        <MetricCard label="Processing usage" value={`${subscription.usage.ocrProcessed}/${subscription.usage.ocrLimit}`} detail="Local document pages processed against the current plan" tone="blue" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          eyebrow="Live intake"
          title="Upload files into the document queue"
          description="This writes directly into the current workspace. You can route files to a horse now or let the intake layer attempt a local match from file names and extracted text."
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
                <option value="">Auto-match from file names</option>
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
              {isSubmitting ? 'Starting intake...' : 'Start intake'}
            </button>
            <div className="detail-block subtle">
              {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected for intake.` : 'Choose files to create a live OCR batch.'}
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Batch intake" title="Document queue states" description="New uploads appear here immediately and stay in the current workspace until you review or attach them.">
          {ocrBatches.length ? (
            <div className="stack-list">
              {ocrBatches.map((batch) => (
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
                    <span>{batch.processedCount}/{batch.fileCount} processed</span>
                    <span>{batch.matchedCount} matched</span>
                    <span>{batch.needsReviewCount} queued for review</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No intake batches yet"
              description="Upload a batch to start the review queue and document trust workflow."
            />
          )}
        </Panel>
      </div>

      <Panel eyebrow="Review workbench" title="Confidence and match review" description="Approve low-confidence documents and route them into the correct horse profile.">
        {reviewQueue.length ? (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Suggested horse</th>
                  <th>Trust</th>
                  <th>Review signal</th>
                  <th>Assign horse</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reviewQueue.map((document) => {
                  const trust = buildDocumentTrustProfile(document, horses);
                  const topCandidate = trust.candidateMatches[0];
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
                          <span>{document.entities.horseName ?? topCandidate?.horseName ?? 'Unresolved'}</span>
                          <span>{topCandidate ? `${topCandidate.confidence}% · ${topCandidate.reason}` : 'No strong match candidate yet'}</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell__stack">
                          <Pill tone={trust.tone}>{formatPercent(trust.trustScore)}</Pill>
                          <span>{trust.entityCount}/{trust.totalEntities} entities</span>
                        </div>
                      </td>
                      <td>
                        <div className="table-cell__stack">
                          <span>{document.state}</span>
                          <span>{trust.reviewReasons[0] ?? 'Cleared for next review step'}</span>
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
            description="Nothing is waiting for manual OCR review right now."
          />
        )}
      </Panel>

      <Panel eyebrow="Extracted data" title="Entity extraction preview" description="Trusted entities are what get promoted into horse profiles once review clears.">
        {documents.length ? (
          <div className="detail-grid">
            {documents.slice(0, 6).map((document) => {
              const trust = buildDocumentTrustProfile(document, horses);
              return (
                <div key={document.id} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{document.title}</div>
                    <div className="status-inline">
                      <Pill tone={trust.tone}>{formatPercent(trust.trustScore)} trust</Pill>
                      <Pill tone={document.duplicateRisk === 'Possible Duplicate' ? 'rose' : document.state === 'Ready' ? 'emerald' : 'blue'}>
                        {document.type}
                      </Pill>
                    </div>
                  </div>
                  <div className="stack-item__copy">{document.summary}</div>
                  <div className="inline-metrics">
                    <span>{trust.entityCount}/{trust.totalEntities} entities</span>
                    <span>{trust.candidateMatches[0]?.horseName ?? 'No match candidate'}</span>
                    <span>{matched.includes(document) ? 'Attached to packet flow' : 'Still in trust workbench'}</span>
                  </div>
                  <div className="token-row">
                    {Object.entries(document.entities)
                      .filter(([, value]) => Boolean(value))
                      .map(([label, value]) => (
                        <Pill key={label} tone="blue">
                          {label}: {value}
                        </Pill>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            compact
            title="No extracted entities yet"
            description="Upload documents to generate preview entities and trust scoring."
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
