import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
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
    return horses.filter((horse) => {
      const matchesSearch =
        !term ||
        [horse.name, horse.barnName, horse.owner, horse.ownerEntity, horse.aqhaNumber, horse.location.barn]
          .join(' ')
          .toLowerCase()
          .includes(term);
      const matchesSegment = segmentFilter === 'All' || horse.segment === segmentFilter;
      return matchesSearch && matchesSegment;
    });
  }, [horses, search, segmentFilter]);


  const handleSavedHorseToggle = async (horseId: string) => {
    const horse = horses.find((item) => item.id === horseId);
    const wasSaved = sharedListings.some((listing) => listing.horseId === horseId && listing.state !== 'Archived');
    const result = await toggleSharedListing(horseId);
    pushToast({
      title: result.ok ? (wasSaved ? 'Removed from shared access' : 'Added to shared access') : 'Shared access blocked',
      message: horse && result.ok ? `${horse.name} ${wasSaved ? 'was removed from' : 'is now in'} the shared-access list.` : result.message,
      tone: result.ok ? 'success' : 'error',
    });
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

  return (
    <>
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Horse Operations</span>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Total horses</span><strong>{horses.length}</strong></div>
            <div className="surface-hero__stat"><span>Medical watch</span><strong className={horses.filter((h) => h.status === 'Medical Review').length ? 'text-rose' : 'text-emerald'}>{horses.filter((h) => h.status === 'Medical Review').length}</strong></div>
            <div className="surface-hero__stat"><span>For sale</span><strong>{horses.filter((h) => h.status === 'Sale Prep').length}</strong></div>
            <div className="surface-hero__stat"><span>Packet ready</span><strong className="text-emerald">{horses.filter((h) => h.readiness.packetStatus === 'Ready').length}</strong></div>
          </div>
          <div className="inline-actions" style={{ marginTop: '16px' }}>
            <Link to="/documents?upload=1" className="button button--ghost button--compact">Upload docs</Link>
            <button className="button button--primary button--compact" type="button" onClick={() => setNewHorseParam(true)} disabled={!canCreateHorse}>New horse</button>
          </div>
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
            <button className="button button--primary" type="button" onClick={handleCreateHorse} disabled={!canCreateHorse || !form.name.trim() || !form.owner.trim()}>
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
            const valueLabel = horse.segment === 'Sale Prospect' && horse.sale.askPrice ? 'Ask' : 'Insured';
            const accessLabel = saved ? 'Shared' : 'Private';
            const showSaleSignals = horse.segment === 'Sale Prospect' || horse.status === 'Sale Prep';
            return (
              <Link
                key={horse.id}
                className="horse-card horse-card--interactive"
                to={`/horses/${horse.id}`}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openHorseMenu(horse.id, event.clientX, event.clientY);
                }}
              >
                <div className="horse-card__media">
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
                    <button
                      className="icon-button icon-button--compact"
                      type="button"
                      aria-label="Open quick actions"
                      onClick={(event) => {
                        event.stopPropagation();
                        const bounds = event.currentTarget.getBoundingClientRect();
                        openHorseMenu(horse.id, bounds.left, bounds.bottom + 8);
                      }}
                    >
                      <DotsIcon className="icon-button__icon" />
                    </button>
                  </div>
                  <div className="horse-card__media-bottom">
                    <div className="horse-card__kicker">{horse.segment}</div>
                    <div className="horse-card__title">{horse.name}</div>
                    <div className="horse-card__subtitle">
                      {horse.registry} · {horse.sex} · {horse.location.barn}
                    </div>
                  </div>
                </div>

                <div className="horse-card__body">
                  <div className="horse-card__metric-band">
                    <div className="horse-card__metric">
                      <span>Record</span>
                      <strong>{formatPercent(packet.score)}</strong>
                    </div>
                    <div className="horse-card__metric">
                      <span>{valueLabel}</span>
                      <strong>{formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}</strong>
                    </div>
                    <div className="horse-card__metric">
                      <span>Share</span>
                      <strong>{accessLabel}</strong>
                    </div>
                  </div>

                  <div className="horse-card__facts">
                    <span className="horse-card__fact">
                      <strong>Owner</strong>
                      {horse.owner}
                    </span>
                    <span className="horse-card__fact">
                      <strong>Barn</strong>
                      {horse.location.barn}
                    </span>
                    <span className="horse-card__fact">
                      <strong>AQHA</strong>
                      {horse.aqhaNumber || horse.registrationNumber || 'Pending'}
                    </span>
                  </div>

                  {showSaleSignals ? (
                    <div className="horse-card__readiness">
                      <div className="horse-card__readiness-head">
                        <span>Sale readiness</span>
                        <strong>{formatPercent(packet.score)}</strong>
                      </div>
                      <ProgressBar value={packet.score} tone={packet.tone} />
                    </div>
                  ) : (
                    <div className="horse-card__readiness horse-card__readiness--meta">
                      <div className="horse-card__readiness-head">
                        <span>Care status</span>
                        <strong>{horse.status === 'Sale Prep' ? 'For Sale' : horse.status}</strong>
                      </div>
                      <div className="inline-metrics">
                        <span>{horse.gallery.length} assets</span>
                        <span>{packet.readyCount} clear</span>
                        <span>{horse.location.barn}</span>
                      </div>
                    </div>
                  )}

                  <div className="horse-card__packet">
                    <div className="horse-card__packet-head">
                      <span>Sale packet</span>
                      <strong>{packet.saleSlots.filter((slot) => slot.status === 'ready').length}/{packet.saleSlots.length}</strong>
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
                        onClick={async (event) => {
                          event.stopPropagation();
                          await handleSavedHorseToggle(horse.id);
                        }}
                        disabled={!canManageSharedAccess}
                      >
                        {saved ? 'Remove listing' : 'List for sale'}
                      </button>
                      <Link
                        to={`/horses/${horse.id}`}
                        className="button button--primary button--compact"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Record
                      </Link>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
        ) : (
          <EmptyState
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
                <th>Horse</th>
                <th>Segment</th>
                <th>Owner</th>
                <th>Location</th>
                <th>Docs</th>
                <th>Readiness</th>
                <th>Status</th>
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
                    {horse.location.barn} · {horse.location.pasture}
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
