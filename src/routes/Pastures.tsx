import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Move } from 'lucide-react';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import type { HorseRecord } from '@/types/xbar';

type Location = { id: string; name: string; kind: 'Barn' | 'Pasture'; horses: HorseRecord[] };

export default function Pastures() {
  const openQuickCreate = useUiStore((state) => state.openQuickCreate);
  const navigate = useNavigate();
  const horses = useXbarStore((s) => s.horses);
  const workspaceProfile = useXbarStore((s) => s.workspaceProfile);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const locations = useMemo<Location[]>(() => {
    const barns = new Set<string>();
    const pastures = new Set<string>();
    if (workspaceProfile.defaultBarn) barns.add(workspaceProfile.defaultBarn);
    if (workspaceProfile.defaultPasture) pastures.add(workspaceProfile.defaultPasture);
    horses.forEach((h) => {
      if (h.location.barn) barns.add(h.location.barn);
      if (h.location.pasture) pastures.add(h.location.pasture);
    });
    const mk = (name: string, kind: 'Barn' | 'Pasture'): Location => ({
      id: `${kind}:${name}`,
      name,
      kind,
      horses: horses.filter((h) => (kind === 'Barn' ? h.location.barn === name : h.location.pasture === name)),
    });
    return [...Array.from(barns).map((n) => mk(n, 'Barn')), ...Array.from(pastures).map((n) => mk(n, 'Pasture'))];
  }, [horses, workspaceProfile]);

  const selected = locations.find((l) => l.id === selectedId) ?? null;

  return (
    <>
      <PageHead
        eyebrow="Ranch"
        title="Pastures"
        subtitle="Where every horse is, what needs attention, and which locations have open issues."
        actions={
          <>
            <ActionButton
              variant="primary"
              icon={<Move size={15} />}
              onClick={() => openQuickCreate({ action: 'Move Horse' })}
            >
              Move Horse
            </ActionButton>
          </>
        }
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--xbar-text-muted)', fontSize: 13 }}>
          <MapPin size={16} /> {locations.length} location{locations.length === 1 ? '' : 's'} configured. Click a
          location to see the horses currently there.
        </div>
      </Card>

      <div className="xs-grid-2">
        {locations.map((p) => (
          <button
            key={p.id}
            type="button"
            className="xs-card"
            style={{ textAlign: 'left', cursor: 'pointer' }}
            onClick={() => setSelectedId(p.id)}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h2 className="xs-card__title" style={{ fontSize: 17 }}>
                  {p.name}
                </h2>
                <div className="xs-card__sub">
                  {p.kind} · {p.horses.length} horse{p.horses.length === 1 ? '' : 's'}
                </div>
              </div>
              <StatusChip tone={p.horses.length ? 'info' : 'neutral'}>
                {p.horses.length ? 'Occupied' : 'Empty'}
              </StatusChip>
            </div>
          </button>
        ))}
      </div>

      <SlideOverDrawer
        open={Boolean(selected)}
        title={selected?.name ?? ''}
        subtitle={selected ? `${selected.kind} · ${selected.horses.length} horses` : ''}
        onClose={() => setSelectedId(null)}
        footer={
          selected ? (
            <>
              <ActionButton
                variant="primary"
                icon={<Move size={15} />}
                onClick={() => {
                  setSelectedId(null);
                  openQuickCreate({ action: 'Move Horse', horseId: selected.horses[0]?.id });
                }}
              >
                Move Horse
              </ActionButton>
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <div className="xs-section-label">Horses currently here</div>
            {selected.horses.length ? (
              <div className="xs-mlist">
                {selected.horses.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="xs-mrow"
                    style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                    onClick={() => {
                      setSelectedId(null);
                      navigate(`/horses/${h.id}`);
                    }}
                  >
                    <span className="xs-mrow__main">
                      <span className="xs-mrow__title">{h.name}</span>
                      <span className="xs-mrow__detail">
                        {h.sex} · {h.segment}
                      </span>
                    </span>
                    <StatusChip tone="info">{h.status}</StatusChip>
                  </button>
                ))}
              </div>
            ) : (
              <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>
                No horses currently in this location.
              </p>
            )}
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}
