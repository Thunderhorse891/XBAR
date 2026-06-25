import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { Pill, ProgressBar, SurfaceTabs } from '@/components/app-ui';
import { DotsIcon, HorsesIcon } from '@/components/icons';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { useCardState } from '@/hooks/useCardState';
import { useUiStore } from '@/store/useUiStore';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { HorseRecord, HorseSegment, HorseSex, HorseStatus } from '@/types/xbar';
import './operationsExperience.css';

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

type ViewMode = 'Portfolio' | 'Registry';
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

/* ── Expandable horse card with drawer quick-view ─────────────────── */
type HorseCardProps = {
  horse: HorseRecord;
  packet: ReturnType<typeof buildHorsePacketCompleteness>;
  saved: boolean;
  canManageSharedAccess: boolean;
  toggling: boolean;
  onToggleListing: (id: string) => void;
  onContextMenu: (id: string, x: number, y: number) => void;
};

function HorseCard({ horse, packet, saved, canManageSharedAccess, toggling, onToggleListing, onContextMenu }: HorseCardProps) {
  const { isCollapsed, isExpanded, expand, collapse, headerRef } = useCardState(horse.id);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const headerBtnRef = useRef<HTMLButtonElement>(null);

  const showSaleSignals = horse.segment === 'Sale Prospect' || horse.status === 'Sale Prep';

  return (
    <div
      className={`card-expandable${isCollapsed ? ' card-expandable--collapsed' : ' card-expandable--expanded'}`}
      data-horse-id={horse.id}
    >
      {/* Card header — click to toggle */}
      <div
        ref={headerRef as React.RefObject<HTMLDivElement>}
        className="card-expandable__header"
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onClick={() => isCollapsed ? expand() : collapse()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            isCollapsed ? expand() : collapse();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onContextMenu(horse.id, e.clientX, e.clientY);
        }}
      >
        <div className="card-expandable__header-left">
          <svg className="card-expandable__chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="6 3 11 8 6 13" />
          </svg>
          <div className="horse-card__media horse-card__thumbnail">
            <HorseMediaPreview
              src={horse.profileImage || horse.gallery[0]?.url}
              name={horse.name}
              imageClassName="horse-card__image"
              fallbackClassName="horse-card__image-fallback"
            />
          </div>
          <div className="horse-card__name-wrap">
            <div className="card-expandable__title">{horse.name}</div>
            <div className="card-expandable__meta">{horse.breed || horse.segment} · {horse.owner} · {horse.location.barn}</div>
          </div>
        </div>
        <div className="horse-card__header-right">
          <Pill tone={statusTone[horse.status]}>{horse.status === 'Sale Prep' ? 'For Sale' : horse.status}</Pill>
          <button
            ref={headerBtnRef}
            className="icon-button icon-button--compact"
            type="button"
            aria-label="Quick actions"
            onClick={(e) => {
              e.stopPropagation();
              const b = e.currentTarget.getBoundingClientRect();
              onContextMenu(horse.id, b.left, b.bottom + 8);
            }}
          >
            <DotsIcon className="icon-button__icon" />
          </button>
        </div>
      </div>

      {/* Expanded body */}
      <div className="card-expandable__body">
        {/* Media + core metrics */}
        <div className="horse-card__media horse-card__banner">
          <HorseMediaPreview
            src={horse.profileImage || horse.gallery[0]?.url}
            name={horse.name}
            imageClassName="horse-card__image"
            fallbackClassName="horse-card__image-fallback"
          />
          <div className="horse-card__media-top">
            <div className="status-inline">
              <Pill tone={statusTone[horse.status]}>{horse.status === 'Sale Prep' ? 'For Sale' : horse.status}</Pill>
              <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
            </div>
          </div>
          <div className="horse-card__media-bottom">
            <div className="horse-card__kicker">{horse.segment}</div>
            <div className="horse-card__title">{horse.name}</div>
            <div className="horse-card__subtitle">{horse.registry} · {horse.sex} · {horse.location.barn}</div>
          </div>
        </div>

        <div className="horse-card__body">
          <div className="horse-card__metric-band">
            <div className="horse-card__metric"><span>Record</span><strong>{formatPercent(packet.score)}</strong></div>
            <div className="horse-card__metric"><span>{horse.segment === 'Sale Prospect' ? 'Ask' : 'Insured'}</span><strong>{horse.segment === 'Sale Prospect' ? (horse.sale.askPrice ? formatCompactCurrency(horse.sale.askPrice) : '—') : (horse.insuredValue ? formatCompactCurrency(horse.insuredValue) : '—')}</strong></div>
            <div className="horse-card__metric"><span>Share</span><strong>{saved ? 'Shared' : 'Private'}</strong></div>
          </div>

          {/* Quick-view drawer links */}
          <div className="horse-card__quick-links">
            <button
              className="button button--ghost button--compact"
              type="button"
              onClick={(e) => { e.stopPropagation(); openDrawer({ type: 'horse-health', horseId: horse.id }, headerBtnRef.current?.id); }}
            >Health</button>
            <button
              className="button button--ghost button--compact"
              type="button"
              onClick={(e) => { e.stopPropagation(); openDrawer({ type: 'horse-breeding', horseId: horse.id }); }}
            >Breeding</button>
            <button
              className="button button--ghost button--compact"
              type="button"
              onClick={(e) => { e.stopPropagation(); openDrawer({ type: 'horse-documents', horseId: horse.id }); }}
            >Docs</button>
            <button
              className="button button--ghost button--compact"
              type="button"
              onClick={(e) => { e.stopPropagation(); openDrawer({ type: 'horse-financial', horseId: horse.id }); }}
            >Expenses</button>
          </div>

          {showSaleSignals ? (
            <div className="horse-card__readiness">
              <div className="horse-card__readiness-head"><span>Sale readiness</span><strong>{formatPercent(packet.score)}</strong></div>
              <ProgressBar value={packet.score} tone={packet.tone} />
            </div>
          ) : null}

          <div className="horse-card__packet">
            <div className="horse-card__packet-head">
              <span>Sale packet</span>
              <strong>{packet.saleSlots.filter((s) => s.status === 'ready').length}/{packet.saleSlots.length}</strong>
            </div>
            <SalePacketSlots slots={packet.saleSlots} compact />
          </div>

          <div className="horse-card__footer">
            <div className="status-inline">
              {saved ? <Pill tone="blue">Shared</Pill> : null}
              <span>{showSaleSignals ? `${horse.sale.watchlistCount} watching` : `${horse.sale.inquiryCount} leads`}</span>
            </div>
            <div className="inline-actions inline-actions--card">
              <button
                className="button button--ghost button--compact"
                type="button"
                onClick={(e) => { e.stopPropagation(); void onToggleListing(horse.id); }}
                disabled={!canManageSharedAccess || toggling}
                aria-busy={toggling}
              >
                {toggling ? 'Updating…' : saved ? 'Remove listing' : 'List for sale'}
              </button>
              <Link to={`/horses/${horse.id}`} className="button button--primary button--compact">Record</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const canCreateHorse = useCurrentRoleCapability('createHorse');
  const canManageSharedAccess = useCurrentRoleCapability('manageSharedAccess');
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('Portfolio');
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('All');
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [formErrors, setFormErrors] = useState<Partial<Record<'name' | 'owner', string>>>({});
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

  const packetByHorseId = useMemo(
    () =>
      Object.fromEntries(
        horses.map((horse) => [
          horse.id,
          buildHorsePacketCompleteness(
            horse,
            documents.filter((doc) => doc.horseId === horse.id),
            ownershipRecords.find((rec) => rec.horseId === horse.id),
          ),
        ]),
      ),
    [horses, documents, ownershipRecords],
  );

  useEffect(() => {
    setSearch(searchParams.get('search') ?? '');
  }, [searchParams]);

  const setNewHorseParam = (open: boolean) => {
    const nextParams = new URLSearchParams(searchParams);
    if (open) {
      nextParams.set('new', '1');
    } else {
      nextParams.delete('new');
    }
    setSearchParams(nextParams);
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const urgencyScore = (h: typeof horses[number]) => {
      if (h.status === 'Medical Review') return 4;
      if (h.status === 'Sale Prep' && h.sale.askPrice > 0) return 3;
      if (h.status === 'In Training') return 2;
      if (h.alerts?.some((a) => a.severity === 'high')) return 3;
      return 1;
    };
    return horses
      .filter((horse) => {
        const matchesSearch =
          !term ||
          [horse.name, horse.barnName, horse.owner, horse.ownerEntity, horse.aqhaNumber, horse.location.barn]
            .join(' ')
            .toLowerCase()
            .includes(term);
        const matchesSegment = segmentFilter === 'All' || horse.segment === segmentFilter;
        return matchesSearch && matchesSegment;
      })
      .sort((a, b) => urgencyScore(b) - urgencyScore(a) || a.name.localeCompare(b.name));
  }, [horses, search, segmentFilter]);


  const [togglingListingId, setTogglingListingId] = useState<string | null>(null);

  const handleSavedHorseToggle = async (horseId: string) => {
    if (togglingListingId) return;
    const horse = horses.find((item) => item.id === horseId);
    const wasSaved = sharedListings.some((listing) => listing.horseId === horseId && listing.state !== 'Archived');
    setTogglingListingId(horseId);
    try {
      const result = await toggleSharedListing(horseId);
      pushToast({
        title: result.ok ? (wasSaved ? 'Removed from shared access' : 'Added to shared access') : 'Shared access blocked',
        message: horse && result.ok ? `${horse.name} ${wasSaved ? 'was removed from' : 'is now in'} the shared-access list.` : result.message,
        tone: result.ok ? 'success' : 'error',
      });
    } finally {
      setTogglingListingId(null);
    }
  };

  const openHorseMenu = (horseId: string, x: number, y: number) => {
    setMenuState({ horseId, x, y });
  };

  const menuHorse = filtered.find((horse) => horse.id === menuState?.horseId) ?? horses.find((horse) => horse.id === menuState?.horseId);
  const menuSaved = menuHorse ? sharedListings.some((listing) => listing.horseId === menuHorse.id && listing.state !== 'Archived') : false;
  const menuPacket = menuHorse ? packetByHorseId[menuHorse.id] : undefined;
  const menuListing = menuHorse ? sharedListings.find((listing) => listing.horseId === menuHorse.id && listing.state !== 'Archived') : undefined;
  const menuShareUrl = menuPacket
    ? buildPublicShareUrl(menuPacket.sharePath, menuListing?.accessMode === 'Private Token' ? menuListing.shareToken : undefined)
    : '';
  const menuItems = menuHorse && menuPacket
    ? [
        {
          id: 'open-profile',
          label: 'Open record',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        ...(menuSaved
          ? [
              {
                id: 'open-share-view',
                label: 'Open listing',
                onSelect: async () => {
                  await recordSharedChannel(menuHorse.id, 'Direct Link');
                  if (typeof window !== 'undefined') {
                    window.open(menuShareUrl, '_blank', 'noopener,noreferrer');
                  }
                },
              },
            ]
          : []),
        ...(canManageSharedAccess
          ? [
              {
                id: 'toggle-shared',
                label: menuSaved ? 'Remove from shared access' : 'Add to shared access',
                onSelect: async () => handleSavedHorseToggle(menuHorse.id),
              },
            ]
          : []),
        {
          id: 'open-sales',
          label: 'Open sales board',
          onSelect: () => navigate('/sales'),
        },
      ]
    : [];

  const handleCreateHorse = () => {
    const nextErrors: Partial<Record<'name' | 'owner', string>> = {};
    if (form.name.trim().length < 3) nextErrors.name = 'Registered name is required (3+ characters).';
    if (form.owner.trim().length < 2) nextErrors.owner = 'Owner is required.';

    setFormErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      return;
    }

    const result = addHorse(form);
    pushToast({
      title: result.ok ? 'Horse created' : 'Horse not created',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
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

  const totalHorses = horses.length;
  const activeSales = horses.filter(h => h.status === 'Sale Prep').length;
  const totalInsured = horses.reduce((sum, h) => sum + (h.insuredValue ?? 0), 0);
  const avgReadiness = useMemo(() => {
    if (!horses.length) return 0;
    const sum = horses.reduce((acc, h) => acc + (packetByHorseId[h.id]?.score ?? 0), 0);
    return Math.round((sum / horses.length) * 100);
  }, [horses, packetByHorseId]);
  const readyForSale = useMemo(
    () => horses.filter(h => (packetByHorseId[h.id]?.score ?? 0) >= 0.8).length,
    [horses, packetByHorseId],
  );

  return (
    <>
      <div className="ops-hero">
        <div className="ops-hero__main">
          <div className="ops-hero__eyebrow">Roster</div>
          <h1 className="ops-hero__title">Horse operations</h1>
          <p className="ops-hero__sub">Active roster, sale pipeline, and breeding program organized by record completeness.</p>
          <div className="ops-hero__chips">
            <span className="ops-briefing-chip">{totalHorses} horse{totalHorses !== 1 ? 's' : ''}</span>
            {activeSales > 0 && <span className="ops-briefing-chip ops-briefing-chip--warning">{activeSales} for sale</span>}
            {readyForSale > 0 && <span className="ops-briefing-chip ops-briefing-chip--success">{readyForSale} sale-ready</span>}
          </div>
        </div>
        <div className="ops-hero__stats">
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{totalHorses}</span>
            <span className="ops-hero__stat-label">Total horses</span>
          </div>
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{activeSales || '—'}</span>
            <span className="ops-hero__stat-label">Active sales</span>
          </div>
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{avgReadiness}%</span>
            <span className="ops-hero__stat-label">Avg readiness</span>
          </div>
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{totalInsured ? formatCompactCurrency(totalInsured) : '—'}</span>
            <span className="ops-hero__stat-label">Total insured</span>
          </div>
        </div>
      </div>

      <div className="horses-toolbar">
        <div className="inline-actions">
          <Link to="/documents?upload=1" className="button button--ghost button--compact">Upload docs</Link>
          <button className="button button--primary button--compact" type="button" onClick={() => setNewHorseParam(true)} disabled={!canCreateHorse}>New horse</button>
        </div>
      </div>

      {createOpen ? (
        <section className="panel">
            <div className="panel__header">
              <div>
                <div className="panel__eyebrow">New horse</div>
                <h2 className="panel__title">Add horse</h2>
              </div>
              <button className="button button--ghost button--compact" type="button" onClick={() => setNewHorseParam(false)}>
                Close
              </button>
          </div>
          <div className="form-grid">
            <label className="field-stack">
              <span className="field-label">Registered name</span>
              <input className="field-input" value={form.name} onChange={(event) => {
                setForm((current) => ({ ...current, name: event.target.value }));
                setFormErrors((current) => ({ ...current, name: undefined }));
              }} disabled={!canCreateHorse} />
              {formErrors.name ? <span className="field-error">{formErrors.name}</span> : null}
            </label>
            <label className="field-stack">
              <span className="field-label">Barn name</span>
              <input className="field-input" value={form.barnName} onChange={(event) => {
                setForm((current) => ({ ...current, barnName: event.target.value }));
              }} disabled={!canCreateHorse} />
            </label>
            <label className="field-stack">
              <span className="field-label">Segment</span>
              <select className="field-input" value={form.segment} onChange={(event) => setForm((current) => ({ ...current, segment: event.target.value as HorseSegment }))} disabled={!canCreateHorse}>
                {horseSegments.map((segment) => (
                  <option key={segment} value={segment}>
                    {segment}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Status</span>
              <select className="field-input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as HorseStatus }))} disabled={!canCreateHorse}>
                {horseStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Sex</span>
              <select className="field-input" value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value as HorseSex }))} disabled={!canCreateHorse}>
                {horseSexes.map((sex) => (
                  <option key={sex} value={sex}>
                    {sex}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Owner</span>
              <input className="field-input" value={form.owner} onChange={(event) => {
                setForm((current) => ({ ...current, owner: event.target.value }));
                setFormErrors((current) => ({ ...current, owner: undefined }));
              }} disabled={!canCreateHorse} />
              {formErrors.owner ? <span className="field-error">{formErrors.owner}</span> : null}
            </label>
            <label className="field-stack">
              <span className="field-label">Owner entity</span>
              <input className="field-input" value={form.ownerEntity} onChange={(event) => {
                setForm((current) => ({ ...current, ownerEntity: event.target.value }));
              }} disabled={!canCreateHorse} />
            </label>
            <label className="field-stack">
              <span className="field-label">AQHA number</span>
              <input className="field-input" value={form.aqhaNumber} onChange={(event) => setForm((current) => ({ ...current, aqhaNumber: event.target.value }))} disabled={!canCreateHorse} />
            </label>
            <label className="field-stack">
              <span className="field-label">Registration number</span>
              <input className="field-input" value={form.registrationNumber} onChange={(event) => setForm((current) => ({ ...current, registrationNumber: event.target.value }))} disabled={!canCreateHorse} />
            </label>
            <label className="field-stack">
              <span className="field-label">Barn</span>
              <input className="field-input" value={form.barn} onChange={(event) => {
                setForm((current) => ({ ...current, barn: event.target.value }));
              }} disabled={!canCreateHorse} />
            </label>
            <label className="field-stack">
              <span className="field-label">Pasture</span>
              <input className="field-input" value={form.pasture} onChange={(event) => {
                setForm((current) => ({ ...current, pasture: event.target.value }));
              }} disabled={!canCreateHorse} />
            </label>
          </div>
          <div className="inline-actions">
            <button
              className="button button--ghost"
              type="button"
              onClick={() =>
                setForm((current) => ({
                  ...current,
                  owner: workspaceProfile.defaultOwnerName,
                  ownerEntity: workspaceProfile.defaultOwnerEntity,
                  barn: workspaceProfile.defaultBarn,
                  pasture: workspaceProfile.defaultPasture,
                }))
              }
              disabled={!canCreateHorse}
            >
              Use defaults
            </button>
            <button className="button button--primary" type="button" onClick={handleCreateHorse} disabled={!canCreateHorse || form.name.trim().length < 3 || form.owner.trim().length < 2}>
              Create horse
            </button>
          </div>
        </section>
      ) : null}



      <section className="portfolio-toolbar">
        <div className="portfolio-toolbar__controls">
          <SurfaceTabs
            items={['Portfolio', 'Registry']}
            active={viewMode}
            onChange={(mode) => setViewMode(mode as ViewMode)}
          />
          <SurfaceTabs
            items={segments}
            active={segmentFilter}
            onChange={(segment) => setSegmentFilter(segment as SegmentFilter)}
            className="surface-tabs--wrap"
          />
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="field-input field-input--wide"
          placeholder="Search horse, owner, AQHA"
          aria-label="Search horses"
        />
      </section>

      {viewMode === 'Portfolio' ? (
        filtered.length ? (
        <div className="horse-grid">
          {filtered.map((horse) => {
            const saved = sharedListings.some((listing) => listing.horseId === horse.id && listing.state !== 'Archived');
            const packet = packetByHorseId[horse.id];
            return (
              <HorseCard
                key={horse.id}
                horse={horse}
                packet={packet}
                saved={saved}
                canManageSharedAccess={canManageSharedAccess}
                toggling={togglingListingId === horse.id}
                onToggleListing={handleSavedHorseToggle}
                onContextMenu={openHorseMenu}
              />
            );
          })}
        </div>
        ) : (
          <EmptyState
            icon={HorsesIcon}
            title="No horses match this view"
            description="Adjust filters, clear search, or add a horse."
            action={
              <button className="button button--primary button--compact" type="button" onClick={() => setNewHorseParam(true)} disabled={!canCreateHorse}>
                Add horse
              </button>
            }
          />
        )
      ) : filtered.length ? (
        <div className="table-shell">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Horse</th>
                <th scope="col">Segment</th>
                <th scope="col">Owner</th>
                <th scope="col">Location</th>
                <th scope="col">Docs</th>
                <th scope="col">Readiness</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((horse) => (
                <tr
                  key={horse.id}
                  className="table-row--interactive"
                  onClick={() => navigate(`/horses/${horse.id}`)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openHorseMenu(horse.id, event.clientX, event.clientY);
                  }}
                >
                  <td>
                    <Link to={`/horses/${horse.id}`} className="table-link">
                      {horse.name}
                    </Link>
                  </td>
                  <td>{horse.segment}</td>
                  <td>{horse.owner}</td>
                  <td>
                    {[horse.location.barn, horse.location.pasture].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td>{horse.documents.length}</td>
                  <td>{formatPercent(horse.readiness.score)}</td>
                  <td>
                    <Pill tone={statusTone[horse.status]}>{horse.status === 'Sale Prep' ? 'For Sale' : horse.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyState
          icon={HorsesIcon}
          title="No horses match this registry view"
          description="Adjust filters, clear search, or add a horse."
          action={
              <button className="button button--primary button--compact" type="button" onClick={() => setNewHorseParam(true)} disabled={!canCreateHorse}>
                Add horse
              </button>
          }
        />
      )}

      <ContextMenu open={Boolean(menuState && menuHorse)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
