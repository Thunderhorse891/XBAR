import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function Documents() {
  const documents = useXbarStore((state) => state.documents);
  const ocrBatches = useXbarStore((state) => state.ocrBatches);

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review');
  const matched = documents.filter((document) => document.state === 'Matched' || document.state === 'Ready');
  const duplicates = documents.filter((document) => document.duplicateRisk === 'Possible Duplicate');

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title="Document intake and OCR"
        description="The OCR pipeline is honestly scaffolded here: batch intake, extraction state, match confidence, review queue, and extracted entities are structured even before a live provider is connected."
      />

      <div className="metric-grid">
        <MetricCard label="Document vault" value={`${documents.length}`} detail="Registration, medical, transfer, insurance, and media records" />
        <MetricCard label="Needs review" value={`${reviewQueue.length}`} detail="Human review queue before facts become trusted profile data" tone="amber" />
        <MetricCard label="Matched" value={`${matched.length}`} detail="Documents already attached to horse profiles and packets" tone="emerald" />
        <MetricCard label="Duplicate risk" value={`${duplicates.length}`} detail="Potential duplicate uploads that need merge judgment" tone="rose" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Batch intake" title="OCR queue states" description="This queue models how hundreds of files move from upload into extraction, matching, and review.">
          <div className="stack-list">
            {ocrBatches.map((batch) => (
              <div key={batch.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{batch.label}</div>
                    <div className="stack-item__copy">
                      {batch.fileCount} files · {batch.source}
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

        <Panel eyebrow="Review workbench" title="Confidence and match review" description="The queue below surfaces the exact records that still need a human to approve match confidence or reconcile duplicates.">
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Horse</th>
                  <th>State</th>
                  <th>Confidence</th>
                  <th>Duplicate risk</th>
                </tr>
              </thead>
              <tbody>
                {documents
                  .filter((document) => document.state === 'Needs Review' || document.state === 'Extracting')
                  .map((document) => (
                    <tr key={document.id}>
                      <td>{document.title}</td>
                      <td>{document.entities.horseName ?? 'Unresolved'}</td>
                      <td>{document.state}</td>
                      <td>{Math.round(document.confidence * 100)}%</td>
                      <td>{document.duplicateRisk}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Extracted data" title="Entity extraction preview" description="These facts are what get promoted into horse profiles once the review state clears.">
        <div className="detail-grid">
          {documents.slice(0, 6).map((document) => (
            <div key={document.id} className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">{document.title}</div>
                <Pill tone="slate">{document.type}</Pill>
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
    </>
  );
}
