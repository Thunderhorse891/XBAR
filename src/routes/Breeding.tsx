import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandBrief } from '@/components/CommandBrief';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { DocumentBlock, Timeline } from '@/components/InteractionSystem';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

export default function Breeding() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const addBreedingEvent = useXbarStore((state) => state.addBreedingEvent);
  const deleteBreedingEvent = useXbarStore((state) => state.deleteBreedingEvent);
  const pushToast = useUiStore((state) => state.pushToast);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const session = useCloudStore((state) => state.session);
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || workspaceProfile.ranchManagerName || workspaceProfile.defaultOwnerName || 'Ranch Staff';
  const canManageBreeding = useCurrentRoleCapability('manageBreeding');
  const breedingHorses = horses.filter((horse) => horse.segment === 'Stud' || horse.sex === 'Mare');
  const breedingDocs = documents.filter((document) => document.type === 'Breeding Contract');
  const [selectedHorseId, setSelectedHorseId] = useState(breedingHorses[0]?.id ?? '');
  const [eventTitle, setEventTitle] = useState('Breeding milestone');
  const [eventBody, setEventBody] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventError, setEventError] = useState('');
  const [milestoneQuery, setMilestoneQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ horseId: string; eventId: string; horseName: string } | null>(null);
  const addEventFormRef = useRef<HTMLDivElement | null>(null);
  const milestoneCount = breedingHorses.reduce((sum, horse) => sum + horse.breedingTimeline.length, 0);
  const blockedHorses = breedingHorses.filter((horse) => horse.readiness.packetStatus !== 'Ready');
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
      <CommandBrief
        variant="split"
        eyebrow="Breeding"
        entity="Breeding Program"
        status={blockedHorses.length ? { label: `${blockedHorses.length} record blockers`, tone: 'amber' } : { label: 'Program records clear', tone: 'blue' }}
        summary={`${breedingHorses.length} mares and studs tracked with ${milestoneCount} program milestones on file.`}
        evidence={[
          { label: 'Program horses', value: String(breedingHorses.length), to: '/horses' },
          { label: 'Contracts', value: String(breedingDocs.length), to: '/documents' },
          { label: 'Upcoming milestones', value: String(milestoneCount) },
        ]}
        risks={blockedHorses.slice(0, 5).map((horse) => ({
          label: `${horse.name} — ${horse.readiness.packetStatus}`,
          severity: 'amber' as const,
          to: `/horses/${horse.id}`,
        }))}
        nextAction={
          canManageBreeding
            ? {
                label: 'Log breeding event',
                onClick: () => {
                  addEventFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  addEventFormRef.current?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true });
                },
              }
            : { label: 'Log breeding event', disabledReason: 'Your role cannot manage breeding records.' }
        }
      />

      <div className="metric-grid">
        <MetricCard label="Program horses" value={`${breedingHorses.length}`} detail="Mares and studs tracked in active breeding context" />
        <MetricCard label="Contract docs" value={`${breedingDocs.length}`} detail="Breeding-specific paperwork linked into the record model" tone="blue" />
        <MetricCard label="Live milestones" value={`${milestoneCount}`} detail="Timeline entries currently supporting the program" tone="blue" />
        <MetricCard label="Missing records" value={`${blockedHorses.length}`} detail="Horses still missing packet elements or imagery" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Breeding Board" title="Board">
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
                    <Pill tone="blue">{horse.segment}</Pill>
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
            <EmptyState compact title="No horses in the breeding program" description="Move a mare or stud into the breeding lane to start tracking milestones." />
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
                  <Timeline
                    label="Breeding milestones"
                    items={filtered.map(({ horse, event }) => ({
                      id: event.id,
                      date: formatDateLabel(event.date),
                      title: `${horse.name} | ${event.title}`,
                      description: event.summary,
                      onActivate: () => navigate(`/horses/${horse.id}`),
                      action: <div className="inline-actions"><button className="button button--ghost button--compact" type="button" onClick={() => navigate(`/horses/${horse.id}`)}>Open</button>{canManageBreeding ? <button className="button button--ghost button--compact" type="button" style={{ color: 'var(--rose)' }} onClick={() => setPendingDelete({ horseId: horse.id, eventId: event.id, horseName: horse.name })}>Delete</button> : null}</div>,
                    }))}
                  />
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

      <div className="dashboard-grid dashboard-grid--primary" ref={addEventFormRef}>
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
              <span className="field-label">Breeding note</span>
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
                  author: currentUserName,
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
                <DocumentBlock key={document.id} title={document.title} type={document.type} state={document.state} detail={document.summary} onActivate={() => navigate('/documents')} />
              ))}
            </div>
          ) : (
            <EmptyState compact title="No breeding contracts linked" description="Upload breeding contracts in Documents to tie program paperwork into this lane." />
          )}
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuHorse)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />

      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        tone="danger"
        title="Delete breeding record"
        consequences={[
          `The event is removed from ${pendingDelete?.horseName ?? 'this horse'}'s breeding timeline.`,
          'Deletion is recorded in the audit log.',
          'This cannot be undone.',
        ]}
        confirmLabel="Delete record"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const result = deleteBreedingEvent(pendingDelete.horseId, pendingDelete.eventId);
          pushToast({ title: result.ok ? 'Event removed' : 'Remove blocked', message: result.message, tone: result.ok ? 'warning' : 'error' });
          setPendingDelete(null);
        }}
      />
    </>
  );
}
