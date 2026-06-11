import { useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandBrief } from '@/components/CommandBrief';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { ActionMenuButton } from '@/components/InteractionSystem';
import { Pill, ProgressBar } from '@/components/app-ui';
import { DotsIcon } from '@/components/icons';
import { formatDateLabel, formatDateTimeLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { normalizeOwnershipRecord } from '@/store/xbarStoreLogic';
import type { OwnershipProofRequirement, OwnershipRecord, OwnershipStake, ProofStatus, TransferStatus } from '@/types/xbar';
import { ownershipRoles, transferStatuses } from '@/features/ownership/constants';
import type { SortMode } from '@/features/ownership/constants';
import { scrollToSection } from '@/features/ownership/helpers';
import { createOwnerRegistry, createRelationshipRows, filterAndSortRelationshipRows } from '@/features/ownership/selectors';
import type { OwnerRegistryRow, RelationshipRow } from '@/features/ownership/types';
import './ownershipExperience.css';

type MenuState =
  | { type: 'record'; recordId: string; x: number; y: number }
  | { type: 'section'; sectionId: 'registry' | 'workspace'; x: number; y: number }
  | null;

const RECORD_WORKSPACE_ID = 'ownership-record-workspace';

// No green anywhere on this route: clear/verified is blue, in-progress is
// amber, blocked/missing is rose.
function statusPillTone(status: TransferStatus): 'blue' | 'amber' | 'rose' {
  if (status === 'Clear' || status === 'AQHA Review') return 'blue';
  if (status === 'Pending Signatures') return 'amber';
  return 'rose';
}

function proofChipTone(status: ProofStatus): 'blue' | 'amber' | 'rose' {
  if (status === 'verified') return 'blue';
  if (status === 'linked') return 'amber';
  return 'rose';
}

function proofChipLabel(status: ProofStatus): string {
  if (status === 'verified') return 'Verified';
  if (status === 'linked') return 'Linked';
  return 'Missing';
}

function isPastDeadline(record: OwnershipRecord): boolean {
  if (record.transferStatus === 'Clear' || !record.complianceDeadline) {
    return false;
  }
  const parsed = Date.parse(record.complianceDeadline);
  return Number.isFinite(parsed) && parsed < Date.now();
}

// Severity ranking used for both the hero status tone and "worst record"
// selection: 2 = blocked (deadline passed / attention), 1 = pending, 0 = clear.
function recordSeverity(record: OwnershipRecord): number {
  if (isPastDeadline(record) || record.transferStatus === 'Attention Required') return 2;
  if (record.transferStatus !== 'Clear') return 1;
  return 0;
}

export default function Ownership() {
  const navigate = useNavigate();
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const currentRole = useXbarStore((state) => state.currentRole);
  const updateOwnershipRecord = useXbarStore((state) => state.updateOwnershipRecord);
  const addOwnershipAuditEntry = useXbarStore((state) => state.addOwnershipAuditEntry);
  const linkOwnershipProof = useXbarStore((state) => state.linkOwnershipProof);
  const verifyOwnershipProof = useXbarStore((state) => state.verifyOwnershipProof);
  const unlinkOwnershipProof = useXbarStore((state) => state.unlinkOwnershipProof);
  const applyTransferStatus = useXbarStore((state) => state.setTransferStatus);
  const addOwnershipStake = useXbarStore((state) => state.addOwnershipStake);
  const removeOwnershipStake = useXbarStore((state) => state.removeOwnershipStake);
  const ensureOwnershipRecord = useXbarStore((state) => state.ensureOwnershipRecord);
  const pushToast = useUiStore((state) => state.pushToast);
  const openRightDrawer = useUiStore((state) => state.openRightDrawer);
  const canManageOwnership = useCurrentRoleCapability('manageOwnership');
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');

  // Legacy persisted records may predate the proof model — normalize before
  // anything renders or computes from them.
  const records = useMemo(() => ownershipRecords.map(normalizeOwnershipRecord), [ownershipRecords]);

  const [selectedRecordId, setSelectedRecordId] = useState(records[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<TransferStatus | 'All'>('All');
  const [sortMode, setSortMode] = useState<SortMode>('Deadline');
  const [legalOwner, setLegalOwner] = useState('');
  const [complianceDeadline, setComplianceDeadline] = useState('');
  const [auditNote, setAuditNote] = useState('');
  const [coOwner, setCoOwner] = useState({ name: '', share: '25', role: 'Co-Owner' as OwnershipStake['role'], contact: '' });
  const [detailsError, setDetailsError] = useState('');
  const [statusError, setStatusError] = useState('');
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [menuState, setMenuState] = useState<MenuState>(null);

  const relationshipRows = useMemo<RelationshipRow[]>(
    () => createRelationshipRows(horses, records, documents),
    [documents, horses, records],
  );

  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? records[0];
  const selectedHorse = horses.find((horse) => horse.id === selectedRecord?.horseId);
  const selectedHorseName = selectedHorse?.name ?? selectedRecord?.legalOwner ?? 'record';
  const selectedHorseTotalShare = selectedHorse ? selectedHorse.ownership.reduce((sum, stake) => sum + stake.share, 0) : 0;
  const remainingShare = Math.max(0, 100 - selectedHorseTotalShare);

  useEffect(() => {
    if (!records.length) {
      setSelectedRecordId('');
      return;
    }
    if (!selectedRecordId || !records.some((record) => record.id === selectedRecordId)) {
      setSelectedRecordId(records[0].id);
    }
  }, [records, selectedRecordId]);

  useEffect(() => {
    setStatusError('');
    setDetailsError('');
    setClearDialogOpen(false);
    if (!selectedRecord) {
      setLegalOwner('');
      setComplianceDeadline('');
      return;
    }
    setLegalOwner(selectedRecord.legalOwner);
    setComplianceDeadline(selectedRecord.complianceDeadline);
  }, [selectedRecord?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownerRegistry = useMemo<OwnerRegistryRow[]>(() => createOwnerRegistry(relationshipRows), [relationshipRows]);
  const filteredRows = useMemo(
    () => filterAndSortRelationshipRows(relationshipRows, query, statusFilter, sortMode),
    [query, relationshipRows, sortMode, statusFilter],
  );

  // ---- Command brief (hero) data -------------------------------------------
  const proofTotals = useMemo(() => {
    let verified = 0;
    let total = 0;
    records.forEach((record) => {
      (record.proofRequirements ?? []).forEach((requirement) => {
        total += 1;
        if (requirement.status === 'verified') verified += 1;
      });
    });
    return { verified, total };
  }, [records]);

  const pendingTransfers = records.filter((record) => record.transferStatus !== 'Clear');
  const heroSeverity = records.reduce((worst, record) => Math.max(worst, recordSeverity(record)), 0);
  const heroStatus = !records.length
    ? { label: 'No records yet', tone: 'steel' as const }
    : heroSeverity === 2
      ? { label: 'Compliance at risk', tone: 'rose' as const }
      : heroSeverity === 1
        ? { label: 'Transfers pending', tone: 'amber' as const }
        : { label: 'Registry clear', tone: 'blue' as const };

  const nextDeadline = pendingTransfers
    .map((record) => record.complianceDeadline)
    .filter((deadline) => Number.isFinite(Date.parse(deadline)))
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];

  const worstRecord = records.length
    ? [...records].sort((left, right) => {
        const severityGap = recordSeverity(right) - recordSeverity(left);
        if (severityGap !== 0) return severityGap;
        return Date.parse(left.complianceDeadline || '9999-12-31') - Date.parse(right.complianceDeadline || '9999-12-31');
      })[0]
    : undefined;
  const worstHorse = horses.find((horse) => horse.id === worstRecord?.horseId);
  const worstName = worstHorse?.name ?? worstRecord?.legalOwner ?? '';

  const heroRisks = useMemo(() => {
    const risks: { label: string; severity: 'amber' | 'rose' }[] = [];
    const nameFor = (record: OwnershipRecord) =>
      horses.find((horse) => horse.id === record.horseId)?.name ?? record.legalOwner;
    records.forEach((record) => {
      if (isPastDeadline(record)) {
        risks.push({ label: `${nameFor(record)}: deadline ${formatDateLabel(record.complianceDeadline)} passed`, severity: 'rose' });
      }
    });
    records.forEach((record) => {
      if (record.transferStatus === 'Attention Required' && !isPastDeadline(record)) {
        risks.push({ label: `${nameFor(record)}: attention required`, severity: 'rose' });
      }
    });
    records.forEach((record) => {
      if (record.transferStatus === 'Pending Signatures' || record.transferStatus === 'AQHA Review') {
        risks.push({ label: `${nameFor(record)}: ${record.transferStatus.toLowerCase()} in progress`, severity: 'amber' });
      }
    });
    return risks.slice(0, 4);
  }, [horses, records]);

  const selectRecordAndScroll = (recordId: string) => {
    setSelectedRecordId(recordId);
    scrollToSection(RECORD_WORKSPACE_ID);
  };

  // ---- Quick view drawer + context menus ------------------------------------
  const menuRecord = menuState?.type === 'record' ? records.find((record) => record.id === menuState.recordId) : undefined;
  const menuHorse = horses.find((horse) => horse.id === menuRecord?.horseId);

  const openOwnershipDetails = (recordId: string) => {
    const record = records.find((item) => item.id === recordId);
    const horse = horses.find((item) => item.id === record?.horseId);
    if (!record || !horse) return;
    const requirements = record.proofRequirements ?? [];
    const verified = requirements.filter((requirement) => requirement.status === 'verified').length;
    openRightDrawer({
      id: `ownership-record-${record.id}`,
      eyebrow: 'Ownership record',
      title: horse.name,
      description:
        verified === requirements.length && requirements.length > 0
          ? 'Every proof requirement is verified.'
          : `${verified} of ${requirements.length} proof requirements verified.`,
      facts: [
        { label: 'Legal owner', value: record.legalOwner },
        { label: 'Transfer', value: record.transferStatus },
        { label: 'Deadline', value: formatDateLabel(record.complianceDeadline) },
        { label: 'Confidence', value: `${record.confidence}%` },
      ],
      actions: [
        { label: 'Open horse record', path: `/horses/${horse.id}` },
        { label: 'Open documents', path: '/documents' },
      ],
    });
  };

  const menuItems = menuRecord
    ? [
        { id: 'quick-view', label: 'Quick view', onSelect: () => openOwnershipDetails(menuRecord.id) },
        { id: 'open-workspace', label: 'Open transfer workspace', onSelect: () => selectRecordAndScroll(menuRecord.id) },
        ...(menuHorse
          ? [{ id: 'open-horse', label: 'Open horse profile', onSelect: () => navigate(`/horses/${menuHorse.id}`) }]
          : []),
      ]
    : menuState?.type === 'section'
      ? [
          { id: 'upload-document', label: 'Open document intake', onSelect: () => navigate('/documents?upload=1') },
          { id: 'open-documents', label: 'Open documents', onSelect: () => navigate('/documents') },
        ]
      : [];

  const openSectionMenu = (sectionId: 'registry' | 'workspace', event: MouseEvent) => {
    event.preventDefault();
    setMenuState({ type: 'section', sectionId, x: event.clientX, y: event.clientY });
  };

  // ---- Proof chain actions ---------------------------------------------------
  const linkableDocuments = selectedRecord
    ? documents.filter((document) => document.horseId === selectedRecord.horseId || !document.horseId)
    : [];

  const handleLinkProof = (requirementId: string, documentId: string) => {
    if (!selectedRecord || !documentId) return;
    const result = linkOwnershipProof(selectedRecord.id, requirementId, documentId);
    pushToast({ title: result.ok ? 'Proof linked' : 'Link blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
  };

  const handleVerifyProof = (requirementId: string) => {
    if (!selectedRecord) return;
    const result = verifyOwnershipProof(selectedRecord.id, requirementId, currentRole);
    pushToast({ title: result.ok ? 'Proof verified' : 'Verify blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
  };

  const handleUnlinkProof = (requirementId: string) => {
    if (!selectedRecord) return;
    const result = unlinkOwnershipProof(selectedRecord.id, requirementId);
    pushToast({ title: result.ok ? 'Proof unlinked' : 'Unlink blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
  };

  // ---- Transfer status -------------------------------------------------------
  const handleStatusChoice = (status: TransferStatus) => {
    if (!selectedRecord) return;
    if (status === 'Clear') {
      setClearDialogOpen(true);
      return;
    }
    const result = applyTransferStatus(selectedRecord.id, status, currentRole);
    pushToast({ title: result.ok ? 'Transfer status updated' : 'Status change blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    setStatusError(result.ok ? '' : result.message);
  };

  const confirmMarkClear = () => {
    if (!selectedRecord) return;
    const result = applyTransferStatus(selectedRecord.id, 'Clear', currentRole);
    pushToast({ title: result.ok ? 'Transfer marked Clear' : 'Clear refused', message: result.message, tone: result.ok ? 'success' : 'error' });
    setStatusError(result.ok ? '' : result.message);
    setClearDialogOpen(false);
  };

  const verifiedRequirements = (selectedRecord?.proofRequirements ?? []).filter((requirement) => requirement.status === 'verified');
  const unverifiedCount = (selectedRecord?.proofRequirements ?? []).length - verifiedRequirements.length;

  // ---- Record details / audit / stakes ----------------------------------------
  const saveRecordDetails = () => {
    if (!selectedRecord) return;
    if (!legalOwner.trim() || !complianceDeadline.trim()) {
      setDetailsError('Legal owner and compliance deadline are required.');
      return;
    }
    const result = updateOwnershipRecord(selectedRecord.id, { legalOwner, complianceDeadline });
    pushToast({ title: result.ok ? 'Record details saved' : 'Save blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) setDetailsError('');
  };

  const saveAuditNote = () => {
    if (!selectedRecord) return;
    const result = addOwnershipAuditEntry(selectedRecord.id, auditNote);
    pushToast({ title: result.ok ? 'Audit note added' : 'Audit note blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) setAuditNote('');
  };

  const addCoOwner = () => {
    if (!selectedHorse) return;
    const result = addOwnershipStake(selectedHorse.id, {
      name: coOwner.name,
      share: Number(coOwner.share),
      role: coOwner.role,
      contact: coOwner.contact,
    });
    pushToast({ title: result.ok ? 'Owner added' : 'Owner blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) {
      setCoOwner({ name: '', share: '25', role: 'Co-Owner', contact: '' });
    }
  };

  const sortedAuditEvents = [...(selectedRecord?.auditEvents ?? [])].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));

  const renderProofRow = (requirement: OwnershipProofRequirement) => (
    <div key={requirement.id} className={`ownership-proof-row ownership-proof-row--${requirement.status}`}>
      <div className="ownership-proof-row__info">
        <div className="ownership-proof-row__title">
          <strong>{requirement.label}</strong>
          <Pill tone={proofChipTone(requirement.status)}>{proofChipLabel(requirement.status)}</Pill>
        </div>
        {requirement.status === 'missing' ? (
          <small>No document linked yet.</small>
        ) : (
          <small>
            {requirement.documentTitle ?? 'Linked document'}
            {requirement.linkedAt ? ` · linked ${formatDateTimeLabel(requirement.linkedAt)}` : ''}
            {requirement.status === 'verified' && requirement.verifiedBy
              ? ` · verified by ${requirement.verifiedBy}${requirement.verifiedAt ? ` ${formatDateTimeLabel(requirement.verifiedAt)}` : ''}`
              : ''}
          </small>
        )}
      </div>
      <div className="ownership-proof-row__actions">
        {requirement.status === 'missing' ? (
          <select
            className="field-input ownership-proof-select"
            value=""
            aria-label={`Link document for ${requirement.label}`}
            disabled={!canManageOwnership || !linkableDocuments.length}
            onChange={(event) => handleLinkProof(requirement.id, event.target.value)}
          >
            <option value="" disabled>
              {linkableDocuments.length ? 'Link document…' : 'No documents for this horse'}
            </option>
            {linkableDocuments.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title} ({document.state})
              </option>
            ))}
          </select>
        ) : null}
        {requirement.status === 'linked' ? (
          <button className="button button--primary button--compact" type="button" onClick={() => handleVerifyProof(requirement.id)} disabled={!canManageOwnership}>
            Verify proof
          </button>
        ) : null}
        {requirement.status !== 'missing' ? (
          <button className="button button--ghost button--compact" type="button" onClick={() => handleUnlinkProof(requirement.id)} disabled={!canManageOwnership}>
            Unlink
          </button>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="ownership-ops">
      <CommandBrief
        eyebrow="Ownership"
        entity="Ownership & Transfers"
        variant="split"
        status={heroStatus}
        summary="Every transfer is proven by linked, verified documents. Clear is earned, never typed."
        evidence={[
          { label: 'Records', value: `${records.length}` },
          { label: 'Proofs verified', value: `${proofTotals.verified} / ${proofTotals.total}` },
          { label: 'Transfers pending', value: `${pendingTransfers.length}` },
          { label: 'Next deadline', value: nextDeadline ? formatDateLabel(nextDeadline) : 'None pending' },
        ]}
        risks={heroRisks}
        nextAction={
          worstRecord
            ? { label: `Open transfer workspace for ${worstName}`, onClick: () => selectRecordAndScroll(worstRecord.id) }
            : { label: 'Open transfer workspace', disabledReason: 'No ownership records yet — add a horse first.' }
        }
        secondaryActions={[
          ...(worstRecord && heroRisks.length
            ? [{ label: `Review ${worstName}`, onClick: () => selectRecordAndScroll(worstRecord.id) }]
            : []),
          ...(canUploadDocuments ? [{ label: 'Go to document intake', to: '/documents?upload=1' }] : []),
        ]}
      />

      <div className="ownership-workspace ownership-workspace--main">
        <section id="ownership-registry" className="ownership-panel" onContextMenu={(event) => openSectionMenu('registry', event)}>
          <div className="ownership-section-heading">
            <div>
              <span className="section-eyebrow">Registry</span>
              <h2>Horse to owner relationships</h2>
            </div>
            <Pill tone={filteredRows.length ? 'blue' : 'slate'}>{filteredRows.length} shown</Pill>
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

          {filteredRows.length ? (
            <div className="ownership-table" role="table" aria-label="Horse ownership relationships">
              <div className="ownership-table__head" role="row">
                <span>Horse</span>
                <span>Current owner</span>
                <span>Share</span>
                <span>Status</span>
                <span>Proof</span>
              </div>
              {filteredRows.map((row) => {
                const rowRecord = row.record ? normalizeOwnershipRecord(row.record) : undefined;
                const requirements = rowRecord?.proofRequirements ?? [];
                const verifiedCount = requirements.filter((requirement) => requirement.status === 'verified').length;
                return (
                  <div key={row.horse.id} className="ownership-row-shell" role="row">
                    <button
                      type="button"
                      className={`ownership-row${row.record?.id === selectedRecord?.id ? ' ownership-row--selected' : ''}`}
                      onClick={() => {
                        if (row.record) {
                          setSelectedRecordId(row.record.id);
                        } else {
                          const result = ensureOwnershipRecord(row.horse.id);
                          if (result.ok && result.recordId) {
                            setSelectedRecordId(result.recordId);
                            pushToast({ title: 'Ownership record created', message: result.message, tone: 'success' });
                          } else if (!result.ok) {
                            pushToast({ title: 'Could not create record', message: result.message, tone: 'error' });
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
                        <Pill tone={statusPillTone(row.status)}>{row.status}</Pill>
                        {row.deadline ? <small>Due {formatDateLabel(row.deadline)}</small> : null}
                      </span>
                      <span>
                        {rowRecord ? (
                          <>
                            <strong>{verifiedCount} / {requirements.length} verified</strong>
                            <small>{verifiedCount === requirements.length ? 'Proof chain complete' : 'Proof chain open'}</small>
                          </>
                        ) : (
                          <>
                            <strong>No record</strong>
                            <small>Select to create one</small>
                          </>
                        )}
                      </span>
                    </button>
                    {row.record ? (
                      <ActionMenuButton
                        className="ownership-row-shell__menu icon-button icon-button--compact"
                        label={`Open ownership actions for ${row.horse.name}`}
                        onOpen={(x, y) => setMenuState({ type: 'record', recordId: row.record!.id, x, y })}
                      >
                        <DotsIcon className="icon-button__icon" />
                      </ActionMenuButton>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : relationshipRows.length ? (
            <EmptyState compact title="No ownership rows match" description="Clear the search or choose a different transfer status." />
          ) : (
            <div className="ownership-empty-state">
              <EmptyState title="Start by adding a horse, then prove its ownership." description="The registry shows owner shares, transfer status, and the proof chain once horse records exist." />
              <button className="button button--primary" type="button" onClick={() => navigate('/horses?new=1')}>
                Go to horses
              </button>
            </div>
          )}
        </section>

        <section id={RECORD_WORKSPACE_ID} className="ownership-panel ownership-record-panel" onContextMenu={(event) => openSectionMenu('workspace', event)}>
          {selectedRecord ? (
            <>
              <div className="ownership-section-heading ownership-section-heading--compact">
                <div>
                  <span className="section-eyebrow">Transfer workspace</span>
                  <h2>{selectedHorseName}</h2>
                </div>
                <Pill tone={statusPillTone(selectedRecord.transferStatus)}>{selectedRecord.transferStatus}</Pill>
              </div>

              <div className="ownership-subsection">
                <h3 className="ownership-subsection__title">Proof chain</h3>
                <div className="ownership-proof-list">{(selectedRecord.proofRequirements ?? []).map(renderProofRow)}</div>
              </div>

              <div className="ownership-confidence" aria-label={`Proof-backed confidence ${selectedRecord.confidence}%`}>
                <div className="ownership-confidence__caption">
                  <span>Proof-backed confidence</span>
                  <strong>{selectedRecord.confidence}%</strong>
                </div>
                <ProgressBar value={selectedRecord.confidence} tone={selectedRecord.confidence >= 100 ? 'blue' : selectedRecord.confidence >= 50 ? 'amber' : 'rose'} />
                <small>Computed from linked and verified proof. Not editable.</small>
              </div>

              <div className="ownership-subsection">
                <h3 className="ownership-subsection__title">Transfer status</h3>
                <div className="ownership-status-control" role="group" aria-label="Set transfer status">
                  {transferStatuses.map((status) => (
                    <button
                      key={status}
                      type="button"
                      className={`ownership-status-button${selectedRecord.transferStatus === status ? ' ownership-status-button--active' : ''}`}
                      onClick={() => handleStatusChoice(status)}
                      disabled={!canManageOwnership || selectedRecord.transferStatus === status}
                    >
                      {status}
                    </button>
                  ))}
                </div>
                <p className="ownership-status-hint">Clear requires every proof requirement to be verified and opens a signed confirmation.</p>
                {statusError ? <div className="field-error">{statusError}</div> : null}
              </div>

              <div className="ownership-subsection">
                <h3 className="ownership-subsection__title">Record details</h3>
                <div className="form-grid form-grid--tight">
                  <label className="field-stack">
                    <span className="field-label">Legal owner</span>
                    <input className="field-input" value={legalOwner} onChange={(event) => setLegalOwner(event.target.value)} disabled={!canManageOwnership} />
                  </label>
                  <label className="field-stack">
                    <span className="field-label">Compliance deadline</span>
                    <input className="field-input" type="date" value={complianceDeadline} onChange={(event) => setComplianceDeadline(event.target.value)} disabled={!canManageOwnership} />
                  </label>
                </div>
                {detailsError ? <div className="field-error">{detailsError}</div> : null}
                <button className="button button--primary ownership-full-button" type="button" onClick={saveRecordDetails} disabled={!canManageOwnership}>
                  Save record details
                </button>
              </div>

              <div className="ownership-subsection">
                <h3 className="ownership-subsection__title">Audit log</h3>
                {sortedAuditEvents.length ? (
                  <div className="ownership-audit-list">
                    {sortedAuditEvents.map((event) => (
                      <div key={event.id} className="ownership-audit-item">
                        <div className="ownership-audit-item__meta">
                          <span>{formatDateTimeLabel(event.at)}</span>
                          <strong>{event.actor}</strong>
                        </div>
                        <p>{event.summary}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState compact title="No audit events yet" description="Proof links, verifications, and status changes are recorded here." />
                )}

                <div className="ownership-note-box">
                  <label className="field-stack">
                    <span className="field-label">Add audit note</span>
                    <textarea className="field-textarea" rows={3} value={auditNote} onChange={(event) => setAuditNote(event.target.value)} disabled={!canManageOwnership} />
                  </label>
                  <button className="button button--ghost ownership-full-button" type="button" onClick={saveAuditNote} disabled={!canManageOwnership}>
                    Add audit note
                  </button>
                </div>

                {selectedRecord.auditTrail.length ? (
                  <div className="ownership-legacy-notes">
                    <div className="ownership-audit-divider">Legacy notes</div>
                    <ul>
                      {selectedRecord.auditTrail.map((entry) => (
                        <li key={entry}>{entry}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <EmptyState title="No ownership record loaded" description="Select a registry row to open its transfer workspace." />
          )}
        </section>
      </div>

      <div className="ownership-workspace ownership-workspace--secondary">
        <section id="ownership-owner-registry" className="ownership-panel">
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
                    <Pill tone={owner.statuses.some((status) => status !== 'Clear') ? 'amber' : 'blue'}>
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
            <EmptyState compact title="No owners on file yet" description="Owner names, shares, and contacts appear once horses carry ownership stakes." />
          )}
        </section>

        <aside id="ownership-owner-editor" className="ownership-panel ownership-editor-panel">
          <div className="ownership-section-heading ownership-section-heading--compact">
            <div>
              <span className="section-eyebrow">Co-owner stakes</span>
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

      <ConfirmActionDialog
        open={clearDialogOpen && Boolean(selectedRecord)}
        tone="legal"
        title={`Mark transfer Clear — ${selectedHorseName}`}
        consequences={[
          'Clear states the legal transfer is complete and verified.',
          'This status is shown to buyers and on sale packets.',
          'The change is written to the permanent audit log.',
        ]}
        proofSummary={
          <ul className="ownership-clear-proof">
            {verifiedRequirements.map((requirement) => (
              <li key={requirement.id}>
                <strong>{requirement.label}</strong>
                <span>{requirement.documentTitle ?? 'Linked document'}</span>
                <small>
                  Verified by {requirement.verifiedBy ?? 'unknown'}
                  {requirement.verifiedAt ? ` · ${formatDateTimeLabel(requirement.verifiedAt)}` : ''}
                </small>
              </li>
            ))}
            {unverifiedCount > 0 ? (
              <li className="ownership-clear-proof__warning">
                {unverifiedCount} requirement{unverifiedCount === 1 ? '' : 's'} not verified yet — Clear will be refused.
              </li>
            ) : null}
          </ul>
        }
        acknowledgements={['I confirm the verified documents above are accurate and complete.']}
        confirmLabel="Mark Clear"
        onConfirm={confirmMarkClear}
        onCancel={() => setClearDialogOpen(false)}
      />

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </div>
  );
}
