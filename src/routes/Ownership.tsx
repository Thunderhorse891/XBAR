import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { ActionMenuButton } from '@/components/InteractionSystem';
import { MetricCard, Pill } from '@/components/app-ui';
import { DotsIcon } from '@/components/icons';
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

const ownershipProofGroups: Array<{ label: string; type: DocumentType; copy: string }> = [
  { label: 'Bill of sale', type: 'Bill of Sale', copy: 'Commercial proof of transaction and buyer/seller intent.' },
  { label: 'Registration', type: 'Registration', copy: 'Registry identity, legal name, markings, and ownership reference.' },
  { label: 'Transfer agreement', type: 'Transfer Packet', copy: 'Signed transfer packet, pending registry review, or buyer handoff.' },
  { label: 'Ownership memo', type: 'Ownership Memo', copy: 'Internal notes, lien context, special terms, or provenance memo.' },
];

function cleanPendingDocuments(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

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
  const openRightDrawer = useUiStore((state) => state.openRightDrawer);
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

  const ownershipDocuments = useMemo(() => documents.filter((document) => ownershipDocumentTypes.includes(document.type)), [documents]);
  const relationshipRows = useMemo<RelationshipRow[]>(() => createRelationshipRows(horses, ownershipRecords, documents), [documents, horses, ownershipRecords]);
  const ownerRegistry = useMemo<OwnerRegistryRow[]>(() => createOwnerRegistry(relationshipRows), [relationshipRows]);
  const filteredRows = useMemo(() => filterAndSortRelationshipRows(relationshipRows, query, statusFilter, sortMode), [query, relationshipRows, sortMode, statusFilter]);

  const selectedRecord = ownershipRecords.find((record) => record.id === selectedRecordId) ?? ownershipRecords[0];
  const selectedHorse = horses.find((horse) => horse.id === selectedRecord?.horseId);
  const selectedRelationship = selectedHorse ? relationshipRows.find((row) => row.horse.id === selectedHorse.id) : undefined;
  const selectedHorseTotalShare = selectedHorse ? selectedHorse.ownership.reduce((sum, stake) => sum + stake.share, 0) : 0;
  const remainingShare = Math.max(0, 100 - selectedHorseTotalShare);
  const selectedHorseDocuments = selectedHorse ? ownershipDocsForHorse(documents, selectedHorse.id) : [];
  const selectedReadyProofCount = selectedHorseDocuments.filter((document) => document.state === 'Ready').length;
  const selectedOpenRequirements = selectedRelationship?.pendingDocuments.length ?? selectedRecord?.pendingDocuments.length ?? 0;
  const pendingTransfers = getPendingTransfers(ownershipRecords);
  const missingDocumentRows = getMissingDocumentRows(relationshipRows);
  const horsesWithOwnership = getHorsesWithOwnership(relationshipRows);
  const menuRecord = menuState?.type === 'record' ? ownershipRecords.find((record) => record.id === menuState.recordId) : undefined;
  const menuHorse = horses.find((horse) => horse.id === menuRecord?.horseId);
  const latestOwnershipDocuments = getLatestOwnershipDocuments(documents, ownershipDocumentTypes);
  const titleReadiness = selectedRecord?.transferStatus === 'Clear' && selectedOpenRequirements === 0 ? 'Release-ready' : 'Controlled hold';

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

  const openOwnershipDetails = (recordId: string) => {
    const record = ownershipRecords.find((item) => item.id === recordId);
    const horse = horses.find((item) => item.id === record?.horseId);
    if (!record || !horse) return;

    openRightDrawer({
      id: `ownership-record-${record.id}`,
      eyebrow: 'Title & Transfer',
      title: horse.name,
      description: record.pendingDocuments.length
        ? `${record.pendingDocuments.length} proof requirement${record.pendingDocuments.length === 1 ? '' : 's'} still open before release.`
        : 'Chain of title is clear for this command file.',
      facts: [
        { label: 'Legal owner', value: record.legalOwner },
        { label: 'Transfer status', value: record.transferStatus },
        { label: 'Target date', value: formatDateLabel(record.complianceDeadline) },
        { label: 'Confidence', value: `${record.confidence}%` },
      ],
      actions: [
        { label: 'Open command file', path: `/horses/${horse.id}` },
        { label: 'Open proof vault', path: '/documents' },
      ],
    });
  };

  const menuItems = menuRecord
    ? [
        { id: 'quick-view', label: 'Quick title review', onSelect: () => openOwnershipDetails(menuRecord.id) },
        ...(menuHorse ? [{ id: 'open-horse', label: 'Open command file', onSelect: () => navigate(`/horses/${menuHorse.id}`) }] : []),
        ...(canManageOwnership
          ? [
              {
                id: 'mark-clear',
                label: 'Mark title clear',
                onSelect: () => {
                  const result = updateOwnershipRecord(menuRecord.id, { transferStatus: 'Clear' });
                  pushToast({ title: result.ok ? 'Title updated' : 'Title update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                },
              },
              {
                id: 'mark-aqha',
                label: 'Route to registry review',
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
          { id: 'upload-document', label: 'Upload proof record', onSelect: () => navigate('/documents?upload=1') },
          { id: 'open-documents', label: 'Open proof vault', onSelect: () => navigate('/documents') },
        ]
      : [];

  const openSectionMenu = (sectionId: 'registry' | 'relationships' | 'timeline' | 'documents', event: MouseEvent) => {
    event.preventDefault();
    setMenuState({ type: 'section', sectionId, x: event.clientX, y: event.clientY });
  };

  const saveTransfer = () => {
    if (!selectedRecord) return;

    if (!legalOwner.trim() || !complianceDeadline.trim()) {
      setFormError('Legal owner and target date are required before this record can move.');
      return;
    }

    if (transferStatus === 'Clear' && cleanPendingDocuments(pendingDocuments).length) {
      setFormError('Clear status requires all listed proof gaps to be removed first.');
      return;
    }

    const result = updateOwnershipRecord(selectedRecord.id, {
      legalOwner: legalOwner.trim(),
      transferStatus,
      complianceDeadline,
      pendingDocuments: cleanPendingDocuments(pendingDocuments),
    });

    pushToast({ title: result.ok ? 'Title record updated' : 'Title update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) setFormError('');
  };

  const saveAuditNote = () => {
    if (!selectedRecord) return;
    const note = auditNote.trim();
    if (!note) {
      setFormError('Audit note cannot be blank.');
      return;
    }

    const result = addOwnershipAuditEntry(selectedRecord.id, note);
    pushToast({ title: result.ok ? 'Audit note added' : 'Audit note blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) {
      setAuditNote('');
      setFormError('');
    }
  };

  const addCoOwner = () => {
    if (!selectedHorse) return;
    const share = Number(coOwner.share);
    if (!coOwner.name.trim() || !Number.isFinite(share) || share <= 0 || share > remainingShare) {
      setFormError(`Owner name and a valid share from 1-${remainingShare}% are required.`);
      return;
    }

    const result = addOwnershipStake(selectedHorse.id, {
      name: coOwner.name.trim(),
      share,
      role: coOwner.role,
      contact: coOwner.contact.trim(),
    });

    pushToast({ title: result.ok ? 'Owner added' : 'Owner blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) {
      setCoOwner({ name: '', share: '25', role: 'Co-Owner', contact: '' });
      setFormError('');
    }
  };

  return (
    <div className="ownership-ops">
      <div className="surface-hero surface-hero--dark ownership-legal-brief">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Title & Transfer</span>
            <h1>Legal proof desk for chain-of-title control.</h1>
            <p>
              Control ownership, title readiness, stakeholder share, registry review, transfer blockers, and release evidence before a horse moves into buyer-facing workflow.
            </p>
          </div>
          <div className="surface-hero__actions">
            <button className="button button--primary" type="button" onClick={() => scrollToSection('ownership-relationships')}>
              Review chain of title
            </button>
            <button className="button button--ghost" type="button" onClick={() => scrollToSection('ownership-transfer-editor')} disabled={!canManageOwnership || !selectedRecord}>
              Edit transfer hold
            </button>
            <button className="button button--ghost" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>
              Upload proof
            </button>
          </div>
        </div>
        <div className="ownership-proof-strip">
          <span><strong>{titleReadiness}</strong><small>{selectedHorse?.name ?? 'No command file selected'}</small></span>
          <span><strong>{selectedReadyProofCount}</strong><small>ready proof files on selected record</small></span>
          <span><strong>{selectedOpenRequirements}</strong><small>open proof requirements</small></span>
          <span><strong>{selectedRecord?.confidence ?? 0}%</strong><small>record confidence</small></span>
        </div>
      </div>

      <div className="ownership-metric-grid">
        <MetricCard label="Registry entities" value={`${ownerRegistry.length}`} detail="People and entities in the ownership index" tone="slate" className="ownership-metric-card" onClick={() => scrollToSection('ownership-registry')} />
        <MetricCard label="Command files linked" value={`${horsesWithOwnership}/${horses.length}`} detail="Horses with title records attached" tone="blue" className="ownership-metric-card" onClick={() => scrollToSection('ownership-relationships')} />
        <MetricCard label="Controlled holds" value={`${pendingTransfers.length}`} detail="Open signatures, registry review, or transfer proof" tone={pendingTransfers.length ? 'amber' : 'emerald'} className="ownership-metric-card" onClick={() => scrollToSection('ownership-transfer-timeline')} />
        <MetricCard label="Proof gaps" value={`${missingDocumentRows.length}`} detail="Rows missing bill, registration, or transfer evidence" tone={missingDocumentRows.length ? 'rose' : 'emerald'} className="ownership-metric-card" onClick={() => scrollToSection('ownership-document-vault')} />
      </div>

      <section className="ownership-command-panel" aria-label="Title and transfer search and filters">
        <div>
          <span className="section-eyebrow">Title control</span>
          <h2>Find the file, verify the legal owner, resolve the blocker, release the transfer.</h2>
        </div>
        <div className="ownership-toolbar">
          <label className="ownership-search">
            <span className="sr-only">Search title and transfer records</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search horse, owner, stakeholder, registry status, proof gap..." />
          </label>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as TransferStatus | 'All')} aria-label="Filter by transfer status">
            <option value="All">All transfer states</option>
            {transferStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
          <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="Sort ownership rows">
            <option value="Deadline">Priority by deadline</option>
            <option value="Horse">Command file</option>
            <option value="Status">Transfer state</option>
            <option value="Confidence">Record confidence</option>
          </select>
        </div>
      </section>

      <div className="ownership-workspace">
        <section id="ownership-registry" className="ownership-panel" onContextMenu={(event) => openSectionMenu('registry', event)}>
          <div className="ownership-section-heading">
            <div><span className="section-eyebrow">Entity registry</span><h2>People and business entities tied to command files</h2></div>
            <Pill tone="blue">{ownerRegistry.length} entities</Pill>
          </div>

          {ownerRegistry.length ? (
            <div className="ownership-registry-grid">
              {ownerRegistry.map((owner) => (
                <article key={owner.name} className="ownership-owner-card">
                  <div className="ownership-owner-card__top">
                    <div><h3>{owner.name}</h3><p>{owner.contact || 'Contact details not recorded'}</p></div>
                    <Pill tone={owner.statuses.some((status) => status !== 'Clear') ? 'amber' : 'emerald'}>{owner.statuses.some((status) => status !== 'Clear') ? 'Open control point' : 'Clear'}</Pill>
                  </div>
                  <div className="ownership-owner-card__meta">
                    <span>{owner.horses.length} command file{owner.horses.length === 1 ? '' : 's'}</span>
                    <span>{owner.roles.join(', ')}</span>
                    <span>{owner.shares.length ? `${Math.round(owner.shares.reduce((sum, share) => sum + share, 0) / owner.shares.length)}% avg share` : 'Share pending'}</span>
                  </div>
                  <div className="token-row">{owner.horses.slice(0, 4).map((horseName) => <Pill key={horseName} tone="slate">{horseName}</Pill>)}</div>
                </article>
              ))}
            </div>
          ) : (
            <div className="ownership-empty-state">
              <EmptyState title="No legal entities indexed yet" description="Create a horse command file, add legal owner details, then attach the proof that supports the record." />
              <button className="button button--primary" type="button" onClick={() => navigate('/horses?new=1')}>Create command file</button>
            </div>
          )}
        </section>

        <aside id="ownership-owner-editor" className="ownership-panel ownership-editor-panel">
          <div className="ownership-section-heading ownership-section-heading--compact">
            <div><span className="section-eyebrow">Stakeholder control</span><h2>Add a stakeholder to the selected command file</h2></div>
            {selectedHorse ? <Pill tone="blue">{selectedHorse.name}</Pill> : null}
          </div>

          {selectedHorse ? (
            <>
              {selectedHorse.ownership.length > 0 ? (
                <div className="ownership-stake-list">
                  <span className="field-label">{selectedHorseTotalShare}% allocated · {remainingShare}% remaining</span>
                  {selectedHorse.ownership.map((stake) => (
                    <div key={stake.id} className="ownership-stake-row">
                      <div className="ownership-stake-row__info"><strong>{stake.name}</strong><span>{stake.share}% · {stake.role}</span>{stake.contact ? <small>{stake.contact}</small> : null}</div>
                      {canManageOwnership ? <button className="button button--ghost button--compact" type="button" onClick={() => { const result = removeOwnershipStake(selectedHorse.id, stake.id); pushToast({ title: result.ok ? 'Stakeholder removed' : 'Remove blocked', message: result.message, tone: result.ok ? 'success' : 'error' }); }}>Remove</button> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {remainingShare > 0 ? (
                <>
                  <div className="form-grid form-grid--tight">
                    <label className="field-stack field-stack--wide"><span className="field-label">Stakeholder / entity name</span><input className="field-input" value={coOwner.name} onChange={(event) => setCoOwner((current) => ({ ...current, name: event.target.value }))} disabled={!canManageOwnership} /></label>
                    <label className="field-stack"><span className="field-label">Share (max {remainingShare}%)</span><input className="field-input" type="number" min="1" max={remainingShare} value={coOwner.share} onChange={(event) => setCoOwner((current) => ({ ...current, share: event.target.value }))} disabled={!canManageOwnership} /></label>
                    <label className="field-stack"><span className="field-label">Role</span><select className="field-input" value={coOwner.role} onChange={(event) => setCoOwner((current) => ({ ...current, role: event.target.value as OwnershipStake['role'] }))} disabled={!canManageOwnership}>{ownershipRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
                    <label className="field-stack field-stack--wide"><span className="field-label">Contact / authority note</span><input className="field-input" value={coOwner.contact} onChange={(event) => setCoOwner((current) => ({ ...current, contact: event.target.value }))} disabled={!canManageOwnership} /></label>
                  </div>
                  <button className="button button--primary ownership-full-button" type="button" onClick={addCoOwner} disabled={!canManageOwnership}>Add stakeholder to title record</button>
                </>
              ) : <p className="ownership-full-note">All shares are allocated. Remove an existing stakeholder to reallocate title share.</p>}
            </>
          ) : <EmptyState compact title="No command file selected" description="Select a title row before adding stakeholder details." />}
        </aside>
      </div>

      <section id="ownership-relationships" className="ownership-panel" onContextMenu={(event) => openSectionMenu('relationships', event)}>
        <div className="ownership-section-heading">
          <div><span className="section-eyebrow">Chain-of-title matrix</span><h2>Legal owner, stakeholder share, transfer state, and release evidence</h2></div>
          <Pill tone={filteredRows.length ? 'blue' : 'slate'}>{filteredRows.length} rows</Pill>
        </div>

        {filteredRows.length ? (
          <div className="ownership-table" role="table" aria-label="Title and transfer matrix">
            <div className="ownership-table__head" role="row"><span>Command file</span><span>Legal owner</span><span>Share</span><span>Transfer state</span><span>Release evidence</span></div>
            {filteredRows.map((row) => (
              <div key={row.horse.id} className="ownership-row-shell" role="row">
                <button
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
                        pushToast({ title: 'Title record created', message: result.message, tone: 'success' });
                      } else if (!result.ok) {
                        pushToast({ title: 'Could not create title record', message: result.message, tone: 'error' });
                      }
                    }
                  }}
                  onContextMenu={(event) => {
                    if (!row.record) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setMenuState({ type: 'record', recordId: row.record.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <span><strong>{row.horse.name}</strong>{row.horse.barnName ? <small>{row.horse.barnName}</small> : null}</span>
                  <span><strong>{row.currentOwner}</strong><small>{row.horse.ownership.length} stakeholder{row.horse.ownership.length === 1 ? '' : 's'}</small></span>
                  <span><strong>{row.totalShare || 0}%</strong><small>{row.totalShare === 100 ? 'Balanced' : row.totalShare > 100 ? 'Overallocated' : 'Needs allocation'}</small></span>
                  <span><Pill tone={transferTone(row.status)}>{row.status}</Pill>{row.deadline ? <small>Target {formatDateLabel(row.deadline)}</small> : <small>No target date</small>}</span>
                  <span><strong>{row.billOfSaleCount + row.registrationCount + row.transferDocCount} files</strong><small>{row.pendingDocuments.length ? row.pendingDocuments.slice(0, 2).join(', ') : 'Evidence on file'}</small></span>
                </button>
                {row.record ? <ActionMenuButton className="ownership-row-shell__menu icon-button icon-button--compact" label={`Open title actions for ${row.horse.name}`} onOpen={(x, y) => setMenuState({ type: 'record', recordId: row.record!.id, x, y })}><DotsIcon className="icon-button__icon" /></ActionMenuButton> : null}
              </div>
            ))}
          </div>
        ) : relationshipRows.length ? (
          <EmptyState compact title="No title rows match" description="Clear the search or choose a different transfer state." />
        ) : (
          <div className="ownership-empty-state"><EmptyState title="No chain-of-title matrix yet" description="Create a command file, add a legal owner, and upload proof records to begin title control." /><button className="button button--primary" type="button" onClick={() => navigate('/horses?new=1')}>Create command file</button></div>
        )}
      </section>

      <div className="ownership-workspace ownership-workspace--timeline">
        <section id="ownership-transfer-editor" className="ownership-panel ownership-editor-panel">
          <div className="ownership-section-heading ownership-section-heading--compact">
            <div><span className="section-eyebrow">Transfer hold editor</span><h2>{selectedHorse ? `${selectedHorse.name} title posture` : 'Transfer record'}</h2></div>
            {selectedRecord ? <Pill tone={transferTone(selectedRecord.transferStatus)}>{selectedRecord.transferStatus}</Pill> : null}
          </div>

          {selectedRecord ? (
            <>
              <div className="form-grid form-grid--tight">
                <label className="field-stack"><span className="field-label">Legal owner of record</span><input className="field-input" value={legalOwner} onChange={(event) => setLegalOwner(event.target.value)} disabled={!canManageOwnership} /></label>
                <label className="field-stack"><span className="field-label">Transfer state</span><select className="field-input" value={transferStatus} onChange={(event) => setTransferStatus(event.target.value as TransferStatus)} disabled={!canManageOwnership}>{transferStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
                <label className="field-stack"><span className="field-label">Target date</span><input className="field-input" type="date" value={complianceDeadline} onChange={(event) => setComplianceDeadline(event.target.value)} disabled={!canManageOwnership} /></label>
                <label className="field-stack field-stack--wide"><span className="field-label">Open proof requirements</span><input className="field-input" value={pendingDocuments} onChange={(event) => setPendingDocuments(event.target.value)} placeholder="Bill of sale, signed transfer, registry confirmation" disabled={!canManageOwnership} /></label>
              </div>
              {formError ? <div className="field-error">{formError}</div> : null}
              <button className="button button--primary ownership-full-button" type="button" onClick={saveTransfer} disabled={!canManageOwnership}>Save title posture</button>
            </>
          ) : <EmptyState compact title="No title record selected" description="Choose a command file from the matrix to edit its transfer posture." />}
        </section>

        <section id="ownership-transfer-timeline" className="ownership-panel" onContextMenu={(event) => openSectionMenu('timeline', event)}>
          <div className="ownership-section-heading ownership-section-heading--compact">
            <div><span className="section-eyebrow">Evidence chronology</span><h2>Current owner, acquisition context, proof count, and audit trail</h2></div>
            {selectedRelationship ? <Pill tone={transferTone(selectedRelationship.status)}>{selectedRelationship.status}</Pill> : null}
          </div>

          {selectedRecord ? (
            <div className="ownership-timeline-layout">
              <div className="ownership-transfer-summary">
                <div><span>Current owner</span><strong>{selectedRelationship?.currentOwner ?? selectedRecord.legalOwner}</strong></div>
                <div><span>Prior owner</span><strong>{selectedRecord.auditTrail[0] ? 'See audit trail' : 'Not recorded'}</strong></div>
                <div><span>Acquisition date</span><strong>{formatDateLabel(selectedRelationship?.acquisitionDate ?? '')}</strong></div>
                <div><span>Proof files</span><strong>{selectedHorseDocuments.length}</strong></div>
              </div>

              <div className="ownership-timeline">
                {selectedRecord.auditTrail.length ? selectedRecord.auditTrail.map((entry, index) => <div key={`${entry}-${index}`} className="ownership-timeline__item"><span /><p>{entry}</p></div>) : <EmptyState compact title="No audit trail yet" description="Title notes will appear here when ownership work changes." />}
              </div>

              <div className="ownership-note-box">
                <label className="field-stack"><span className="field-label">Audit note</span><textarea className="field-textarea" rows={5} value={auditNote} onChange={(event) => setAuditNote(event.target.value)} placeholder="Record transfer decision, registry status, bill-of-sale issue, lien note, or buyer release condition." disabled={!canManageOwnership} /></label>
                <button className="button button--ghost ownership-full-button" type="button" onClick={saveAuditNote} disabled={!canManageOwnership}>Save audit note</button>
              </div>
            </div>
          ) : <EmptyState title="No title record loaded" description="Select a command file to review the chain of title." />}
        </section>
      </div>

      <section id="ownership-document-vault" className="ownership-panel" onContextMenu={(event) => openSectionMenu('documents', event)}>
        <div className="ownership-section-heading">
          <div><span className="section-eyebrow">Release evidence</span><h2>Bills of sale, registrations, transfer packets, and ownership memoranda</h2></div>
          <button className="button button--primary button--compact" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>Upload proof</button>
        </div>

        <div className="ownership-document-groups">
          {ownershipProofGroups.map((group) => {
            const groupDocs = selectedHorse ? selectedHorseDocuments.filter((document) => document.type === group.type) : ownershipDocuments.filter((document) => document.type === group.type);
            return (
              <article key={group.type} className="ownership-document-group">
                <div className="ownership-document-group__top"><h3>{group.label}</h3><Pill tone={groupDocs.length ? 'blue' : 'slate'}>{groupDocs.length || 'Missing'}</Pill></div>
                <p>{group.copy}</p>
                {groupDocs.length ? (
                  <div className="stack-list">
                    {groupDocs.slice(0, 3).map((document) => {
                      const horse = horses.find((item) => item.id === document.horseId);
                      return <div key={document.id} className="ownership-document-row"><div><strong>{document.title}</strong><span>{horse?.name ?? document.entities.horseName ?? 'Unassigned'} | {formatDateTimeLabel(document.uploadedAt)}</span></div><Pill tone={documentTone(document)}>{document.state}</Pill></div>;
                    })}
                  </div>
                ) : <p>Attach the evidence required to release this part of the record.</p>}
              </article>
            );
          })}
        </div>

        {latestOwnershipDocuments.length ? (
          <div className="ownership-latest-docs">
            {latestOwnershipDocuments.map((document) => {
              const horse = horses.find((item) => item.id === document.horseId);
              return <button key={document.id} className="ownership-latest-doc" type="button" onClick={() => navigate('/documents')}><span>{document.type}</span><strong>{document.title}</strong><small>{horse?.name ?? document.entities.horseName ?? 'Unassigned'}</small></button>;
            })}
          </div>
        ) : (
          <div className="ownership-empty-state ownership-empty-state--compact"><EmptyState compact title="No title proof uploaded" description="Start with bill of sale, registration, and transfer packet for the highest-value command files." /></div>
        )}
      </section>

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </div>
  );
}
