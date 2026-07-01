import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, MapPin, Move, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useXbarStore } from '@/store/useXbarStore';
import type { HorseRecord, WorkspaceProfile } from '@/types/xbar';

type LocationSummary = {
  id: string;
  name: string;
  ranch: string;
  barn: string;
  pasture: string;
  animals: HorseRecord[];
  alertCount: number;
  reviewCount: number;
  recentMoves: { horse: string; title: string; date: string }[];
};

const normalize = (value: string) => value.trim();
const locationKey = (ranch: string, barn: string, pasture: string) => [ranch, barn, pasture].map((value) => normalize(value).toLowerCase()).join('|');
const locationName = (barn: string, pasture: string) => normalize(pasture) || normalize(barn) || 'Unassigned location';
const plural = (count: number, label: string) => `${count} ${label}${count === 1 ? '' : 's'}`;
const locationTone = (location: LocationSummary) => (location.alertCount ? 'danger' : location.reviewCount ? 'warning' : 'success') as 'success' | 'danger' | 'warning';

function buildLocationSummaries(horses: HorseRecord[], profile: WorkspaceProfile): LocationSummary[] {
  const rows = new Map<string, LocationSummary>();

  horses.forEach((horse) => {
    const ranch = normalize(horse.location.ranch) || normalize(profile.ranchName) || 'Primary ranch';
    const barn = normalize(horse.location.barn) || 'Unassigned barn';
    const pasture = normalize(horse.location.pasture);
    const key = locationKey(ranch, barn, pasture);
    const existing =
      rows.get(key) ??
      {
        id: key || 'unassigned',
        name: locationName(barn, pasture),
        ranch,
        barn,
        pasture,
        animals: [],
        alertCount: 0,
        reviewCount: 0,
        recentMoves: [],
      };

    existing.animals.push(horse);
    existing.alertCount += horse.alerts.length;
    if (horse.status === 'Medical Review' || horse.readiness.blockers.length > 0) {
      existing.reviewCount += 1;
    }
    existing.recentMoves.push(
      ...horse.activity
        .filter((event) => /location|move|barn|pasture/i.test(`${event.title} ${event.summary}`))
        .map((event) => ({ horse: horse.name, title: event.title, date: event.date })),
    );
    rows.set(key, existing);
  });

  if (!rows.size) {
    const ranch = normalize(profile.ranchName) || 'Primary ranch';
    const barn = normalize(profile.defaultBarn) || 'Home barn';
    const pasture = normalize(profile.defaultPasture);
    rows.set(locationKey(ranch, barn, pasture), {
      id: locationKey(ranch, barn, pasture),
      name: locationName(barn, pasture),
      ranch,
      barn,
      pasture,
      animals: [],
      alertCount: 0,
      reviewCount: 0,
      recentMoves: [],
    });
  }

  return [...rows.values()].sort((left, right) => right.animals.length - left.animals.length || left.name.localeCompare(right.name));
}

