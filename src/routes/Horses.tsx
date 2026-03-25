import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { MetricCard, PageHeader, Pill, ProgressBar } from '@/components/app-ui';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { useXbarStore } from '@/store/useXbarStore';
import type { HorseSegment, HorseSex, HorseStatus } from '@/types/xbar';

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

const segments: SegmentFilter[] = ['All', 'Sale Prospect', 'Stud', 'Show String', 'Retired'];
const horseSegments: HorseSegment[] = ['Broodmare', 'Stud', 'Show String', 'Sale Prospect', 'Young Stock', 'Retired'];
const horseStatuses: HorseStatus[] = ['In Training', 'Broodmare Program', 'Sale Prep', 'Medical Review', 'Pasture', 'Retired'];
const horseSexes: HorseSex[] = ['Mare', 'Stud', 'Gelding', 'Filly', 'Colt'];

export default function Horses() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const savedHorseIds = useXbarStore((state) => state.savedHorseIds);
  const toggleSavedHorse = useXbarStore((state) => state.toggleSavedHorse);
  const addHorse = useXbarStore((state) => state.addHorse);
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('Portfolio');
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('All');
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({
    name: '',
    barnName: '',
    segment: 'Sale Prospect' as HorseSegment,
    status: 'Sale Prep' as HorseStatus,
    sex: 'Mare' as HorseSex,
    owner: 'Erin Wyrick',
    ownerEntity: 'XBAR LLC',
    aqhaNumber: '',
    registrationNumber: '',
    barn: 'Barn A',
    pasture: 'Pasture 4',
  });

  const createOpen = searchParams.get('new') === '1';

  const filtered = horses.filter((horse) => {
    const matchesSearch =
      !search.trim() ||
      [horse.name, horse.barnName, horse.owner, horse.ownerEntity, horse.aqhaNumber, horse.location.barn]
        .join(' ')
        .toLowerCase()
        .includes(search.trim().toLowerCase());
    const matchesSegment = segmentFilter === 'All' || horse.segment === segmentFilter;
    return matchesSearch && matchesSegment;
  });

  const saleReady = filtered.filter((horse) => horse.readiness.score >= 80);
  const medicalWatch = filtered.filter((horse) => horse.status === 'Medical Review');
  const transferRisk = filtered.filter((horse) => horse.documents.some((documentId) => documentId.includes('transfer')));

  const handleCreateHorse = () => {
    const result = addHorse(form);
    setMessage(result.message);
    if (result.ok && result.id) {
      setForm({
        name: '',
        barnName: '',
        segment: 'Sale Prospect',
        status: 'Sale Prep',
        sex: 'Mare',
        owner: 'Erin Wyrick',
        ownerEntity: 'XBAR LLC',
        aqhaNumber: '',
        registrationNumber: '',
        barn: 'Barn A',
        pasture: 'Pasture 4',
      });
      setSearchParams({});
      navigate(`/horses/${result.id}`);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Records"
        title="Horses"
        description="Horse profiles now behave like asset dossiers: registry metadata, ownership structure, media readiness, OCR facts, and operating signals all sit in one place."
        actions={
          <div className="view-toggle">
            {(['Portfolio', 'Registry'] as ViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`view-toggle__button${viewMode === mode ? ' view-toggle__button--active' : ''}`}
                onClick={() => setViewMode(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        }
      />

      {message ? <div className="status-banner">{message}</div> : null}

      {createOpen ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <div className="panel__eyebrow">Live intake</div>
              <h2 className="panel__title">Create a horse record</h2>
              <p className="panel__description">This writes a new horse into the current workspace and keeps it there between refreshes on this browser.</p>
            </div>
            <button className="button button--ghost button--compact" type="button" onClick={() => setSearchParams({})}>
              Close
            </button>
          </div>
          <div className="form-grid">
            <label className="field-stack">
              <span className="field-label">Registered name</span>
              <input className="field-input" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Barn name</span>
              <input className="field-input" value={form.barnName} onChange={(event) => setForm((current) => ({ ...current, barnName: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Segment</span>
              <select className="field-input" value={form.segment} onChange={(event) => setForm((current) => ({ ...current, segment: event.target.value as HorseSegment }))}>
                {horseSegments.map((segment) => (
                  <option key={segment} value={segment}>
                    {segment}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Status</span>
              <select className="field-input" value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as HorseStatus }))}>
                {horseStatuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Sex</span>
              <select className="field-input" value={form.sex} onChange={(event) => setForm((current) => ({ ...current, sex: event.target.value as HorseSex }))}>
                {horseSexes.map((sex) => (
                  <option key={sex} value={sex}>
                    {sex}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Owner</span>
              <input className="field-input" value={form.owner} onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Owner entity</span>
              <input className="field-input" value={form.ownerEntity} onChange={(event) => setForm((current) => ({ ...current, ownerEntity: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">AQHA number</span>
              <input className="field-input" value={form.aqhaNumber} onChange={(event) => setForm((current) => ({ ...current, aqhaNumber: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Registration number</span>
              <input className="field-input" value={form.registrationNumber} onChange={(event) => setForm((current) => ({ ...current, registrationNumber: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Barn</span>
              <input className="field-input" value={form.barn} onChange={(event) => setForm((current) => ({ ...current, barn: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Pasture</span>
              <input className="field-input" value={form.pasture} onChange={(event) => setForm((current) => ({ ...current, pasture: event.target.value }))} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary" type="button" onClick={handleCreateHorse}>
              Create horse
            </button>
          </div>
        </section>
      ) : null}

      <div className="metric-grid">
        <MetricCard label="Portfolio" value={`${filtered.length}`} detail={`${saleReady.length} with sale-grade packets`} />
        <MetricCard label="Sale value" value={formatCompactCurrency(saleReady.reduce((sum, horse) => sum + horse.sale.askPrice, 0))} detail="Active private-market pricing" tone="amber" />
        <MetricCard label="Medical watch" value={`${medicalWatch.length}`} detail="Care-sensitive horses needing extra visibility" tone="rose" />
        <MetricCard label="Transfer risk" value={`${transferRisk.length}`} detail={`${savedHorseIds.length} horses already saved in portal flows`} tone="slate" />
      </div>

      <div className="filter-bar">
        <div className="filter-row">
          {segments.map((segment) => (
            <button
              key={segment}
              type="button"
              className={`filter-chip${segmentFilter === segment ? ' filter-chip--active' : ''}`}
              onClick={() => setSegmentFilter(segment)}
            >
              {segment}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="field-input"
          placeholder="Search by horse, AQHA, owner, or barn"
        />
      </div>

      <div className="interaction-note">
        Hover the key labels for full copy. Use the card buttons or row links below to move through the portfolio cleanly.
      </div>

      {viewMode === 'Portfolio' ? (
        <div className="horse-grid">
          {filtered.map((horse) => {
            const saved = savedHorseIds.includes(horse.id);
            return (
              <div
                key={horse.id}
                className="horse-card"
              >
                <div className="horse-card__media">
                  <img src={horse.profileImage} alt="" className="horse-card__image" />
                  <div className="horse-card__media-copy">
                    <Pill tone={statusTone[horse.status]}>{horse.status}</Pill>
                    <Pill tone="slate">{horse.segment}</Pill>
                  </div>
                </div>

                <div className="horse-card__body">
                  <div className="horse-card__top">
                    <div>
                      <div className="horse-card__title">{horse.name}</div>
                      <div className="horse-card__subtitle">
                        {horse.registry} · {horse.aqhaNumber} · {horse.sex}
                      </div>
                    </div>
                    {saved ? <Pill tone="blue">Saved</Pill> : null}
                  </div>

                  <p className="horse-card__summary">{horse.summary}</p>

                  <div className="horse-card__meta">
                    <span>{horse.owner}</span>
                    <span>{horse.location.barn}</span>
                    <span>{horse.documents.length} docs</span>
                  </div>

                  <div className="horse-card__readiness">
                    <div className="horse-card__readiness-head">
                      <span>Sale readiness</span>
                      <strong>{formatPercent(horse.readiness.score)}</strong>
                    </div>
                    <ProgressBar value={horse.readiness.score} tone={horse.readiness.score >= 85 ? 'emerald' : horse.readiness.score >= 70 ? 'amber' : 'rose'} />
                  </div>

                  <div className="token-row">
                    {horse.tags.slice(0, 3).map((tag) => (
                      <Pill key={tag}>{tag}</Pill>
                    ))}
                  </div>

                  <div className="horse-card__footer">
                    <span>{horse.sale.watchlistCount} watchers</span>
                    <span>{formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}</span>
                  </div>

                  <div className="inline-actions inline-actions--card">
                    <button className="button button--ghost button--compact" type="button" onClick={() => toggleSavedHorse(horse.id)}>
                      {saved ? 'Remove from saved' : 'Save to portal'}
                    </button>
                    <Link to={`/horses/${horse.id}`} className="button button--primary button--compact">
                      Open profile
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
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
                    <Pill tone={statusTone[horse.status]}>{horse.status}</Pill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
