import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { OwnershipStake, TransferStatus } from '@/types/xbar';

const ownershipRoles: OwnershipStake['role'][] = ['Legal Owner', 'Co-Owner', 'Managing Partner', 'Prospective Buyer'];
const transferStatuses: TransferStatus[] = ['Clear', 'Pending Signatures', 'AQHA Review', 'Attention Required'];

export default function Ownership() {
  const navigate = useNavigate();
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const horses = useXbarStore((state) => state.horses);
  const updateOwnershipRecord = useXbarStore((state) => state.updateOwnershipRecord);
  const addOwnershipAuditEntry = useXbarStore((state) => state.addOwnershipAuditEntry);
  const addOwnershipStake = useXbarStore((state) => state.addOwnershipStake);
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageOwnership = useCurrentRoleCapability('manageOwnership');

  const pending = ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
  const withCoOwners = horses.filter((horse) => horse.ownership.length > 1);
  const confidenceAverage = ownershipRecords.length
    ? Math.round(ownershipRecords.reduce((sum, record) => sum + record.confidence, 0) / ownershipRecords.length)
    : 0;
  const [selectedRecordId, setSelectedRecordId] = useState(ownershipRecords[0]?.id ?? '');
  const selectedRecord = ownershipRecords.find((record) => record.id === selectedRecordId) ?? ownershipRecords[0];
  const selectedHorse = horses.find((horse) => horse.id === selectedRecord?.horseId);
  const [legalOwner, setLegalOwner] = useState(selectedRecord?.legalOwner ?? '');
  const [transferStatus, setTransferStatus] = useState<TransferStatus>(selectedRecord?.transferStatus ?? 'Attention Required');
  const [complianceDeadline, setComplianceDeadline] = useState(selectedRecord?.complianceDeadline ?? '');
  const [pendingDocuments, setPendingDocuments] = useState(selectedRecord?.pendingDocuments.join(', ') ?? '');
  const [auditNote, setAuditNote] = useState('');
  const [coOwner, setCoOwner] = useState({ name: '', share: '25', role: 'Co-Owner' as OwnershipStake['role'], contact: '' });
  const selectedHorseTotalShare = selectedHorse
    ? selectedHorse.ownership.reduce((sum, s) => sum + s.share, 0)
    : 0;
  const remainingShare = Math.max(0, 100 - selectedHorseTotalShare);
  const [formError, setFormError] = useState('');
  const [menuState, setMenuState] = useState<{ recordId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!selectedRecord) {
      return;
    }

    setLegalOwner(selectedRecord.legalOwner);
    setTransferStatus(selectedRecord.transferStatus);
    setComplianceDeadline(selectedRecord.complianceDeadline);
    setPendingDocuments(selectedRecord.pendingDocuments.join(', '));
  }, [selectedRecord]);

  const menuRecord = ownershipRecords.find((record) => record.id === menuState?.recordId);
  const menuHorse = horses.find((horse) => horse.id === menuRecord?.horseId);
  const menuItems = menuRecord
    ? [
        ...(menuHorse
          ? [
              {
                id: 'open-horse',
                label: 'Open horse profile',
                onSelect: () => navigate(`/horses/${menuHorse.id}`),
              },
            ]
          : []),
        ...(canManageOwnership
          ? [
              {
                id: 'mark-clear',
                label: 'Mark transfer clear',
                onSelect: () => {
                  const result = updateOwnershipRecord(menuRecord.id, { transferStatus: 'Clear' });
                  pushToast({ title: result.ok ? 'Transfer updated' : 'Transfer update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                },
              },
              {
                id: 'mark-aqha',
                label: 'Set AQHA review',
                onSelect: () => {
                  const result = updateOwnershipRecord(menuRecord.id, { transferStatus: 'AQHA Review' });
                  pushToast({ title: result.ok ? 'Transfer updated' : 'Transfer update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                },
              },
            ]
          : []),
      ]
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Ownership"
        title="Ownership"
      />

      <div className="metric-grid">
        <MetricCard label="Ownership files" value={`${ownershipRecords.length}`} detail="Tracked ownership records" />
        <MetricCard label="Open transfers" value={`${pending.length}`} detail="Waiting on signatures or AQHA" tone="amber" />
        <MetricCard label="Co-owner splits" value={`${withCoOwners.length}`} detail="Structured shares" tone="blue" />
        <MetricCard label="Confidence" value={`${confidenceAverage}%`} detail="Average record certainty" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Transfer queue" title="Queue">
          {ownershipRecords.length ? (
            <div className="stack-list">
              {ownershipRecords.map((record) => {
                const horse = horses.find((item) => item.id === record.horseId);
                return (
                  <button
                    key={record.id}
                    type="button"
                    className={`stack-item stack-item--interactive${record.id === selectedRecordId ? ' stack-item--selected' : ''}`}
                    onClick={() => {
                      setSelectedRecordId(record.id);
                      setFormError('');
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuState({ recordId: record.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div className="stack-item__top">
                      <div className="stack-item__title">{horse?.name ?? record.legalOwner}</div>
                      <Pill tone={record.transferStatus === 'Clear' ? 'emerald' : 'amber'}>{record.transferStatus}</Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{record.legalOwner}</span>
                      <span>{record.pendingDocuments.length} pending docs</span>
                      <span>Due {formatDateLabel(record.complianceDeadline)}</span>
                      <span>Confidence {record.confidence}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No ownership records" description="Create a horse or transfer to start the queue." />
          )}
        </Panel>

        <Panel eyebrow="Share structure" title="Splits">
          {withCoOwners.length ? (
            <div className="stack-list">
              {withCoOwners.map((horse) => {
                const total = horse.ownership.reduce((sum, s) => sum + s.share, 0);
                return (
                  <div key={horse.id} className="stack-item">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{horse.name}</div>
                      <Pill tone={total > 100 ? 'rose' : total === 100 ? 'emerald' : 'amber'}>
                        {total}% allocated
                      </Pill>
                    </div>
                    <div className="token-row">
                      {horse.ownership.map((stake) => (
                        <Pill key={stake.id} tone={stake.role === 'Legal Owner' ? 'blue' : 'slate'}>
                          {stake.name} {stake.share}%
                        </Pill>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No co-owner splits yet" description="Add a co-owner below." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Transfer editor" title={selectedHorse ? `${selectedHorse.name} transfer` : 'Transfer'}>
          {selectedRecord ? (
            <>
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Legal owner</span>
                  <input className="field-input" value={legalOwner} onChange={(event) => setLegalOwner(event.target.value)} disabled={!canManageOwnership} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Transfer status</span>
                  <select className="field-input" value={transferStatus} onChange={(event) => setTransferStatus(event.target.value as TransferStatus)} disabled={!canManageOwnership}>
                    {transferStatuses.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Deadline</span>
                  <input className="field-input" type="date" value={complianceDeadline} onChange={(event) => setComplianceDeadline(event.target.value)} disabled={!canManageOwnership} />
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Pending documents</span>
                  <input className="field-input" value={pendingDocuments} onChange={(event) => setPendingDocuments(event.target.value)} disabled={!canManageOwnership} />
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
                  disabled={!canManageOwnership}
                >
                  Save transfer
                </button>
              </div>
            </>
          ) : (
            <EmptyState compact title="No ownership record selected" description="Choose a record from the queue." />
          )}
        </Panel>

        <Panel eyebrow="Co-owner editor" title="Add split">
          {selectedHorse ? (
            <>
              {selectedHorseTotalShare > 0 ? (
                <div className="inline-metrics mb-3">
                  <span>Total allocated: <strong>{selectedHorseTotalShare}%</strong></span>
                  <Pill tone={remainingShare === 0 ? 'rose' : remainingShare < 25 ? 'amber' : 'emerald'}>
                    {remainingShare}% remaining
                  </Pill>
                </div>
              ) : null}
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Name</span>
                  <input className="field-input" value={coOwner.name} onChange={(event) => setCoOwner((current) => ({ ...current, name: event.target.value }))} disabled={!canManageOwnership} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Share % {remainingShare < 100 ? `(max ${remainingShare}%)` : ''}</span>
                  <input className="field-input" type="number" min="1" max={remainingShare} value={coOwner.share} onChange={(event) => setCoOwner((current) => ({ ...current, share: event.target.value }))} disabled={!canManageOwnership || remainingShare === 0} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Role</span>
                  <select className="field-input" value={coOwner.role} onChange={(event) => setCoOwner((current) => ({ ...current, role: event.target.value as OwnershipStake['role'] }))} disabled={!canManageOwnership}>
                    {ownershipRoles.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Contact</span>
                  <input className="field-input" value={coOwner.contact} onChange={(event) => setCoOwner((current) => ({ ...current, contact: event.target.value }))} disabled={!canManageOwnership} />
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
                  disabled={!canManageOwnership}
                >
                  Add co-owner
                </button>
              </div>
            </>
          ) : (
            <EmptyState compact title="No horse selected" description="Choose a transfer record first." />
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
              <textarea className="field-textarea" rows={4} value={auditNote} onChange={(event) => setAuditNote(event.target.value)} disabled={!canManageOwnership} />
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
                  disabled={!canManageOwnership}
                >
                  Save audit note
                </button>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState title="No ownership record loaded" description="Select a transfer record to review notes." />
        )}
      </Panel>

      <ContextMenu open={Boolean(menuRecord)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