export default function Pastures() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const locations = useMemo(() => buildLocationSummaries(horses, workspaceProfile), [horses, workspaceProfile]);
  const [selectedId, setSelectedId] = useState('');
  const selected = locations.find((location) => location.id === selectedId) ?? null;
  const totalAlerts = locations.reduce((sum, location) => sum + location.alertCount, 0);
  const totalAnimals = locations.reduce((sum, location) => sum + location.animals.length, 0);

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Pastures & Locations"
        subtitle="Live barn and pasture rollups from the horse records in this workspace."
        actions={
          <>
            <ActionButton icon={<Move size={15} />} onClick={() => navigate('/animals')}>Review Animals</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Animal</ActionButton>
          </>
        }
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--xbar-text-muted)', fontSize: 13 }}>
          <MapPin size={16} /> Location board is built from each animal record. Update a horse location to move it between cards.
        </div>
        <div className="inline-metrics" style={{ marginTop: 14 }}>
          <span>{plural(locations.length, 'location')}</span>
          <span>{plural(totalAnimals, 'animal')}</span>
          <span>{totalAlerts ? plural(totalAlerts, 'open alert') : 'No open location alerts'}</span>
        </div>
      </Card>

      <div className="xs-grid-2">
        {locations.map((location) => (
          <button key={location.id} type="button" className="xs-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setSelectedId(location.id)}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h2 className="xs-card__title" style={{ fontSize: 17 }}>{location.name}</h2>
                <div className="xs-card__sub">{plural(location.animals.length, 'animal')} · {location.barn} · {location.ranch}</div>
              </div>
              <StatusChip tone={locationTone(location)}>{location.alertCount ? plural(location.alertCount, 'alert') : 'Clear'}</StatusChip>
            </div>
            <div className="xs-pcard__tags" style={{ marginTop: 12 }}>
              <span className="xs-ptag xs-ptag--ok">{location.pasture || 'Barn location'}</span>
              <span className={`xs-ptag xs-ptag--${location.reviewCount ? 'check' : 'ok'}`}>{location.reviewCount ? plural(location.reviewCount, 'review') : 'No reviews'}</span>
              <span className="xs-ptag xs-ptag--ok">{location.recentMoves.length ? plural(location.recentMoves.length, 'move log') : 'No move logs'}</span>
            </div>
          </button>
        ))}
      </div>

      <SlideOverDrawer
        open={Boolean(selected)}
        title={selected?.name ?? ''}
        subtitle={selected ? `${plural(selected.animals.length, 'animal')} · ${selected.alertCount ? plural(selected.alertCount, 'open alert') : 'No open alerts'}` : ''}
        onClose={() => setSelectedId('')}
        footer={
          selected ? (
            <>
              <ActionButton icon={<Move size={15} />} onClick={() => navigate('/animals')}>Open Animals</ActionButton>
              <ActionButton variant="primary" icon={<AlertTriangle size={15} />} onClick={() => navigate('/today')}>Review Work</ActionButton>
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusChip tone={locationTone(selected)}>{selected.alertCount ? plural(selected.alertCount, 'alert') : 'No open alerts'}</StatusChip>
              <StatusChip tone={selected.reviewCount ? 'warning' : 'success'}>{selected.reviewCount ? plural(selected.reviewCount, 'review') : 'Care clear'}</StatusChip>
            </div>

            <div className="xs-section-label">Animals currently here</div>
            <dl className="xs-kv">
              <dt>Count</dt><dd>{selected.animals.length}</dd>
              <dt>Barn</dt><dd>{selected.barn}</dd>
              <dt>Pasture</dt><dd>{selected.pasture || 'Barn-only location'}</dd>
              <dt>Ranch</dt><dd>{selected.ranch}</dd>
            </dl>
            <div className="xs-mlist">
              {selected.animals.length ? (
                selected.animals.map((horse) => (
                  <button key={horse.id} type="button" className="xs-mrow" onClick={() => navigate(`/animals/${horse.id}`)}>
                    <span className="xs-mrow__main">
                      <span className="xs-mrow__title">{horse.name}</span>
                      <span className="xs-mrow__detail">{horse.barnName || horse.segment} · {horse.status}</span>
                    </span>
                    <StatusChip tone={horse.alerts.length || horse.readiness.blockers.length ? 'warning' : 'success'}>
                      {horse.alerts.length || horse.readiness.blockers.length ? 'Review' : 'Clear'}
                    </StatusChip>
                  </button>
                ))
              ) : (
                <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">No animals assigned yet</span><span className="xs-mrow__detail">Add an animal or update a horse location to populate this card.</span></span></div>
              )}
            </div>

            <div className="xs-section-label">Recent location history</div>
            <div className="xs-tl">
              {selected.recentMoves.length ? (
                selected.recentMoves.slice(0, 5).map((move) => (
                  <div className="xs-tl__row" key={`${move.horse}-${move.date}-${move.title}`}>
                    <span className="xs-tl__dot" />
                    <span><div className="xs-tl__title">{move.title}</div><div className="xs-tl__time">{move.date} · {move.horse}</div></span>
                  </div>
                ))
              ) : (
                <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">No location updates logged</div><div className="xs-tl__time">Save a horse location change to create movement history.</div></span></div>
              )}
            </div>

            <div className="xs-section-label">Open location work</div>
            <div className="xs-mlist">
              {selected.animals.flatMap((horse) => horse.alerts.map((alert) => ({ horse, alert }))).length ? (
                selected.animals.flatMap((horse) =>
                  horse.alerts.map((alert) => (
                    <div className="xs-mrow" key={alert.id}>
                      <span className="xs-mrow__main"><span className="xs-mrow__title">{alert.title}</span><span className="xs-mrow__detail">{horse.name} · {alert.summary}</span></span>
                      <StatusChip tone={alert.severity === 'high' ? 'danger' : alert.severity === 'medium' ? 'warning' : 'info'}>{alert.module}</StatusChip>
                    </div>
                  )),
                )
              ) : (
                <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">No horse alerts in this location</span><span className="xs-mrow__detail">This reflects the current horse records, not a sample task list.</span></span><StatusChip tone="success">Clear</StatusChip></div>
              )}
            </div>
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}
