import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';
import type { DocumentSource } from '@/types/xbar';

const sources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Owner Portal', 'Sales Packet'];

export default function Documents() {
  const [searchParams, setSearchParams] = useSearchParams();
  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);
  const ocrBatches = useXbarStore((state) => state.ocrBatches);
  const subscription = useXbarStore((state) => state.subscription);
  const createOCRIntake = useXbarStore((state) => state.createOCRIntake);
  const reviewDocument = useXbarStore((state) => state.reviewDocument);

  const [files, setFiles] = useState<File[]>([]);
  const [source, setSource] = useState<DocumentSource>('Bulk Intake');
  const [horseId, setHorseId] = useState('');
  const [uploadedBy, setUploadedBy] = useState('Ops Desk');
  const [batchLabel, setBatchLabel] = useState('Live intake batch');
  const [message, setMessage] = useState('');
  const [reviewAssignments, setReviewAssignments] = useState<Record<string, string>>({});

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting');
  const matched = documents.filter((document) => document.state === 'Matched' || document.state === 'Ready');
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');
  const uploadOpen = searchParams.get('upload') === '1';

  const handleIntake = async () => {
    const result = await createOCRIntake({
      files,
      horseId: horseId || undefined,
      source,
      uploadedBy,
      label: batchLabel,
    });

    setMessage(result.message);
    if (result.ok) {
      setFiles([]);
      setBatchLabel('Live intake batch');
      setSearchParams({});
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Document intake and OCR"
        description="The live local intake engine is active here: upload files, route them into review, and promote trusted facts into horse profiles while a future cloud OCR provider remains optional."
      />

      {message ? <div className="status-banner">{message}</div> : null}

      <div className="metric-grid">
        <MetricCard label="Document vault" value={`${documents.length}`} detail="Registration, medical, transfer, insurance, and media records" />
        <MetricCard label="Needs review" value={`${reviewQueue.length}`} detail="Human review queue before facts become trusted profile data" tone="amber" />
        <MetricCard label="Matched" value={`${matched.length}`} detail="Documents already attached to horse profiles and packets" tone="emerald" />
        <MetricCard label="OCR usage" value={`${subscription.usage.ocrProcessed}/${subscription.usage.ocrLimit}`} detail="Live local intake pages against the current plan" tone="blue" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          eyebrow="Live intake"
          title="Upload files into the OCR queue"
          description="This now writes to the app state and persists locally. You can route directly to a horse or let the intake layer attempt a match from filenames and extracted text."
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
              <input className="field-input" value={uploadedBy} onChange={(event) => setUploadedBy(event.target.value)} />
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
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary" type="button" onClick={handleIntake}>
              Start intake
            </button>
            <div className="detail-block subtle">
              {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected for intake.` : 'Choose files to create a live OCR batch.'}
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Batch intake" title="OCR queue states" description="This queue is no longer fake. New uploads appear here immediately and persist in the preview.">
          <div className="stack-list">
            {ocrBatches.map((batch) => (
              <div key={batch.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{batch.label}</div>
                    <div className="stack-item__copy">
                      {batch.fileCount} files · {batch.source} · {batch.receivedAt}
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
        </Panel>
      </div>

      <Panel eyebrow="Review workbench" title="Confidence and match review" description="Approve low-confidence documents and route them into the correct horse profile.">
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Suggested horse</th>
                <th>State</th>
                <th>Confidence</th>
                <th>Assign horse</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {reviewQueue.map((document) => (
                <tr key={document.id}>
                  <td>{document.title}</td>
                  <td>{document.entities.horseName ?? 'Unresolved'}</td>
                  <td>{document.state}</td>
                  <td>{Math.round(document.confidence * 100)}%</td>
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
                    <button
                      className="button button--ghost button--compact"
                      type="button"
                      onClick={() => {
                        const result = reviewDocument(document.id, reviewAssignments[document.id] ?? document.horseId);
                        setMessage(result.message);
                      }}
                    >
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel eyebrow="Extracted data" title="Entity extraction preview" description="Trusted entities are what get promoted into horse profiles once review clears.">
        <div className="detail-grid">
          {documents.slice(0, 6).map((document) => (
            <div key={document.id} className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">{document.title}</div>
                <Pill tone={document.duplicateRisk === 'Possible Duplicate' ? 'rose' : document.state === 'Ready' ? 'emerald' : 'blue'}>
                  {document.type}
                </Pill>
              </div>
              <div className="stack-item__copy">{document.summary}</div>
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
          ))}
        </div>
      </Panel>

      {duplicates.length ? (
        <Panel eyebrow="Duplicates" title="Potential duplicate uploads">
          <div className="stack-list">
            {duplicates.map((document) => (
              <div key={document.id} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{document.title}</div>
                  <Pill tone="rose">{document.duplicateRisk}</Pill>
                </div>
                <div className="stack-item__copy">{document.summary}</div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}
