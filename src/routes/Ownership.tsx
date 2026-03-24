import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function Ownership() {
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const horses = useXbarStore((state) => state.horses);

  const pending = ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
  const withCoOwners = horses.filter((horse) => horse.ownership.length > 1);

  return (
    <>
      <PageHeader
        eyebrow="Ownership"
        title="Ownership integrity"
        description="This module treats legal owner, co-owner shares, transfer status, compliance dates, and audit history as operational truth instead of hidden notes."
      />

      <div className="metric-grid">
        <MetricCard label="Ownership files" value={`${ownershipRecords.length}`} detail="Tracked legal ownership records" />
        <MetricCard label="Open transfers" value={`${pending.length}`} detail="Packets still waiting on signatures or AQHA review" tone="amber" />
        <MetricCard label="Co-owner splits" value={`${withCoOwners.length}`} detail="Horses with structured ownership shares" tone="blue" />
        <MetricCard label="Confidence" value={`${Math.round(ownershipRecords.reduce((sum, record) => sum + record.confidence, 0) / ownershipRecords.length)}%`} detail="Average certainty across current ownership records" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Transfer queue" title="Open ownership work" description="This is where transfers and title hygiene stay visible before they block a sale or travel decision.">
          <div className="stack-list">
            {ownershipRecords.map((record) => {
              const horse = horses.find((item) => item.id === record.horseId);
              return (
                <div key={record.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{horse?.name ?? record.legalOwner}</div>
                      <div className="stack-item__copy">Legal owner: {record.legalOwner}</div>
                    </div>
                    <Pill tone={record.transferStatus === 'Clear' ? 'emerald' : 'amber'}>{record.transferStatus}</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{record.pendingDocuments.length} pending docs</span>
                    <span>Due {record.complianceDeadline}</span>
                    <span>Confidence {record.confidence}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel eyebrow="Share structure" title="Legal owners and co-owner splits" description="Horse ownership now reads like portfolio structure, not a single owner field.">
          <div className="stack-list">
            {horses.filter((horse) => horse.ownership.length > 1).map((horse) => (
              <div key={horse.id} className="stack-item">
                <div className="stack-item__title">{horse.name}</div>
                <div className="token-row">
                  {horse.ownership.map((stake) => (
                    <Pill key={stake.id} tone={stake.role === 'Legal Owner' ? 'blue' : 'slate'}>
                      {stake.name} {stake.share}%
                    </Pill>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Audit trail" title="Traceability" description="Each record keeps its own operating history so a title question or ownership dispute has a clean paper trail.">
        <div className="detail-grid">
          {ownershipRecords.map((record) => {
            const horse = horses.find((item) => item.id === record.horseId);
            return (
              <div key={record.id} className="stack-item">
                <div className="stack-item__title">{horse?.name ?? record.legalOwner}</div>
                <div className="bullet-list">
                  {record.auditTrail.map((entry) => (
                    <div key={entry} className="bullet-list__item">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Panel>
    </>
  );
}
