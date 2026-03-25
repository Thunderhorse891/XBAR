import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { OwnershipStake, TransferStatus } from '@/types/xbar';

const ownershipRoles: OwnershipStake['role'][] = ['Co-Owner', 'Managing Partner', 'Prospective Buyer'];
const transferStatuses: TransferStatus[] = ['Clear', 'Pending Signatures', 'AQHA Review', 'Attention Required'];

export default function Ownership() {
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const horses = useXbarStore((state) => state.horses);
  const updateOwnershipRecord = useXbarStore((state) => state.updateOwnershipRecord);
  const addOwnershipAuditEntry = useXbarStore((state) => state.addOwnershipAuditEntry);
  const addOwnershipStake = useXbarStore((state) => state.addOwnershipStake);
  const pushToast = useUiStore((state) => state.pushToast);

  const pending = ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
  const withCoOwners = horses.filter((horse) => horse.ownership.length > 1);
  const [selectedRecordId, setSelectedRecordId] = useState(ownershipRecords[0]?.id ?? '');
  const selectedRecord = ownershipRecords.find((record) => record.id === selectedRecordId) ?? ownershipRecords[0];
  const selectedHorse = horses.find((horse) => horse.id === selectedRecord?.horseId);
  const [legalOwner, setLegalOwner] = useState(selectedRecord?.legalOwner ?? '');
  const [transferStatus, setTransferStatus] = useState<TransferStatus>(selectedRecord?.transferStatus ?? 'Attention Required');
  const [complianceDeadline, setComplianceDeadline] = useState(selectedRecord?.complianceDeadline ?? '');
  const [pendingDocuments, setPendingDocuments] = useState(selectedRecord?.pendingDocuments.join(', ') ?? '');
  const [auditNote, setAuditNote] = useState('');
  const [coOwner, setCoOwner] = useState({ name: '', share: '25', role: 'Co-Owner' as OwnershipStake['role'], contact: '' });
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!selectedRecord) {
      return;
    }

    setLegalOwner(selectedRecord.legalOwner);
    setTransferStatus(selectedRecord.transferStatus);
    setComplianceDeadline(selectedRecord.complianceDeadline);
    setPendingDocuments(selectedRecord.pendingDocuments.join(', '));
  }, [selectedRecord]);

  return (
    <>
      <PageHeader
        eyebrow="Ownership"
        title="Ownership integrity"
        description="Legal owners, splits, transfer status."
      />

      <div className="metric-grid">
        <MetricCard label="Ownership files" value={`${ownershipRecords.length}`} detail="Tracked legal ownership records" />
        <MetricCard label="Open transfers" value={`${pending.length}`} detail="Packets still waiting on signatures or AQHA review" tone="amber" />
        <MetricCard label="Co-owner splits" value={`${withCoOwners.length}`} detail="Horses with structured ownership shares" tone="blue" />
        <MetricCard label="Confidence" value={`${Math.round(ownershipRecords.reduce((sum, record) => sum + record.confidence, 0) / ownershipRecords.length)}%`} detail="Average certainty across current ownership records" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Transfer queue" title="Open ownership work" description="Transfers and title hygiene.">
          {ownershipRecords.length ? (
            <div className="stack-list">
              {ownershipRecords.map((record) => {
                const horse = horses.find((item) => item.id === record.horseId);
                return (
                  <button key={record.id} type="button" className={`stack-item stack-item--interactive${record.id === selectedRecordId ? ' stack-item--selected' : ''}`} onClick={() => {
                    setSelectedRecordId(record.id);
                    setFormError('');
                  }}>
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{horse?.name ?? record.legalOwner}</div>
                        <div className="stack-item__copy">Legal owner: {record.legalOwner}</div>
                      </div>
                      <Pill tone={record.transferStatus === 'Clear' ? 'emerald' : 'amber'}>{record.transferStatus}</Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{record.pendingDocuments.length} pending docs</span>
                      <span>Due {formatDateLabel(record.complianceDeadline)}</span>
                      <span>Confidence {record.confidence}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No ownership records" description="Create horses and transfers to start the ownership integrity queue." />
          )}
        </Panel>

        <Panel eyebrow="Share structure" title="Legal owners and co-owner splits" description="Structured ownership.">
          {withCoOwners.length ? (
            <div className="stack-list">
              {withCoOwners.map((horse) => (
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
          ) : (
            <EmptyState compact title="No co-owner splits yet" description="Add a co-owner below to structure legal shares directly from this page." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Transfer editor" title={selectedHorse ? `${selectedHorse.name} ownership controls` : 'Ownership controls'} description="Update legal owner, transfer status, deadlines, and pending paper from here.">
          {selectedRecord ? (
            <>
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Legal owner</span>
                  <input className="field-input" value={legalOwner} onChange={(event) => setLegalOwner(event.target.value)} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Transfer status</span>
                  <select className="field-input" value={transferStatus} onChange={(event) => setTransferStatus(event.target.value as TransferStatus)}>
                    {transferStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Deadline</span>
                  <input className="field-input" type="date" value={complianceDeadline} onChange={(event) => setComplianceDeadline(event.target.value)} />
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Pending documents</span>
                  <input className="field-input" value={pendingDocuments} onChange={(event) => setPendingDocuments(event.target.value)} />
                </label>
              </div>
              {formError ? <div className="field-error">{formError}</div> : null}
              <div className="inline-actions">
                <button
                  className="button button--primary button--compact"
                  type="button"
                  onClick={() => {
                    if (!legalOwner.trim() || !complianceDeadline.trim()) {
                      setFormError('Legal owner and compliance deadline are required.');
                      return;
                    }

                    const result = updateOwnershipRecord(selectedRecord.id, {
                      legalOwner,
                      transferStatus,
                      complianceDeadline,
                      pendingDocuments: pendingDocuments.split(',').map((item) => item.trim()).filter(Boolean),
                    });
                    pushToast({
                      title: result.ok ? 'Ownership updated' : 'Ownership update blocked',
                      message: result.message,
                      tone: result.ok ? 'success' : 'error',
                    });
                    if (result.ok) {
                      setFormError('');
                    }
                  }}
                >
                  Save transfer
                </button>
              </div>
            </>
          ) : (
            <EmptyState compact title="No ownership record selected" description="Choose a record from the transfer queue to update legal details." />
          )}
        </Panel>

        <Panel eyebrow="Co-owner editor" title="Add co-owner or partner" description="Structure multi-party ownership here instead of burying it inside a horse profile.">
          {selectedHorse ? (
            <>
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Name</span>
                  <input className="field-input" value={coOwner.name} onChange={(event) => setCoOwner((current) => ({ ...current, name: event.target.value }))} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Share</span>
                  <input className="field-input" type="number" min="1" max="100" value={coOwner.share} onChange={(event) => setCoOwner((current) => ({ ...current, share: event.target.value }))} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Role</span>
                  <select className="field-input" value={coOwner.role} onChange={(event) => setCoOwner((current) => ({ ...current, role: event.target.value as OwnershipStake['role'] }))}>
                    {ownershipRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Contact</span>
                  <input className="field-input" value={coOwner.contact} onChange={(event) => setCoOwner((current) => ({ ...current, contact: event.target.value }))} />
                </label>
              </div>
              <div className="inline-actions">
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={() => {
                    const result = addOwnershipStake(selectedHorse.id, {
                      name: coOwner.name,
                      share: Number(coOwner.share),
                      role: coOwner.role,
                      contact: coOwner.contact,
                    });
                    pushToast({
                      title: result.ok ? 'Co-owner added' : 'Co-owner blocked',
                      message: result.message,
                      tone: result.ok ? 'success' : 'error',
                    });

                    if (result.ok) {
                      setCoOwner({ name: '', share: '25', role: 'Co-Owner', contact: '' });
                    }
                  }}
                >
                  Add co-owner
                </button>
              </div>
            </>
          ) : (
            <EmptyState compact title="No horse selected" description="Choose a transfer record first, then add a co-owner or partner split." />
          )}
        </Panel>
      </div>

      <Panel eyebrow="Audit trail" title="Traceability" description="Clean paper trail.">
        {selectedRecord ? (
          <div className="detail-grid">
            <div className="stack-item">
              <div className="stack-item__title">{selectedHorse?.name ?? selectedRecord.legalOwner}</div>
              <div className="bullet-list">
                {selectedRecord.auditTrail.map((entry) => (
                  <div key={entry} className="bullet-list__item">
                    {entry}
                  </div>
                ))}
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Add audit note</div>
              <textarea className="field-textarea" rows={4} value={auditNote} onChange={(event) => setAuditNote(event.target.value)} />
              <div className="inline-actions">
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={() => {
                    const result = addOwnershipAuditEntry(selectedRecord.id, auditNote);
                    pushToast({
                      title: result.ok ? 'Audit note added' : 'Audit note blocked',
                      message: result.message,
                      tone: result.ok ? 'success' : 'error',
                    });
                    if (result.ok) {
                      setAuditNote('');
                    }
                  }}
                >
                  Save audit note
                </button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="No ownership record loaded" description="Select a transfer record to review the audit trail and add new notes." />
        )}
      </Panel>
    </>
  );
}
