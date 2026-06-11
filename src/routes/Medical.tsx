import { useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CommandBrief } from '@/components/CommandBrief';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { ActionMenuButton } from '@/components/InteractionSystem';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { DotsIcon } from '@/components/icons';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCloudStore } from '@/store/useCloudStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { MedicalEventType } from '@/types/xbar';
import { medicalEventTypes } from '@/features/health/constants';

export default function Medical() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const addMedicalEvent = useXbarStore((state) => state.addMedicalEvent);
  const updateMedicalEvent = useXbarStore((state) => state.updateMedicalEvent);
  const deleteMedicalEvent = useXbarStore((state) => state.deleteMedicalEvent);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const session = useCloudStore((state) => state.session);
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || workspaceProfile.ranchManagerName || workspaceProfile.defaultOwnerName || 'Ranch Staff';
  const pushToast = useUiStore((state) => state.pushToast);
  const openRightDrawer = useUiStore((state) => state.openRightDrawer);
  const canManageMedical = useCurrentRoleCapability('manageMedical');
  const medicalWatch = horses.filter((horse) => horse.status === 'Medical Review');
  const medicalEvents = horses.flatMap((horse) =>
    horse.medicalTimeline.map((event) => ({
      horseName: horse.name,
      veterinarian: horse.assignments.veterinarian,
      horseId: horse.id,
      ...event,
    })),
  );
  const kits = ranchAssets.filter((asset) => asset.category === 'Medical Kit');
  const vetDocCount = documents.filter((document) => document.type === 'Vet Record' || document.type === 'Coggins').length;
  const today = new Date().toISOString().slice(0, 10);
  const soonCutoff = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const followUps = medicalEvents.flatMap((event) => {
    const due = event.details && 'followUpDue' in event.details ? event.details.followUpDue : undefined;
    return due ? [{ ...event, followUpDue: due }] : [];
  });
  const overdueFollowUps = followUps.filter((event) => event.followUpDue <= today);
  const dueSoonFollowUps = followUps.filter((event) => event.followUpDue > today && event.followUpDue <= soonCutoff);
  const addEventFormRef = useRef<HTMLDivElement | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ horseId: string; eventId: string; horseName: string } | null>(null);
  const [selectedHorseId, setSelectedHorseId] = useState(() => {
    const fromRoute = searchParams.get('horse');
    if (fromRoute && horses.some((h) => h.id === fromRoute)) return fromRoute;
    return medicalWatch[0]?.id ?? horses[0]?.id ?? '';
  });
  const [eventTitle, setEventTitle] = useState('Vet follow-up');
  const [eventBody, setEventBody] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventType, setEventType] = useState<MedicalEventType>('Vet visit');
  const [eventError, setEventError] = useState('');
  const [timelineQuery, setTimelineQuery] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', body: '', date: '' });
  const [menuState, setMenuState] = useState<
    | { type: 'horse'; horseId: string; x: number; y: number }
    | { type: 'event'; horseId: string; eventId: string; x: number; y: number }
    | null
  >(null);
  const menuHorse = horses.find((horse) => horse.id === menuState?.horseId);
  const menuEvent = menuState?.type === 'event' ? medicalEvents.find((event) => event.id === menuState.eventId && event.horseId === menuState.horseId) : undefined;
  const openHorseDetails = (horse: (typeof horses)[number]) => openRightDrawer({
    id: `medical-horse-${horse.id}`,
    eyebrow: 'Medical watch',
    title: horse.name,
    description: horse.medicalTimeline[0]?.summary || horse.medicalNotes,
    facts: [
      { label: 'Status', value: horse.status },
      { label: 'Veterinarian', value: horse.assignments.veterinarian },
      { label: 'Last visit', value: formatDateLabel(horse.lastVetVisit) },
      { label: 'Care events', value: String(horse.medicalTimeline.length) },
    ],
    actions: [{ label: 'Open horse record', path: `/horses/${horse.id}` }],
  });
  const openEventDetails = (event: (typeof medicalEvents)[number]) => openRightDrawer({
    id: `medical-event-${event.id}`,
    eyebrow: event.category,
    title: `${event.horseName}: ${event.title}`,
    description: event.summary,
    facts: [
      { label: 'Date', value: formatDateLabel(event.date) },
      { label: 'Horse', value: event.horseName },
      { label: 'Veterinarian', value: event.veterinarian },
      { label: 'Owner', value: event.owner },
    ],
    actions: [{ label: 'Open horse record', path: `/horses/${event.horseId}` }],
  });
  const openHorseMenu = (horseId: string, x: number, y: number) => setMenuState({ type: 'horse', horseId, x, y });
  const openEventMenu = (horseId: string, eventId: string, x: number, y: number) => setMenuState({ type: 'event', horseId, eventId, x, y });
  const menuItems = menuEvent
    ? [
        {
          id: 'event-quick-view',
          label: 'Quick view',
          onSelect: () => openEventDetails(menuEvent),
        },
        {
          id: 'event-open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuEvent.horseId}`),
        },
        ...(canManageMedical
          ? [
              {
                id: 'event-edit',
                label: 'Edit care event',
                onSelect: () => {
                  setEditForm({ title: menuEvent.title, body: menuEvent.summary, date: menuEvent.date });
                  setEditingEventId(menuEvent.id);
                },
              },
              {
                id: 'event-delete',
                label: 'Delete care event',
                onSelect: () => {
                  setPendingDelete({ horseId: menuEvent.horseId, eventId: menuEvent.id, horseName: menuEvent.horseName });
                },
              },
            ]
          : []),
      ]
    : menuHorse
    ? [
        {
          id: 'quick-view',
          label: 'Quick view',
          onSelect: () => openHorseDetails(menuHorse),
        },
        {
          id: 'open-profile',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'prepare-event',
          label: 'Add care event',
          onSelect: () => setSelectedHorseId(menuHorse.id),
        },
      ]
    : [];

  return (
    <>
      <CommandBrief
        variant="wide"
        eyebrow="Health & Care"
        entity="Health & Care Command"
        status={
          medicalWatch.length || overdueFollowUps.length
            ? { label: 'Care overdue', tone: 'rose' }
            : dueSoonFollowUps.length
              ? { label: 'Follow-ups due soon', tone: 'amber' }
              : { label: 'On schedule', tone: 'blue' }
        }
        summary={`${medicalWatch.length} horses on watch across ${medicalEvents.length} recorded care events.`}
        evidence={[
          { label: 'Watch', value: String(medicalWatch.length) },
          { label: 'Timeline entries', value: String(medicalEvents.length) },
          { label: 'Vet docs', value: String(vetDocCount), to: '/documents' },
        ]}
        risks={[
          ...medicalWatch.map((horse) => ({
            label: `${horse.name} — on medical watch`,
            severity: 'rose' as const,
            to: `/horses/${horse.id}`,
          })),
          ...overdueFollowUps.map((event) => ({
            label: `${event.horseName} — ${event.title} follow-up overdue`,
            severity: 'rose' as const,
            to: `/horses/${event.horseId}`,
          })),
          ...dueSoonFollowUps.map((event) => ({
            label: `${event.horseName} — ${event.title} follow-up due ${formatDateLabel(event.followUpDue)}`,
            severity: 'amber' as const,
            to: `/horses/${event.horseId}`,
          })),
        ].slice(0, 5)}
        nextAction={
          canManageMedical
            ? {
                label: 'Log care event',
                onClick: () => {
                  addEventFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  addEventFormRef.current?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true });
                },
              }
            : { label: 'Log care event', disabledReason: 'Your role cannot manage medical records.' }
        }
      />

      <div className="metric-grid">
        <MetricCard label="Watchlist" value={`${medicalWatch.length}`} detail="Horses needing care attention" tone="rose" />
        <MetricCard label="Timeline entries" value={`${medicalEvents.length}`} detail="Care records on file" />
        <MetricCard label="Medical kits" value={`${kits.length}`} detail="Travel and treatment kits" tone="blue" />
        <MetricCard label="Vet-linked docs" value={`${vetDocCount}`} detail="Medical docs linked" tone="blue" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="On Watch" title="Watch">
          {medicalWatch.length ? (
            <div className="stack-list">
              {medicalWatch.map((horse) => (
                <div key={horse.id} className="record-action-row">
                  <button
                    type="button"
                    className="stack-item stack-item--interactive"
                    onClick={() => navigate(`/horses/${horse.id}`)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openHorseMenu(horse.id, event.clientX, event.clientY);
                    }}
                  >
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{horse.name}</div>
                        <div className="stack-item__copy">{horse.medicalTimeline[0]?.title ?? horse.medicalNotes}</div>
                      </div>
                      <Pill tone="rose">Watch</Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{horse.assignments.veterinarian}</span>
                      <span>Last visit {formatDateLabel(horse.lastVetVisit)}</span>
                      <span>{horse.documents.length} linked docs</span>
                    </div>
                  </button>
                  <ActionMenuButton
                    className="record-action-row__menu icon-button icon-button--compact"
                    label={`Open medical actions for ${horse.name}`}
                    onOpen={(x, y) => openHorseMenu(horse.id, x, y)}
                  >
                    <DotsIcon className="icon-button__icon" />
                  </ActionMenuButton>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No horses on medical watch" description="Add a care event to start the watchlist." />
          )}
        </Panel>

        <Panel eyebrow="Medical Kits" title="Kits">
          {kits.length ? (
            <div className="stack-list">
              {kits.map((asset) => (
                <div key={asset.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{asset.name}</div>
                      <div className="stack-item__copy">{asset.location}</div>
                    </div>
                    <Pill tone={asset.condition === 'Attention Required' ? 'rose' : asset.condition === 'Service Soon' ? 'amber' : 'blue'}>
                      {asset.condition}
                    </Pill>
                  </div>
                  <div className="stack-item__copy">{asset.notes}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No medical kits tracked" description="Add kits in Ranch Toolkit." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary" ref={addEventFormRef}>
        <Panel eyebrow="Care action" title="Add care event">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select className="field-input" value={selectedHorseId} onChange={(event) => setSelectedHorseId(event.target.value)} disabled={!canManageMedical}>
                {horses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Event date</span>
              <input className="field-input" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} disabled={!canManageMedical} />
            </label>
            <label className="field-stack">
              <span className="field-label">Event type</span>
              <select
                className="field-select"
                value={eventType}
                onChange={(event) => {
                  setEventType(event.target.value as MedicalEventType);
                  setEventError('');
                }}
                disabled={!canManageMedical}
              >
                {medicalEventTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Event title</span>
              <input className="field-input" value={eventTitle} onChange={(event) => {
                setEventTitle(event.target.value);
                setEventError('');
              }} disabled={!canManageMedical} />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Care note</span>
              <textarea className="field-textarea" rows={4} value={eventBody} onChange={(event) => {
                setEventBody(event.target.value);
                setEventError('');
              }} disabled={!canManageMedical} />
            </label>
          </div>
          {eventError ? <div className="field-error">{eventError}</div> : null}
          <div className="inline-actions">
            <button
              className="button button--primary button--compact"
              type="button"
              onClick={() => {
                if (!selectedHorseId || !eventTitle.trim() || !eventBody.trim() || !eventDate.trim() || !eventType) {
                  setEventError('Horse, date, event type, title, and care note are required.');
                  return;
                }

                const result = addMedicalEvent(selectedHorseId, {
                  title: eventTitle,
                  body: eventBody,
                  author: currentUserName,
                  date: eventDate,
                  type: eventType,
                });

                pushToast({
                  title: result.ok ? 'Medical event added' : 'Medical event blocked',
                  message: result.message,
                  tone: result.ok ? 'success' : 'error',
                });

                if (result.ok) {
                  setEventBody('');
                  setEventError('');
                }
              }}
              disabled={!canManageMedical}
            >
              Save care event
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Next up" title="Cadence">
          {medicalEvents.length ? (
            <div className="stack-list">
              {medicalEvents.slice(0, 5).map((event) => (
                <div key={event.id} className="stack-item">
                  {editingEventId === event.id ? (
                    <div className="stack-item__top" style={{ flexDirection: 'column', gap: '8px' }}>
                      <input className="field-input" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" />
                      <input className="field-input" value={editForm.body} onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))} placeholder="Notes" />
                      <input className="field-input" type="date" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} />
                      <div className="inline-actions">
                        <button className="button button--primary button--compact" type="button" onClick={() => { updateMedicalEvent(event.horseId, event.id, { title: editForm.title, summary: editForm.body, date: editForm.date }); setEditingEventId(null); }}>Save</button>
                        <button className="button button--ghost button--compact" type="button" onClick={() => setEditingEventId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{event.horseName}</div>
                          <div className="stack-item__copy">{event.title}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <Pill tone="blue">{formatDateLabel(event.date)}</Pill>
                          <button className="button button--ghost button--compact" style={{ fontSize: '11px' }} type="button" onClick={() => { setEditForm({ title: event.title, body: event.summary, date: event.date }); setEditingEventId(event.id); }}>Edit</button>
                          <button className="button button--ghost button--compact" style={{ fontSize: '11px', color: 'var(--rose)' }} type="button" onClick={() => setPendingDelete({ horseId: event.horseId, eventId: event.id, horseName: event.horseName })}>Delete</button>
                        </div>
                      </div>
                      <div className="stack-item__copy">{event.summary}</div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No care cadence yet" description="Saved events will appear here." />
          )}
        </Panel>
      </div>

      <Panel eyebrow="Timeline" title="Timeline">
        {medicalEvents.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            <input
              className="field-input"
              placeholder="Search by horse name or event title…"
              value={timelineQuery}
              onChange={(e) => setTimelineQuery(e.target.value)}
              style={{ maxWidth: '380px' }}
            />
          </div>
        )}
        {medicalEvents.length ? (() => {
          const filtered = timelineQuery.trim()
            ? medicalEvents.filter((ev) =>
                ev.horseName.toLowerCase().includes(timelineQuery.toLowerCase()) ||
                ev.title.toLowerCase().includes(timelineQuery.toLowerCase()),
              )
            : medicalEvents;
          return filtered.length ? (
            <div className="table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Horse</th>
                    <th>Event</th>
                    <th>Vet</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event) => (
                    <tr
                      key={event.id}
                      className="table-row--interactive"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${event.title} for ${event.horseName}`}
                      title="Press Enter to open details. Press Shift+F10 for actions."
                      onClick={() => openEventDetails(event)}
                      onKeyDown={(keyboardEvent) => {
                        if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') {
                          keyboardEvent.preventDefault();
                          openEventDetails(event);
                        }
                      }}
                      onContextMenu={(contextEvent) => {
                        contextEvent.preventDefault();
                        openEventMenu(event.horseId, event.id, contextEvent.clientX, contextEvent.clientY);
                      }}
                    >
                      <td>{event.horseName}</td>
                      <td>{event.title}</td>
                      <td>{event.veterinarian}</td>
                      <td>{formatDateLabel(event.date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: '14px' }}>No events match "{timelineQuery}".</p>
          );
        })() : (
          <EmptyState title="No medical timeline yet" description="Create a care event to start the timeline." />
        )}
      </Panel>

      <ContextMenu open={Boolean(menuHorse || menuEvent)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />

      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        tone="danger"
        title="Delete medical record"
        consequences={[
          `The event is removed from ${pendingDelete?.horseName ?? 'this horse'}'s medical timeline.`,
          'Deletion is recorded in the audit log.',
          'This cannot be undone.',
        ]}
        confirmLabel="Delete record"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const result = deleteMedicalEvent(pendingDelete.horseId, pendingDelete.eventId);
          pushToast({
            title: result.ok ? 'Medical record deleted' : 'Delete blocked',
            message: result.message,
            tone: result.ok ? 'warning' : 'error',
          });
          setPendingDelete(null);
        }}
      />
    </>
  );
}
