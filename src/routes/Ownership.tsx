import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Pill } from '@/components/app-ui';
import { formatDateLabel, formatDateTimeLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { DocumentType, OwnershipStake, TransferStatus } from '@/types/xbar';
import { ownershipDocumentTypes, ownershipRoles, transferStatuses } from '@/features/ownership/constants';
import type { SortMode } from '@/features/ownership/constants';
import { documentTone, ownershipDocsForHorse, scrollToSection, transferTone } from '@/features/ownership/helpers';
import { createOwnerRegistry, createRelationshipRows, filterAndSortRelationshipRows, getMissingDocumentRows, getHorsesWithOwnership, getLatestOwnershipDocuments, getPendingTransfers } from '@/features/ownership/selectors';
import type { OwnerRegistryRow, RelationshipRow } from '@/features/ownership/types';
import './ownershipExperience.css';


type MenuState =
  | { type: 'record'; recordId: string; x: number; y: number }
  | { type: 'section'; sectionId: 'registry' | 'relationships' | 'timeline' | 'documents'; x: number; y: number }
  | null;

export default function Ownership() {
  const navigate = useNavigate();
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const updateOwnershipRecord = useXbarStore((state) => state.updateOwnershipRecord);
  const addOwnershipAuditEntry = useXbarStore((state) => state.addOwnershipAuditEntry);
  const addOwnershipStake = useXbarStore((state) => state.addOwnershipStake);
  const removeOwnershipStake = useXbarStore((state) => state.removeOwnershipStake);
  const ensureOwnershipRecord = useXbarStore((state) => state.ensureOwnershipRecord);
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageOwnership = useCurrentRoleCapability('manageOwnership');
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');

  const [selectedRecordId, setSelectedRecordId] = useState(ownershipRecords[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'All'>('All');
  const [sortMode, setSortMode] = useState<SortMode>('Deadline');
  const [legalOwner, setLegalOwner] = useState('');
  const [transferStatus, setTransferStatus] = useState<TransferStatus>('Attention Required');
  const [complianceDeadline, setComplianceDeadline] = useState('');
  const [pendingDocuments, setPendingDocuments] = useState('');
  const [auditNote, setAuditNote] = useState('');
  const [coOwner, setCoOwner] = useState({ name: '', share: '25', role: 'Co-Owner' as OwnershipStake['role'], contact: '' });
  const [formError, setFormError] = useState('');
  const [menuState, setMenuState] = useState<MenuState>(null);
  const ownershipDocuments = useMemo(
    () => documents.filter((document) => ownershipDocumentTypes.includes(document.type)),
    [documents],
  );

  const relationshipRows = useMemo<RelationshipRow[]>(
    () => createRelationshipRows(horses, ownershipRecords, documents),
    [documents, horses, ownershipRecords],
  );

  const selectedRecord = ownershipRecords.find((record) => record.id === selectedRecordId) ?? ownershipRecords[0];
  const selectedHorse = horses.find((horse) => horse.id === selectedRecord?.horseId);
  const selectedRelationship = selectedHorse ? relationshipRows.find((row) => row.horse.id === selectedHorse.id) : undefined;
  const selectedHorseTotalShare = selectedHorse ? selectedHorse.ownership.reduce((sum, s) => sum + s.share, 0) : 0;
  const remainingShare = Math.max(0, 100 - selectedHorseTotalShare);

  useEffect(() => {
    if (!ownershipRecords.length) {
      setSelectedRecordId('');
      return;
    }

    if (!selectedRecordId || !ownershipRecords.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(ownershipRecords[0].id);
    }
  }, [ownershipRecords, selectedRecordId]);

  useEffect(() => {
    if (!selectedRecord) {
      setLegalOwner('');
      setTransferStatus('Attention Required');
      setComplianceDeadline('');
      setPendingDocuments('');
      return;
    }

    setLegalOwner(selectedRecord.legalOwner);
    setTransferStatus(selectedRecord.transferStatus);
    setComplianceDeadline(selectedRecord.complianceDeadline);
    setPendingDocuments(selectedRecord.pendingDocuments.join(', '));
  }, [selectedRecord]);

  const ownerRegistry = useMemo<OwnerRegistryRow[]>(
    () => createOwnerRegistry(relationshipRows),
    [relationshipRows],
  );

  const filteredRows = useMemo(
    () => filterAndSortRelationshipRows(relationshipRows, query, statusFilter, sortMode),
    [query, relationshipRows, sortMode, statusFilter],
  );

  const selectedHorseDocuments = selectedHorse ? ownershipDocsForHorse(documents, selectedHorse.id) : [];
  const pendingTransfers = getPendingTransfers(ownershipRecords);
  const missingDocumentRows = getMissingDocumentRows(relationshipRows);
  const horsesWithOwnership = getHorsesWithOwnership(relationshipRows);
  const menuRecord = menuState?.type === 'record' ? ownershipRecords.find((record) => record.id === menuState.recordId) : undefined;
  const menuHorse = horses.find((horse) => horse.id === menuRecord?.horseId);
  const latestOwnershipDocuments = getLatestOwnershipDocuments(documents, ownershipDocumentTypes);

  const menuItems =
    menuRecord
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
      : menuState?.type === 'section'
        ? [
            {
              id: 'upload-document',
              label: 'Upload ownership document',
              onSelect: () => navigate('/documents?upload=1'),
            },
            {
              id: 'open-documents',
              label: 'Open documents',
              onSelect: () => navigate('/documents'),
            },
          ]
        : [];

  const openSectionMenu = (sectionId: 'registry' | 'relationships' | 'timeline' | 'documents', event: MouseEvent) => {
    event.preventDefault();
    setMenuState({ type: 'section', sectionId, x: event.clientX, y: event.clientY });
  };

  const saveTransfer = () => {
    if (!selectedRecord) {
      return;
    }

    if (!legalOwner.trim() || !complianceDeadline.trim()) {
      setFormError('Legal owner and target date are required.');
      return;
    }

    const result = updateOwnershipRecord(selectedRecord.id, {
      legalOwner,
      transferStatus,
      complianceDeadline,
      pendingDocuments: pendingDocuments
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    });

    pushToast({
      title: result.ok ? 'Ownership updated' : 'Ownership update blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });

    if (result.ok) {
      setFormError('');
    }
  };

  const saveAuditNote = () => {
    if (!selectedRecord) {
      return;
    }

    const result = addOwnershipAuditEntry(selectedRecord.id, auditNote);
    pushToast({
      title: result.ok ? 'Transfer note added' : 'Transfer note blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });

    if (result.ok) {
      setAuditNote('');
    }
  };

  const addCoOwner = () => {
    if (!selectedHorse) {
      return;
    }

    const result = addOwnershipStake(selectedHorse.id, {
      name: coOwner.name,
      share: Number(coOwner.share),
      role: coOwner.role,
      contact: coOwner.contact,
    });
    pushToast({
      title: result.ok ? 'Owner added' : 'Owner blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });

    if (result.ok) {
      setCoOwner({ name: '', share: '25', role: 'Co-Owner', contact: '' });
    }
  };

  return (
    <div className="ownership-ops">
      <PageHeader
        eyebrow="Ownership"
        title="Owner Records"
        actions={
          <>
            <button className="button button--primary" type="button" onClick={() => scrollToSection('ownership-owner-editor')} disabled={!canManageOwnership}>
              Add owner
            </button>
            <button className="button button--ghost" type="button" onClick={() => scrollToSection('ownership-transfer-editor')} disabled={!canManageOwnership || !selectedRecord}>
              Add transfer
            </button>
            <button className="button button--ghost" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>
              Upload document
            </button>
          </>
        }
      />

      <div className="ownership-metric-grid">
        <MetricCard label="Owners" value={`${ownerRegistry.length}`} detail="People and entities on file" tone="slate" className="ownership-metric-card" onClick={() => scrollToSection('ownership-registry')} />
        <MetricCard label="Linked horses" value={`${horsesWithOwnership}/${horses.length}`} detail="Horses with ownership records" tone="blue" className="ownership-metric-card" onClick={() => scrollToSection('ownership-relationships')} />
        <MetricCard label="Open transfers" value={`${pendingTransfers.length}`} detail="Signatures, review, or proof still open" tone={pendingTransfers.length ? 'amber' : 'emerald'} className="ownership-metric-card" onClick={() => scrollToSection('ownership-transfer-timeline')} />
        <MetricCard label="Missing documents" value={`${missingDocumentRows.length}`} detail="Rows with bill, registration, or transfer gaps" tone={missingDocumentRows.length ? 'rose' : 'emerald'} className="ownership-metric-card" onClick={() => scrollToSection('ownership-document-vault')} />
      </div>

      <section className="ownership-command-panel" aria-label="Ownership search and filters">
        <div>
          <span className="section-eyebrow">Ownership control</span>
          <h2>Find the record, verify the owner, move the transfer</h2>
        </div>
        <div className="ownership-toolbar">
          <label className="ownership-search">
            <span className="sr-only">Search ownership records</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search horse, owner, contact, document gap..." />
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TransferStatus | 'All')} aria-label="Filter by transfer status">
            <option value="All">All statuses</option>
            {transferStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort ownership rows">
            <option value="Deadline">Sort by deadline</option>
            <option value="Horse">Sort by horse</option>
            <option value="Status">Sort by status</option>
            <option value="Confidence">Sort by confidence</option>
          </select>
        </div>
      </section>

      <div className="ownership-workspace">
        <section id="ownership-registry" className="ownership-panel" onContextMenu={(event) => openSectionMenu('registry', event)}>
          <div className="ownership-section-heading">
            <div>
              <span className="section-eyebrow">Owner registry</span>
              <h2>People and entities tied to horses</h2>
            </div>
            <Pill tone="blue">{ownerRegistry.length} records</Pill>
          </div>

          {ownerRegistry.length ? (
            <div className="ownership-registry-grid">
              {ownerRegistry.map((owner) => (
                <article key={owner.name} className="ownership-owner-card">
                  <div className="ownership-owner-card__top">
                    <div>
                      <h3>{owner.name}</h3>
                      <p>{owner.contact || 'Contact details not recorded'}</p>
                    </div>
                    <Pill tone={owner.statuses.some((status) => status !== 'Clear') ? 'amber' : 'emerald'}>
                      {owner.statuses.some((status) => status !== 'Clear') ? 'Open work' : 'Clear'}
                    </Pill>
                  </div>
                  <div className="ownership-owner-card__meta">
                    <span>{owner.horses.length} horse{owner.horses.length === 1 ? '' : 's'}</span>
                    <span>{owner.roles.join(', ')}</span>
                    <span>{owner.shares.length ? `${Math.round(owner.shares.reduce((sum, share) => sum + share, 0) / owner.shares.length)}% avg share` : 'Share pending'}</span>
                  </div>
                  <div className="token-row">
                    {owner.horses.slice(0, 4).map((horseName) => (
                      <Pill key={horseName} tone="slate">{horseName}</Pill>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="ownership-empty-state">
              <EmptyState title="Start by adding an owner, linking a horse, and uploading the documents that prove the record." description="Owner names, shares, and transfer notes will appear here once the first horse record exists." />
              <button className="button button--primary" type="button" onClick={() => navigate('/horses?new=1')}>
                Add first horse
              </button>
            </div>
          )}
        </section>

        <aside id="ownership-owner-editor" className="ownership-panel ownership-editor-panel">
          <div className="ownership-section-heading ownership-section-heading--compact">
            <div>
              <span className="section-eyebrow">Contact details</span>
              <h2>Add an owner to the selected horse</h2>
            </div>
            {selectedHorse ? <Pill tone="blue">{selectedHorse.name}</Pill> : null}
          </div>

          {selectedHorse ? (
            <>
              {selectedHorse.ownership.length > 0 && (
                <div className="ownership-stake-list">
                  <span className="field-label">{selectedHorseTotalShare}% allocated · {remainingShare}% remaining</span>
                  {selectedHorse.ownership.map((stake) => (
                    <div key={stake.id} className="ownership-stake-row">
                      <div className="ownership-stake-row__info">
                        <strong>{stake.name}</strong>
                        <span>{stake.share}% · {stake.role}</span>
                        {stake.contact ? <small>{stake.contact}</small> : null}
                      </div>
                      {canManageOwnership ? (
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={() => {
                            const result = removeOwnershipStake(selectedHorse.id, stake.id);
                            pushToast({ title: result.ok ? 'Owner removed' : 'Remove blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                          }}
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}

              {remainingShare > 0 ? (
                <>
                  <div className="form-grid form-grid--tight">
                    <label className="field-stack field-stack--wide">
                      <span className="field-label">Owner name</span>
                      <input className="field-input" value={coOwner.name} onChange={(event) => setCoOwner((current) => ({ ...current, name: event.target.value }))} disabled={!canManageOwnership} />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Share (max {remainingShare}%)</span>
                      <input className="field-input" type="number" min="1" max={remainingShare} value={coOwner.share} onChange={(event) => setCoOwner((current) => ({ ...current, share: event.target.value }))} disabled={!canManageOwnership} />
                    </label>
                    <label className="field-stack">
                      <span className="field-label">Role</span>
                      <select className="field-input" value={coOwner.role} onChange={(event) => setCoOwner((current) => ({ ...current, role: event.target.value as OwnershipStake['role'] }))} disabled={!canManageOwnership}>
                        {ownershipRoles.map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field-stack field-stack--wide">
                      <span className="field-label">Contact</span>
                      <input className="field-input" value={coOwner.contact} onChange={(event) => setCoOwner((current) => ({ ...current, contact: event.target.value }))} disabled={!canManageOwnership} />
                    </label>
                  </div>
                  <button className="button button--primary ownership-full-button" type="button" onClick={addCoOwner} disabled={!canManageOwnership}>
                    Add owner to horse
                  </button>
                </>
              ) : (
                <p className="ownership-full-note">All shares allocated. Remove an owner above to reallocate.</p>
              )}
            </>
          ) : (
            <EmptyState compact title="No horse selected" description="Select an ownership row before adding contact details." />
          )}
        </aside>
      </div>

      <section id="ownership-relationships" className="ownership-panel" onContextMenu={(event) => openSectionMenu('relationships', event)}>
        <div className="ownership-section-heading">
          <div>
            <span className="section-eyebrow">Horse to owner relationships</span>
            <h2>Current owner, percentage split, transfer status, and proof</h2>
          </div>
          <Pill tone={filteredRows.length ? 'blue' : 'slate'}>{filteredRows.length} shown</Pill>
        </div>

        {filteredRows.length ? (
          <div className="ownership-table" role="table" aria-label="Horse ownership relationships">
            <div className="ownership-table__head" role="row">
              <span>Horse</span>
              <span>Current owner</span>
              <span>Share</span>
              <span>Status</span>
              <span>Documents</span>
            </div>
            {filteredRows.map((row) => (
              <button
                key={row.horse.id}
                type="button"
                className={`ownership-row${row.record?.id === selectedRecordId ? ' ownership-row--selected' : ''}`}
                onClick={() => {
                  if (row.record) {
                    setSelectedRecordId(row.record.id);
                    setFormError('');
                  } else {
                    const result = ensureOwnershipRecord(row.horse.id);
                    if (result.ok && result.recordId) {
                      setSelectedRecordId(result.recordId);
                      setFormError('');
                      pushToast({ title: 'Ownership record created', message: result.message, tone: 'success' });
                    } else if (!result.ok) {
                      pushToast({ title: 'Could not create record', message: result.message, tone: 'error' });
                    }
                  }
                }}
                onContextMenu={(event) => {
                  if (!row.record) {
                    return;
                  }
                  event.preventDefault();
                  setMenuState({ type: 'record', recordId: row.record.id, x: event.clientX, y: event.clientY });
                }}
              >
                <span>
                  <strong>{row.horse.name}</strong>
                  {row.horse.barnName ? <small>{row.horse.barnName}</small> : null}
                </span>
                <span>
                  <strong>{row.currentOwner}</strong>
                  <small>{row.horse.ownership.length} stakeholder{row.horse.ownership.length === 1 ? '' : 's'}</small>
                </span>
                <span>
                  <strong>{row.totalShare || 0}%</strong>
                  <small>{row.totalShare === 100 ? 'Balanced' : 'Needs review'}</small>
                </span>
                <span>
                  <Pill tone={transferTone(row.status)}>{row.status}</Pill>
                  {row.deadline ? <small>Due {formatDateLabel(row.deadline)}</small> : null}
                </span>
                <span>
                  <strong>{row.billOfSaleCount + row.registrationCount + row.transferDocCount} files</strong>
                  <small>{row.pendingDocuments.length ? row.pendingDocuments.slice(0, 2).join(', ') : 'Proof on file'}</small>
                </span>
              </button>
            ))}
          </div>
        ) : relationshipRows.length ? (
          <EmptyState compact title="No ownership rows match" description="Clear the search or choose a different transfer status." />
        ) : (
          <div className="ownership-empty-state">
            <EmptyState title="Start by adding an owner, linking a horse, and uploading the documents that prove the record." description="The relationship table will show owner shares, sale files, and transfer status once horse records exist." />
            <button className="button button--primary" type="button" onClick={() => navigate('/horses?new=1')}>
              Add first horse
            </button>
          </div>
        )}
      </section>

      <div className="ownership-workspace ownership-workspace--timeline">
        <section id="ownership-transfer-editor" className="ownership-panel ownership-editor-panel">
          <div className="ownership-section-heading ownership-section-heading--compact">
            <div>
              <span className="section-eyebrow">Sale and transfer status</span>
              <h2>{selectedHorse ? `${selectedHorse.name} transfer` : 'Transfer record'}</h2>
            </div>
            {selectedRecord ? <Pill tone={transferTone(selectedRecord.transferStatus)}>{selectedRecord.transferStatus}</Pill> : null}
          </div>

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
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Target date</span>
                  <input className="field-input" type="date" value={complianceDeadline} onChange={(event) => setComplianceDeadline(event.target.value)} disabled={!canManageOwnership} />
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Missing documents</span>
                  <input className="field-input" value={pendingDocuments} onChange={(event) => setPendingDocuments(event.target.value)} disabled={!canManageOwnership} />
                </label>
              </div>
              {formError ? <div className="field-error">{formError}</div> : null}
              <button className="button button--primary ownership-full-button" type="button" onClick={saveTransfer} disabled={!canManageOwnership}>
                Save transfer record
              </button>
            </>
          ) : (
            <EmptyState compact title="No transfer selected" description="Choose a horse ownership row to edit the transfer record." />
          )}
        </section>

        <section id="ownership-transfer-timeline" className="ownership-panel" onContextMenu={(event) => openSectionMenu('timeline', event)}>
          <div className="ownership-section-heading ownership-section-heading--compact">
            <div>
              <span className="section-eyebrow">Transfer history</span>
              <h2>Current owner, previous owner, notes, and audit trail</h2>
            </div>
            {selectedRelationship ? <Pill tone={transferTone(selectedRelationship.status)}>{selectedRelationship.status}</Pill> : null}
          </div>

          {selectedRecord ? (
            <div className="ownership-timeline-layout">
              <div className="ownership-transfer-summary">
                <div>
                  <span>Current owner</span>
                  <strong>{selectedRelationship?.currentOwner ?? selectedRecord.legalOwner}</strong>
                </div>
                <div>
                  <span>Previous owner</span>
                  <strong>Not recorded</strong>
                </div>
                <div>
                  <span>Acquisition date</span>
                  <strong>{formatDateLabel(selectedRelationship?.acquisitionDate ?? '')}</strong>
                </div>
                <div>
                  <span>Proof files</span>
                  <strong>{selectedHorseDocuments.length}</strong>
                </div>
              </div>

              <div className="ownership-timeline">
                {selectedRecord.auditTrail.length ? (
                  selectedRecord.auditTrail.map((entry) => (
                    <div key={entry} className="ownership-timeline__item">
                      <span />
                      <p>{entry}</p>
                    </div>
                  ))
                ) : (
                  <EmptyState compact title="No transfer notes yet" description="Transfer notes will appear here when ownership work changes." />
                )}
              </div>

              <div className="ownership-note-box">
                <label className="field-stack">
                  <span className="field-label">Notes and transfer history</span>
                  <textarea className="field-textarea" rows={5} value={auditNote} onChange={(event) => setAuditNote(event.target.value)} disabled={!canManageOwnership} />
                </label>
                <button className="button button--ghost ownership-full-button" type="button" onClick={saveAuditNote} disabled={!canManageOwnership}>
                  Save transfer note
                </button>
              </div>
            </div>
          ) : (
            <EmptyState title="No ownership record loaded" description="Select a horse to review the transfer chain." />
          )}
        </section>
      </div>

      <section id="ownership-document-vault" className="ownership-panel" onContextMenu={(event) => openSectionMenu('documents', event)}>
        <div className="ownership-section-heading">
          <div>
            <span className="section-eyebrow">Document proof</span>
            <h2>Bills of sale, registrations, transfer agreements, and ownership files</h2>
          </div>
          <button className="button button--primary button--compact" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>
            Upload proof
          </button>
        </div>

        <div className="ownership-document-groups">
          {[
            { label: 'Bill of sale', type: 'Bill of Sale' as DocumentType },
            { label: 'Registration', type: 'Registration' as DocumentType },
            { label: 'Transfer agreement', type: 'Transfer Packet' as DocumentType },
            { label: 'Ownership memo', type: 'Ownership Memo' as DocumentType },
          ].map((group) => {
            const groupDocs = ownershipDocuments.filter((document) => document.type === group.type);
            return (
              <article key={group.type} className="ownership-document-group">
                <div className="ownership-document-group__top">
                  <h3>{group.label}</h3>
                  <Pill tone={groupDocs.length ? 'blue' : 'slate'}>{groupDocs.length || 'Missing'}</Pill>
                </div>
                {groupDocs.length ? (
                  <div className="stack-list">
                    {groupDocs.slice(0, 3).map((document) => {
                      const horse = horses.find((item) => item.id === document.horseId);
                      return (
                        <div key={document.id} className="ownership-document-row">
                          <div>
                            <strong>{document.title}</strong>
                            <span>{horse?.name ?? document.entities.horseName ?? 'Unassigned'} | {formatDateTimeLabel(document.uploadedAt)}</span>
                          </div>
                          <Pill tone={documentTone(document)}>{document.state}</Pill>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p>Upload the file that proves this part of the record.</p>
                )}
              </article>
            );
          })}
        </div>

        {latestOwnershipDocuments.length ? (
          <div className="ownership-latest-docs">
            {latestOwnershipDocuments.map((document) => {
              const horse = horses.find((item) => item.id === document.horseId);
              return (
                <button key={document.id} className="ownership-latest-doc" type="button" onClick={() => navigate('/documents')}>
                  <span>{document.type}</span>
                  <strong>{document.title}</strong>
                  <small>{horse?.name ?? document.entities.horseName ?? 'Unassigned'}</small>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="ownership-empty-state ownership-empty-state--compact">
            <EmptyState compact title="No ownership documents yet" description="Start with the bill of sale, registration, and transfer packet for the horses that matter most." />
          </div>
        )}
      </section>

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </div>
  );
}
