import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MetricCard, PageHeader, Pill, ProgressBar } from '@/components/app-ui';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { useXbarStore } from '@/store/useXbarStore';
import type { HorseSegment, HorseStatus } from '@/types/xbar';

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

export default function Horses() {
  const horses = useXbarStore((state) => state.horses);
  const savedHorseIds = useXbarStore((state) => state.savedHorseIds);
  const [searchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>('Portfolio');
  const [segmentFilter, setSegmentFilter] = useState<SegmentFilter>('All');
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

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
  const segments: SegmentFilter[] = ['All', 'Sale Prospect', 'Stud', 'Show String', 'Retired'];

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

      {viewMode === 'Portfolio' ? (
        <div className="horse-grid">
          {filtered.map((horse) => (
            <Link key={horse.id} to={`/horses/${horse.id}`} className="horse-card">
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
                  {savedHorseIds.includes(horse.id) ? <Pill tone="blue">Saved</Pill> : null}
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
              </div>
            </Link>
          ))}
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
                <tr key={horse.id}>
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
