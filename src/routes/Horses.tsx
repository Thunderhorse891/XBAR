import { type CSSProperties, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { ActionMenuButton } from '@/components/InteractionSystem';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { Pill, ProgressBar, SurfaceTabs } from '@/components/app-ui';
import { DotsIcon } from '@/components/icons';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { HorseSegment, HorseSex, HorseStatus } from '@/types/xbar';

function createHorseFormDefaults(params: {
  defaultOwnerName: string;
  defaultOwnerEntity: string;
  defaultBarn: string;
  defaultPasture: string;
}) {
  return {
    name: '',
    barnName: '',
    segment: 'Sale Prospect' as HorseSegment,
    status: 'Sale Prep' as HorseStatus,
    sex: 'Mare' as HorseSex,
    owner: params.defaultOwnerName,
    ownerEntity: params.defaultOwnerEntity,
    aqhaNumber: '',
    registrationNumber: '',
    barn: params.defaultBarn,
    pasture: params.defaultPasture,
  };
}

type ViewMode = 'Horses' | 'Registry Matrix';
type SegmentFilter = 'All' | HorseSegment;

const statusTone: Record<HorseStatus, 'blue' | 'slate' | 'amber' | 'rose' | 'emerald'> = {
  'In Training': 'blue',
  'Broodmare Program': 'emerald',
  'Sale Prep': 'amber',
  'Medical Review': 'rose',
  Pasture: 'slate',
  Retired: 'slate',
};

const segments: SegmentFilter[] = ['All', 'Sale Prospect', 'Broodmare', 'Stud', 'Show String', 'Retired'];
const horseSegments: HorseSegment[] = ['Broodmare', 'Stud', 'Show String', 'Sale Prospect', 'Young Stock', 'Retired'];
const horseStatuses: HorseStatus[] = ['In Training', 'Broodmare Program', 'Sale Prep', 'Medical Review', 'Pasture', 'Retired'];
const horseSexes: HorseSex[] = ['Mare', 'Stud', 'Gelding', 'Filly', 'Colt'];
const portfolioFallbackCards = [
  { title: 'Horse Record', meta: 'Name, owner, barn', status: 'Ready', metric: '01' },
  { title: 'Documents', meta: 'Coggins, papers, receipts', status: 'Next', metric: '02' },
  { title: 'Health', meta: 'Vet, dental, wormer', status: 'Planned', metric: '03' },
  { title: 'Sales', meta: 'Profile and release checks', status: 'Optional', metric: '04' },
];

export default function Horses() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const toggleSharedListing = useXbarStore((state) => state.toggleSharedListing);
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const addHorse = useXbarStore((state) => state.addHorse);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const pushToast = useUiStore((state) => state.pushToast);
  const openRightDrawer = useUiStore((state) => state.openRightDrawer);
  const canCreateHorse = useCurrentRoleCapability('createHorse');
  const canManageSharedAccess = useCurrentRoleCapability('manageSharedAccess');
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('Horses');
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('All');
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [formErrors, setFormErrors] = useState<Partial<Record<'name' | 'barnName' | 'owner' | 'ownerEntity' | 'barn' | 'pasture', string>>>({});
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);
  const [form, setForm] = useState(() =>
    createHorseFormDefaults({
      defaultOwnerName: workspaceProfile.defaultOwnerName,
      defaultOwnerEntity: workspaceProfile.defaultOwnerEntity,
      defaultBarn: workspaceProfile.defaultBarn,
      defaultPasture: workspaceProfile.defaultPasture,
    }),
  );

  const createOpen = searchParams.get('new') === '1';
  const activeSharedHorseIds = new Set(sharedListings.filter((listing) => listing.state !== 'Archived').map((listing) => listing.horseId));
  void activeSharedHorseIds;

  useEffect(() => {
    setSearch(searchParams.get('search') ?? '');
  }, [searchParams]);

  const setNewHorseParam = (open: boolean) => {
    const nextParams = new URLSearchParams(searchParams);
    if (open) nextParams.set('new', '1');
    else nextParams.delete('new');
    setSearchParams(nextParams);
  };

  const filtered = horses.filter((horse) => {
    const matchesSearch =
      !search.trim() ||
      [horse.name, horse.barnName, horse.owner, horse.ownerEntity, horse.aqhaNumber, horse.registrationNumber, horse.location.barn, horse.location.pasture]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase());
    const matchesSegment = segmentFilter === 'All' || horse.segment === segmentFilter;
    return matchesSearch && matchesSegment;
  });

  const commandPackets = horses.map((horse) => ({
    horse,
    packet: buildHorsePacketCompleteness(
      horse,
      documents.filter((document) => document.horseId === horse.id),
      ownershipRecords.find((record) => record.horseId === horse.id),
    ),
  }));
  const medicalWatchCount = horses.filter((horse) => horse.status === 'Medical Review').length;
  const buyerReadyCount = horses.filter((horse) => horse.readiness.packetStatus === 'Ready').length;
  const salePrepCount = horses.filter((horse) => horse.status === 'Sale Prep' || horse.segment === 'Sale Prospect').length;
  const proofGapCount = commandPackets.reduce((sum, item) => sum + item.packet.saleSlots.filter((slot) => slot.status !== 'ready').length, 0);
  const proofReadinessScore = commandPackets.length
    ? Math.round(commandPackets.reduce((sum, item) => sum + item.packet.score, 0) / commandPackets.length)
    : 0;
  const portfolioSignals = [
    { label: 'Document readiness', value: proofReadinessScore, detail: `${proofGapCount} open gaps` },
    { label: 'Buyer-ready files', value: salePrepCount ? Math.round((buyerReadyCount / salePrepCount) * 100) : 0, detail: `${buyerReadyCount}/${salePrepCount || 0} sale files` },
    { label: 'Medical clarity', value: horses.length ? Math.round(((horses.length - medicalWatchCount) / horses.length) * 100) : 0, detail: `${medicalWatchCount} watch files` },
  ];

  const handleSavedHorseToggle = async (horseId: string) => {
    const horse = horses.find((item) => item.id === horseId);
    const wasSaved = sharedListings.some((listing) => listing.horseId === horseId && listing.state !== 'Archived');
    const result = await toggleSharedListing(horseId);
    pushToast({
      title: result.ok ? (wasSaved ? 'Buyer packet removed' : 'Buyer packet staged') : 'Buyer packet blocked',
      message: horse && result.ok ? `${horse.name} ${wasSaved ? 'was removed from' : 'is now staged in'} buyer packet access.` : result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const openHorseMenu = (horseId: string, x: number, y: number) => setMenuState({ horseId, x, y });

  const openHorseDetails = (horse: (typeof horses)[number]) => {
    const packet = buildHorsePacketCompleteness(
      horse,
      documents.filter((document) => document.horseId === horse.id),
      ownershipRecords.find((record) => record.horseId === horse.id),
    );
    openRightDrawer({
      id: `horse-${horse.id}`,
      eyebrow: 'Horse Record',
      title: horse.name,
      description: `${horse.segment} in ${horse.location.barn}. Open the horse record for identity, care, ownership, documents, buyer movement, and operating history.`,
      facts: [
        { label: 'Status', value: horse.status },
        { label: 'Legal owner', value: horse.owner },
        { label: 'Location', value: `${horse.location.barn} | ${horse.location.pasture}` },
        { label: 'Registration', value: horse.aqhaNumber || horse.registrationNumber || 'Pending' },
        { label: 'Readiness', value: formatPercent(packet.score) },
      ],
      actions: [{ label: 'Open horse record', path: `/horses/${horse.id}` }],
    });
  };

  const menuHorse = filtered.find((horse) => horse.id === menuState?.horseId) ?? horses.find((horse) => horse.id === menuState?.horseId);
  const menuSaved = menuHorse ? sharedListings.some((listing) => listing.horseId === menuHorse.id && listing.state !== 'Archived') : false;
  const menuPacket = menuHorse
    ? buildHorsePacketCompleteness(
        menuHorse,
        documents.filter((document) => document.horseId === menuHorse.id),
        ownershipRecords.find((record) => record.horseId === menuHorse.id),
      )
    : undefined;
  const menuListing = menuHorse ? sharedListings.find((listing) => listing.horseId === menuHorse.id && listing.state !== 'Archived') : undefined;
  const menuShareUrl = menuPacket ? buildPublicShareUrl(menuPacket.sharePath, menuListing?.accessMode === 'Private Token' ? menuListing.shareToken : undefined) : '';
  const menuItems = menuHorse && menuPacket
    ? [
        { id: 'open-profile', label: 'Open horse record', onSelect: () => navigate(`/horses/${menuHorse.id}`) },
        ...(menuSaved
          ? [
              {
                id: 'open-share-view',
                label: 'Open buyer packet',
                onSelect: async () => {
                  const result = await recordSharedChannel(menuHorse.id, 'Direct Link');
                  if (!result.ok) {
                    pushToast({ title: 'Buyer packet blocked', message: result.message, tone: 'error' });
                    return;
                  }
                  if (typeof window !== 'undefined') window.open(menuShareUrl, '_blank', 'noopener,noreferrer');
                },
              },
            ]
          : []),
        ...(canManageSharedAccess
          ? [{ id: 'toggle-shared', label: menuSaved ? 'Remove buyer packet' : 'Stage buyer packet', onSelect: async () => handleSavedHorseToggle(menuHorse.id) }]
          : []),
        { id: 'open-sales', label: 'Open Sales', onSelect: () => navigate('/sales') },
        { id: 'open-proof', label: 'Open Documents', onSelect: () => navigate('/documents') },
      ]
    : [];

  const handleCreateHorse = () => {
    const nextErrors: Partial<Record<'name' | 'barnName' | 'owner' | 'ownerEntity' | 'barn' | 'pasture', string>> = {};
    if (form.name.trim().length < 3) nextErrors.name = 'Registered name is required.';
    if (!form.barnName.trim()) nextErrors.barnName = 'Barn name is required.';
    if (form.owner.trim().length < 2) nextErrors.owner = 'Legal owner is required.';
    if (form.ownerEntity.trim().length < 2) nextErrors.ownerEntity = 'Owner entity is required.';

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    const result = addHorse(form);
    pushToast({ title: result.ok ? 'Horse record created' : 'Horse record blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok && result.id) {
      setForm(
        createHorseFormDefaults({
          defaultOwnerName: workspaceProfile.defaultOwnerName,
          defaultOwnerEntity: workspaceProfile.defaultOwnerEntity,
          defaultBarn: workspaceProfile.defaultBarn,
          defaultPasture: workspaceProfile.defaultPasture,
        }),
      );
      setNewHorseParam(false);
      navigate(`/horses/${result.id}`);
    }
  };

  return (
    <>
      <div className="surface-hero surface-hero--dark command-files-hero">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Horses</span>
            <h1>Every horse. One trusted record.</h1>
            <p className="command-center-briefing__copy">
              Ownership, care, documents, and sale readiness &mdash; clear at a glance, before anyone opens a file.
            </p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Horse records</span><strong>{horses.length}</strong></div>
            <div className="surface-hero__stat"><span>Care holds</span><strong style={{ color: medicalWatchCount ? 'var(--rose)' : 'var(--emerald)' }}>{medicalWatchCount}</strong></div>
            <div className="surface-hero__stat"><span>Buyer ready</span><strong>{buyerReadyCount}/{salePrepCount}</strong></div>
            <div className="surface-hero__stat"><span>Document gaps</span><strong style={{ color: proofGapCount ? 'var(--amber)' : 'var(--emerald)' }}>{proofGapCount}</strong></div>
          </div>
          <div className="inline-actions" style={{ marginTop: '16px' }}>
            <Link to="/documents?upload=1" className="button button--ghost button--compact">Upload Documents</Link>
            <button className="button button--primary button--compact" type="button" onClick={() => setNewHorseParam(true)} disabled={!canCreateHorse}>Add Horse</button>
          </div>
        </div>
      </div>

      <section className="portfolio-signal-deck" aria-label="Horse portfolio overview">
        <div className="portfolio-signal-deck__copy">
          <span>Horse Cards</span>
          <strong>Every card shows the details that matter.</strong>
          <p>Documents, owner, location, buyer release, medical status, and sale readiness stay visible before anyone opens a record.</p>
        </div>
        <div className="portfolio-signal-deck__bars">
          {portfolioSignals.map((signal) => (
            <div className="portfolio-signal-bar" key={signal.label}>
              <div><span>{signal.label}</span><strong>{formatPercent(signal.value)}</strong></div>
              <i><span style={{ width: formatPercent(signal.value) }} /></i>
              <small>{signal.detail}</small>
            </div>
          ))}
        </div>
        <div className="portfolio-mini-carousel" aria-label="Horse card preview">
          {(commandPackets.length ? commandPackets.slice(0, 4) : portfolioFallbackCards).map((item, index) => {
            const isHorse = 'horse' in item;
            const title = isHorse ? item.horse.name : item.title;
            const meta = isHorse ? `${item.horse.segment} | ${item.horse.location.barn}` : item.meta;
            const status = isHorse ? item.packet.buyerProfileStatus : item.status;
            const metric = isHorse ? formatPercent(item.packet.score) : item.metric;
            return (
              <button
                type="button"
                className="portfolio-mini-card xb-reveal"
                style={{ '--xb-reveal-index': index } as CSSProperties}
                key={`${title}-${index}`}
                disabled={!isHorse}
                onClick={() => {
                  if (isHorse) navigate(`/horses/${item.horse.id}`);
                }}
              >
                <span>{metric}</span>
                <strong>{title}</strong>
                <small>{meta}</small>
                <em>{status}</em>
              </button>
            );
          })}
        </div>
      </section>

      {createOpen ? (
        <section className="panel">
          <div className="panel__header">
            <div><div className="panel__eyebrow">Horse record intake</div><h2 className="panel__title">Create horse record</h2></div>
            <button className="button button--ghost button--compact" type="button" onClick={() => setNewHorseParam(false)}>Close</button>
          </div>
          <div className="form-grid">
            <label className="field-stack"><span className="field-label">Registered name</span><input className="field-input" value={form.name} onChange={(event) => { setForm((current) => ({ ...current, name: event.target.value })); setFormErrors((current) => ({ ...current, name: undefined })); }} disabled={!canCreateHorse} />{formErrors.name ? <span className="field-error">{formErrors.name}</span> : null}</label>
            <label className="field-stack"><span className="field-label">Barn name</span><input className="field-input" value={form.barnName} onChange={(event) => { setForm((current) => ({ ...current, barnName: event.target.value })); setFormErrors((current) => ({ ...current, barnName: undefined })); }} disabled={!canCreateHorse} />{formErrors.barnName ? <span className="field-error">{formErrors.barnName}</span> : null}</label>
            <label className="field-stack"><span className="field-label">Program segment</span><select className="field-input" value={form.segment} onChange={(event) => setForm((current) => ({ ...current, segment: event.target.value as HorseSegment }))} disabled={!canCreateHorse}>{horseSegments.map((segment) => <option key={segment} value={segment}>{segment}</option>)}</select></label>
            <label className="field-stack"><span className="field-label">Operational status</span><select className="field-input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as HorseStatus }))} disabled={!canCreateHorse}>{horseStatuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
            <label className="field-stack"><span className="field-label">Sex</span><select className="field-input" value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value as HorseSex }))} disabled={!canCreateHorse}>{horseSexes.map((sex) => <option key={sex} value={sex}>{sex}</option>)}</select></label>
            <label className="field-stack"><span className="field-label">Legal owner</span><input className="field-input" value={form.owner} onChange={(event) => { setForm((current) => ({ ...current, owner: event.target.value })); setFormErrors((current) => ({ ...current, owner: undefined })); }} disabled={!canCreateHorse} />{formErrors.owner ? <span className="field-error">{formErrors.owner}</span> : null}</label>
            <label className="field-stack"><span className="field-label">Owner entity</span><input className="field-input" value={form.ownerEntity} onChange={(event) => { setForm((current) => ({ ...current, ownerEntity: event.target.value })); setFormErrors((current) => ({ ...current, ownerEntity: undefined })); }} disabled={!canCreateHorse} />{formErrors.ownerEntity ? <span className="field-error">{formErrors.ownerEntity}</span> : null}</label>
            <label className="field-stack"><span className="field-label">AQHA number</span><input className="field-input" value={form.aqhaNumber} onChange={(event) => setForm((current) => ({ ...current, aqhaNumber: event.target.value }))} disabled={!canCreateHorse} /></label>
            <label className="field-stack"><span className="field-label">Registration number</span><input className="field-input" value={form.registrationNumber} onChange={(event) => setForm((current) => ({ ...current, registrationNumber: event.target.value }))} disabled={!canCreateHorse} /></label>
            <label className="field-stack"><span className="field-label">Barn</span><input className="field-input" value={form.barn} onChange={(event) => { setForm((current) => ({ ...current, barn: event.target.value })); setFormErrors((current) => ({ ...current, barn: undefined })); }} disabled={!canCreateHorse} />{formErrors.barn ? <span className="field-error">{formErrors.barn}</span> : null}</label>
            <label className="field-stack"><span className="field-label">Pasture</span><input className="field-input" value={form.pasture} onChange={(event) => { setForm((current) => ({ ...current, pasture: event.target.value })); setFormErrors((current) => ({ ...current, pasture: undefined })); }} disabled={!canCreateHorse} />{formErrors.pasture ? <span className="field-error">{formErrors.pasture}</span> : null}</label>
          </div>
          <div className="inline-actions">
            <button className="button button--ghost" type="button" onClick={() => setForm((current) => ({ ...current, owner: workspaceProfile.defaultOwnerName, ownerEntity: workspaceProfile.defaultOwnerEntity, barn: workspaceProfile.defaultBarn, pasture: workspaceProfile.defaultPasture }))} disabled={!canCreateHorse}>Use ranch defaults</button>
            <button className="button button--primary" type="button" onClick={handleCreateHorse} disabled={!canCreateHorse || !form.name.trim() || !form.barnName.trim() || !form.owner.trim()}>Create horse record</button>
          </div>
        </section>
      ) : null}

      <section className="portfolio-toolbar">
        <div className="portfolio-toolbar__controls">
          <SurfaceTabs items={['Horses', 'Registry Matrix']} active={viewMode} onChange={(mode) => setViewMode(mode as ViewMode)} />
          <SurfaceTabs items={segments} active={segmentFilter} onChange={(segment) => setSegmentFilter(segment as SegmentFilter)} className="surface-tabs--wrap" />
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} className="field-input field-input--wide" placeholder="Search horse record, owner, AQHA, barn, or documents" aria-label="Search horse records" />
      </section>

      {viewMode === 'Horses' ? (
        filtered.length ? (
          <div className="horse-grid">
            {filtered.map((horse) => {
              const saved = sharedListings.some((listing) => listing.horseId === horse.id && listing.state !== 'Archived');
              const packet = buildHorsePacketCompleteness(
                horse,
                documents.filter((document) => document.horseId === horse.id),
                ownershipRecords.find((record) => record.horseId === horse.id),
              );
              const valueLabel = horse.segment === 'Sale Prospect' && horse.sale.askPrice ? 'Ask' : 'Insured';
              const accessLabel = saved ? 'Released' : 'Private';
              const showSaleSignals = horse.segment === 'Sale Prospect' || horse.status === 'Sale Prep';
              const openProofSlots = packet.saleSlots.filter((slot) => slot.status !== 'ready').length;
              return (
                <div key={horse.id} className="horse-card horse-card--interactive" role="group" aria-label={`Open ${horse.name} horse record`} title="Select the card to open the horse record. Use Quick review or the actions menu for alternatives." onClick={() => navigate(`/horses/${horse.id}`)} onContextMenu={(event) => { event.preventDefault(); openHorseMenu(horse.id, event.clientX, event.clientY); }}>
                  <div className="horse-card__media">
                    <HorseMediaPreview src={horse.profileImage || horse.gallery[0]?.url} name={horse.name} imageClassName="horse-card__image" fallbackClassName="horse-card__image-fallback" />
                    <div className="horse-card__media-top">
                      <div className="status-inline"><Pill tone={statusTone[horse.status]}>{horse.status === 'Sale Prep' ? 'Buyer Prep' : horse.status}</Pill><Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill></div>
                      <ActionMenuButton className="icon-button icon-button--compact" label={`Open actions for ${horse.name}`} onOpen={(x, y) => openHorseMenu(horse.id, x, y)}><DotsIcon className="icon-button__icon" /></ActionMenuButton>
                    </div>
                    <div className="horse-card__media-bottom"><div className="horse-card__kicker">{horse.segment}</div><div className="horse-card__title">{horse.name}</div><div className="horse-card__subtitle">{horse.registry} · {horse.sex} · {horse.location.barn}</div></div>
                  </div>

                  <div className="horse-card__body">
                    <div className="horse-card__metric-band">
                      <div className="horse-card__metric"><span>Readiness</span><strong>{formatPercent(packet.score)}</strong></div>
                      <div className="horse-card__metric"><span>{valueLabel}</span><strong>{formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}</strong></div>
                      <div className="horse-card__metric"><span>Release</span><strong>{accessLabel}</strong></div>
                    </div>

                    <div className="horse-card__facts">
                      <span className="horse-card__fact"><strong>Legal owner</strong>{horse.owner}</span>
                      <span className="horse-card__fact"><strong>Location</strong>{horse.location.barn}</span>
                      <span className="horse-card__fact"><strong>Registry</strong>{horse.aqhaNumber || horse.registrationNumber || 'Pending'}</span>
                    </div>

                    {showSaleSignals ? (
                      <div className="horse-card__readiness"><div className="horse-card__readiness-head"><span>Buyer readiness</span><strong>{formatPercent(packet.score)}</strong></div><ProgressBar value={packet.score} tone={packet.tone} /></div>
                    ) : (
                      <div className="horse-card__readiness horse-card__readiness--meta"><div className="horse-card__readiness-head"><span>Operating posture</span><strong>{horse.status === 'Sale Prep' ? 'Buyer Prep' : horse.status}</strong></div><div className="inline-metrics"><span>{horse.gallery.length} media assets</span><span>{packet.readyCount} documents ready</span><span>{horse.location.barn}</span></div></div>
                    )}

                    <div className="horse-card__packet">
                      <div className="horse-card__packet-head"><span>Release evidence</span><strong>{packet.saleSlots.filter((slot) => slot.status === 'ready').length}/{packet.saleSlots.length}</strong></div>
                      <SalePacketSlots slots={packet.saleSlots} compact />
                    </div>

                    <div className="horse-card__footer">
                      <div className="status-inline">{saved ? <Pill tone="blue">Buyer packet live</Pill> : <Pill tone={openProofSlots ? 'amber' : 'emerald'}>{openProofSlots ? `${openProofSlots} document gaps` : 'Documents clear'}</Pill>}<span>{showSaleSignals ? `${horse.sale.watchlistCount} watching` : `${horse.sale.inquiryCount} leads`}</span></div>
                      <div className="inline-actions inline-actions--card">
                        <button className="button button--ghost button--compact" type="button" onClick={(event) => { event.stopPropagation(); openHorseDetails(horse); }}>Quick review</button>
                        <button className="button button--ghost button--compact" type="button" onClick={async (event) => { event.stopPropagation(); await handleSavedHorseToggle(horse.id); }} disabled={!canManageSharedAccess}>{saved ? 'Hold packet' : 'Stage packet'}</button>
                        <Link to={`/horses/${horse.id}`} className="button button--primary button--compact" onClick={(event) => event.stopPropagation()}>Horse record</Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No horse records match this control view" description="Adjust filters, clear search, or create a new horse record." action={<button className="button button--primary button--compact" type="button" onClick={() => setNewHorseParam(true)} disabled={!canCreateHorse}>Create horse record</button>} />
        )
      ) : filtered.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead><tr><th>Horse record</th><th>Program</th><th>Legal owner</th><th>Location</th><th>Documents</th><th>Readiness</th><th>Status</th></tr></thead>
            <tbody>
              {filtered.map((horse) => (
                <tr key={horse.id} className="table-row--interactive" tabIndex={0} aria-label={`Open ${horse.name} horse record`} title="Press Enter to open. Press Shift+F10 for actions." onClick={() => navigate(`/horses/${horse.id}`)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate(`/horses/${horse.id}`); } if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); openHorseMenu(horse.id, bounds.left + 32, bounds.top + 32); } }} onContextMenu={(event) => { event.preventDefault(); openHorseMenu(horse.id, event.clientX, event.clientY); }}>
                  <td><span className="table-link">{horse.name}</span></td>
                  <td>{horse.segment}</td>
                  <td>{horse.owner}</td>
                  <td>{horse.location.barn} · {horse.location.pasture}</td>
                  <td>{horse.documents.length}</td>
                  <td>{formatPercent(horse.readiness.score)}</td>
                  <td><Pill tone={statusTone[horse.status]}>{horse.status === 'Sale Prep' ? 'Buyer Prep' : horse.status}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState title="No horse records match this matrix" description="Adjust filters, clear search, or create a horse record." action={<button className="button button--primary button--compact" type="button" onClick={() => setNewHorseParam(true)} disabled={!canCreateHorse}>Create horse record</button>} />
      )}

      <ContextMenu open={Boolean(menuState && menuHorse)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
