import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

export default function Breeding() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const addBreedingEvent = useXbarStore((state) => state.addBreedingEvent);
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageBreeding = useCurrentRoleCapability('manageBreeding');
  const breedingHorses = horses.filter((horse) => horse.segment === 'Stud' || horse.sex === 'Mare');
  const breedingDocs = documents.filter((document) => document.type === 'Breeding Contract');
  const [selectedHorseId, setSelectedHorseId] = useState(breedingHorses[0]?.id ?? '');
  const [eventTitle, setEventTitle] = useState('Breeding milestone');
  const [eventBody, setEventBody] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventError, setEventError] = useState('');
  const [milestoneQuery, setMilestoneQuery] = useState('');
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);
  const menuHorse = breedingHorses.find((horse) => horse.id === menuState?.horseId);
  const menuItems = menuHorse
    ? [
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'prepare-event',
          label: 'Log breeding event',
          onSelect: () => setSelectedHorseId(menuHorse.id),
        },
      ]
    : [];

  return (
    <>
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Breeding Program</span>
            <h1 className="surface-hero__title">Pairings, milestones, and contracts.</h1>
            <p className="page-description" style={{ marginTop: '10px', color: 'var(--muted)' }}>
              Track mares, studs, and foaling work through a single program timeline. Every pairing should connect back to documents and verified records.
            </p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat">
              <span>Program horses</span>
              <strong>{breedingHorses.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Contracts</span>
              <strong>{breedingDocs.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Milestones</span>
              <strong>{breedingHorses.reduce((sum, horse) => sum + horse.breedingTimeline.length, 0)}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Blockers</span>
              <strong style={{ color: breedingHorses.filter((horse) => horse.readiness.packetStatus !== 'Ready').length ? 'var(--amber)' : 'var(--emerald)' }}>
                {breedingHorses.filter((horse) => horse.readiness.packetStatus !== 'Ready').length}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Program horses" value={`${breedingHorses.length}`} detail="Mares and studs tracked in active breeding context" />
        <MetricCard label="Contract docs" value={`${breedingDocs.length}`} detail="Breeding-specific paperwork linked into the record model" tone="blue" />
        <MetricCard label="Live milestones" value={`${breedingHorses.reduce((sum, horse) => sum + horse.breedingTimeline.length, 0)}`} detail="Timeline entries currently supporting the program" tone="emerald" />
        <MetricCard label="Packet blockers" value={`${breedingHorses.filter((horse) => horse.readiness.packetStatus !== 'Ready').length}`} detail="Horses still missing packet elements or imagery" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Program board" title="Board">
          {breedingHorses.length ? (
            <div className="stack-list">
              {breedingHorses.map((horse) => (
                <div
                  key={horse.id}
                  className="stack-item stack-item--interactive"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/horses/${horse.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/horses/${horse.id}`); } }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ horseId: horse.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{horse.name}</div>
                      <div className="stack-item__copy">
                        {horse.sex} · {horse.bloodline.family}
                      </div>
                    </div>
                    <Pill tone={horse.segment === 'Stud' ? 'emerald' : 'blue'}>{horse.segment}</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{horse.assignments.ranchManager}</span>
                    <span>{horse.location.barn}</span>
                    <span>{horse.breedingTimeline.length} milestones</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No breeding horses in program" description="Move a mare or stud into the breeding lane to start tracking milestones." />
          )}
        </Panel>

        <Panel eyebrow="Milestones" title="Milestones">
          {breedingHorses.some((horse) => horse.breedingTimeline.length) ? (() => {
            const allMilestones = breedingHorses.flatMap((horse) =>
              horse.breedingTimeline.map((event) => ({ horse, event })),
            );
            const filtered = milestoneQuery.trim()
              ? allMilestones.filter(({ horse, event }) =>
                  horse.name.toLowerCase().includes(milestoneQuery.toLowerCase()) ||
                  event.title.toLowerCase().includes(milestoneQuery.toLowerCase()),
                )
              : allMilestones;
            return (
              <>
                <div style={{ marginBottom: '14px' }}>
                  <input
                    className="field-input"
                    placeholder="Search horse or milestone..."
                    value={milestoneQuery}
                    onChange={(e) => setMilestoneQuery(e.target.value)}
                    style={{ maxWidth: '320px' }}
                  />
                </div>
                {filtered.length ? (
                  <div className="stack-list">
                    {filtered.map(({ horse, event }) => (
                      <div key={event.id} className="stack-item">
                        <div className="stack-item__top">
                          <div>
                            <div className="stack-item__title">{horse.name}</div>
                            <div className="stack-item__copy">{event.title}</div>
                          </div>
                          <Pill tone="slate">{formatDateLabel(event.date)}</Pill>
                        </div>
                        <div className="stack-item__copy">{event.summary}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--muted)', fontSize: '14px' }}>No milestones match "{milestoneQuery}".</p>
                )}
              </>
            );
          })() : (
            <EmptyState compact title="No breeding milestones yet" description="Log breeding events to track contracts, foaling, and program timing." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Program action" title="Add breeding event" description="Log a milestone.">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select className="field-input" value={selectedHorseId} onChange={(event) => setSelectedHorseId(event.target.value)} disabled={!canManageBreeding}>
                <option value="">Select horse</option>
                {breedingHorses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Event date</span>
              <input className="field-input" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} disabled={!canManageBreeding} />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Milestone</span>
              <input className="field-input" value={eventTitle} onChange={(event) => {
                setEventTitle(event.target.value);
                setEventError('');
              }} disabled={!canManageBreeding} />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Program note</span>
              <textarea className="field-textarea" rows={4} value={eventBody} onChange={(event) => {
                setEventBody(event.target.value);
                setEventError('');
              }} disabled={!canManageBreeding} />
            </label>
          </div>
          {eventError ? <div className="field-error">{eventError}</div> : null}
          <div className="inline-actions">
            <button
              className="button button--primary button--compact"
              type="button"
              onClick={() => {
                if (!selectedHorseId || !eventTitle.trim() || !eventBody.trim() || !eventDate.trim()) {
                  setEventError('Horse, date, milestone, and note are required.');
                  return;
                }

                const result = addBreedingEvent(selectedHorseId, {
                  title: eventTitle,
                  body: eventBody,
                  author: 'Breeding Desk',
                  date: eventDate,
                });

                pushToast({
                  title: result.ok ? 'Breeding event added' : 'Breeding event blocked',
                  message: result.message,
                  tone: result.ok ? 'success' : 'error',
                });

                if (result.ok) {
                  setEventBody('');
                  setEventError('');
                }
              }}
              disabled={!canManageBreeding}
            >
              Save breeding event
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Contracts" title="Contract coverage" description="Linked paperwork.">
          {breedingDocs.length ? (
            <div className="stack-list">
              {breedingDocs.map((document) => (
                <div key={document.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{document.title}</div>
                      <div className="stack-item__copy">{document.horseId ?? 'Unassigned horse'}</div>
                    </div>
                    <Pill tone={document.state === 'Ready' ? 'emerald' : document.state === 'Needs Review' ? 'amber' : 'blue'}>
                      {document.state}
                    </Pill>
                  </div>
                  <div className="stack-item__copy">{document.summary}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No breeding contracts linked" description="Upload breeding contracts in Documents to tie program paperwork into this lane." />
          )}
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuHorse)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
