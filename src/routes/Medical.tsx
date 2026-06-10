import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const vetDocs = documents.filter((document) => document.type === 'Vet Record' || document.type === 'Coggins');
  const kits = ranchAssets.filter((asset) => asset.category === 'Medical Kit');
  const kitHolds = kits.filter((asset) => asset.condition === 'Attention Required' || asset.condition === 'Service Soon');
  const medicalEvents = horses.flatMap((horse) =>
    horse.medicalTimeline.map((event) => ({ horseName: horse.name, veterinarian: horse.assignments.veterinarian, horseId: horse.id, ...event })),
  );
  const recentMedicalEvents = medicalEvents
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);
  const releaseBlocked = medicalWatch.length + kitHolds.length;

  const [selectedHorseId, setSelectedHorseId] = useState(() => {
    const fromRoute = searchParams.get('horse');
    if (fromRoute && horses.some((horse) => horse.id === fromRoute)) return fromRoute;
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
    eyebrow: 'Care Status',
    title: horse.name,
    description: horse.medicalTimeline[0]?.summary || horse.medicalNotes || 'No current care note is recorded.',
    facts: [
      { label: 'Care state', value: horse.status },
      { label: 'Veterinarian', value: horse.assignments.veterinarian },
      { label: 'Last visit', value: formatDateLabel(horse.lastVetVisit) },
      { label: 'Care events', value: String(horse.medicalTimeline.length) },
    ],
    actions: [
      { label: 'Open command file', path: `/horses/${horse.id}` },
      { label: 'Open Proof Vault', path: '/documents' },
    ],
  });

  const openEventDetails = (event: (typeof medicalEvents)[number]) => openRightDrawer({
    id: `medical-event-${event.id}`,
    eyebrow: 'Care Evidence',
    title: `${event.horseName}: ${event.title}`,
    description: event.summary,
    facts: [
      { label: 'Date', value: formatDateLabel(event.date) },
      { label: 'Command file', value: event.horseName },
      { label: 'Veterinarian', value: event.veterinarian },
      { label: 'Recorded by', value: event.owner },
    ],
    actions: [{ label: 'Open command file', path: `/horses/${event.horseId}` }],
  });

  const openHorseMenu = (horseId: string, x: number, y: number) => setMenuState({ type: 'horse', horseId, x, y });
  const openEventMenu = (horseId: string, eventId: string, x: number, y: number) => setMenuState({ type: 'event', horseId, eventId, x, y });

  const menuItems = menuEvent
    ? [
        { id: 'event-quick-view', label: 'Quick care review', onSelect: () => openEventDetails(menuEvent) },
        { id: 'event-open-horse', label: 'Open command file', onSelect: () => navigate(`/horses/${menuEvent.horseId}`) },
        ...(canManageMedical
          ? [
              { id: 'event-edit', label: 'Edit care evidence', onSelect: () => { setEditForm({ title: menuEvent.title, body: menuEvent.summary, date: menuEvent.date }); setEditingEventId(menuEvent.id); } },
              { id: 'event-delete', label: 'Delete care evidence', onSelect: () => { if (window.confirm('Remove this care evidence?')) deleteMedicalEvent(menuEvent.horseId, menuEvent.id); } },
            ]
          : []),
      ]
    : menuHorse
      ? [
          { id: 'quick-view', label: 'Quick care review', onSelect: () => openHorseDetails(menuHorse) },
          { id: 'open-profile', label: 'Open command file', onSelect: () => navigate(`/horses/${menuHorse.id}`) },
          { id: 'prepare-event', label: 'Add care evidence', onSelect: () => setSelectedHorseId(menuHorse.id) },
        ]
      : [];

  const saveCareEvent = () => {
    if (!selectedHorseId || !eventTitle.trim() || !eventBody.trim() || !eventDate.trim() || !eventType) {
      setEventError('Command file, date, event type, title, and care note are required.');
      return;
    }

    const result = addMedicalEvent(selectedHorseId, {
      title: eventTitle.trim(),
      body: eventBody.trim(),
      author: currentUserName,
      date: eventDate,
      type: eventType,
    });

    pushToast({ title: result.ok ? 'Care evidence logged' : 'Care evidence blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) {
      setEventBody('');
      setEventError('');
    }
  };

  const filteredEvents = timelineQuery.trim()
    ? medicalEvents.filter((event) =>
        event.horseName.toLowerCase().includes(timelineQuery.toLowerCase()) ||
        event.title.toLowerCase().includes(timelineQuery.toLowerCase()) ||
        event.summary.toLowerCase().includes(timelineQuery.toLowerCase()),
      )
    : medicalEvents;

  return (
    <>
      <div className="surface-hero surface-hero--dark care-status-hero">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Care Status</span>
            <h1>Care readiness board for holds, evidence, kits, and release confidence.</h1>
            <p className="command-center-briefing__copy">
              Control medical watch items, treatment notes, veterinarian context, care proof, and equipment readiness before a horse moves into buyer or transport workflow.
            </p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Care holds</span><strong style={{ color: medicalWatch.length ? 'var(--rose)' : 'var(--emerald)' }}>{medicalWatch.length}</strong></div>
            <div className="surface-hero__stat"><span>Care evidence</span><strong>{medicalEvents.length}</strong></div>
            <div className="surface-hero__stat"><span>Kit holds</span><strong style={{ color: kitHolds.length ? 'var(--amber)' : 'var(--emerald)' }}>{kitHolds.length}</strong></div>
            <div className="surface-hero__stat"><span>Release blockers</span><strong style={{ color: releaseBlocked ? 'var(--rose)' : 'var(--emerald)' }}>{releaseBlocked}</strong></div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Care holds" value={`${medicalWatch.length}`} detail="Command files requiring care attention" tone={medicalWatch.length ? 'rose' : 'emerald'} />
        <MetricCard label="Evidence trail" value={`${medicalEvents.length}`} detail="Care events recorded to command files" tone="blue" />
        <MetricCard label="Kit readiness" value={`${kits.length - kitHolds.length}/${kits.length}`} detail="Treatment and travel kits ready" tone={kitHolds.length ? 'amber' : 'emerald'} />
        <MetricCard label="Vet proof" value={`${vetDocs.length}`} detail="Coggins and vet records in Proof Vault" tone="slate" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Care holds" title="Files requiring clinical or handling attention" description="This is the hold board. Clear the care issue before the file moves into buyer release, hauling, or program movement.">
          {medicalWatch.length ? (
            <div className="stack-list">
              {medicalWatch.map((horse) => (
                <div key={horse.id} className="record-action-row">
                  <button type="button" className="stack-item stack-item--interactive" onClick={() => openHorseDetails(horse)} onContextMenu={(event) => { event.preventDefault(); openHorseMenu(horse.id, event.clientX, event.clientY); }}>
                    <div className="stack-item__top">
                      <div><div className="stack-item__title">{horse.name}</div><div className="stack-item__copy">{horse.medicalTimeline[0]?.title ?? horse.medicalNotes}</div></div>
                      <Pill tone="rose">Care hold</Pill>
                    </div>
                    <div className="inline-metrics"><span>{horse.assignments.veterinarian}</span><span>Last visit {formatDateLabel(horse.lastVetVisit)}</span><span>{horse.documents.length} linked proof files</span></div>
                  </button>
                  <ActionMenuButton className="record-action-row__menu icon-button icon-button--compact" label={`Open care actions for ${horse.name}`} onOpen={(x, y) => openHorseMenu(horse.id, x, y)}><DotsIcon className="icon-button__icon" /></ActionMenuButton>
                </div>
              ))}
            </div>
          ) : <EmptyState compact title="No care holds" description="No command files are currently blocked by care status." />}
        </Panel>

        <Panel eyebrow="Kit readiness" title="Medical kit and treatment asset posture" description="Equipment state matters before transport, field treatment, foaling, and emergency response.">
          {kits.length ? (
            <div className="stack-list">
              {kits.map((asset) => (
                <div key={asset.id} className="stack-item">
                  <div className="stack-item__top">
                    <div><div className="stack-item__title">{asset.name}</div><div className="stack-item__copy">{asset.location}</div></div>
                    <Pill tone={asset.condition === 'Attention Required' ? 'rose' : asset.condition === 'Service Soon' ? 'amber' : 'emerald'}>{asset.condition}</Pill>
                  </div>
                  <div className="stack-item__copy">{asset.notes}</div>
                </div>
              ))}
            </div>
          ) : <EmptyState compact title="No medical kits tracked" description="Add treatment kits in Ranch Assets so readiness is visible before field movement." />}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Care evidence intake" title="Log care evidence to a command file" description="Every note should identify the horse, date, event type, and source person. Do not let unsupported care notes drive buyer release.">
          <div className="form-grid form-grid--tight">
            <label className="field-stack"><span className="field-label">Command file</span><select className="field-input" value={selectedHorseId} onChange={(event) => setSelectedHorseId(event.target.value)} disabled={!canManageMedical}>{horses.map((horse) => <option key={horse.id} value={horse.id}>{horse.name}</option>)}</select></label>
            <label className="field-stack"><span className="field-label">Evidence date</span><input className="field-input" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} disabled={!canManageMedical} /></label>
            <label className="field-stack"><span className="field-label">Care category</span><select className="field-select" value={eventType} onChange={(event) => { setEventType(event.target.value as MedicalEventType); setEventError(''); }} disabled={!canManageMedical}>{medicalEventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
            <label className="field-stack field-stack--wide"><span className="field-label">Evidence title</span><input className="field-input" value={eventTitle} onChange={(event) => { setEventTitle(event.target.value); setEventError(''); }} disabled={!canManageMedical} /></label>
            <label className="field-stack field-stack--wide"><span className="field-label">Care note / clinical context</span><textarea className="field-textarea" rows={4} value={eventBody} onChange={(event) => { setEventBody(event.target.value); setEventError(''); }} disabled={!canManageMedical} /></label>
          </div>
          {eventError ? <div className="field-error">{eventError}</div> : null}
          <div className="inline-actions"><button className="button button--primary button--compact" type="button" onClick={saveCareEvent} disabled={!canManageMedical}>Save care evidence</button><button className="button button--ghost button--compact" type="button" onClick={() => navigate('/documents?upload=1')}>Upload care proof</button></div>
        </Panel>

        <Panel eyebrow="Recent care movement" title="Treatment and follow-up chronology" description="Newest care evidence stays visible for the next operational decision.">
          {recentMedicalEvents.length ? (
            <div className="stack-list">
              {recentMedicalEvents.map((event) => (
                <div key={event.id} className="stack-item" onContextMenu={(contextEvent) => { contextEvent.preventDefault(); openEventMenu(event.horseId, event.id, contextEvent.clientX, contextEvent.clientY); }}>
                  {editingEventId === event.id ? (
                    <div className="stack-item__top" style={{ flexDirection: 'column', gap: '8px' }}>
                      <input className="field-input" value={editForm.title} onChange={(e) => setEditForm((form) => ({ ...form, title: e.target.value }))} placeholder="Title" />
                      <input className="field-input" value={editForm.body} onChange={(e) => setEditForm((form) => ({ ...form, body: e.target.value }))} placeholder="Notes" />
                      <input className="field-input" type="date" value={editForm.date} onChange={(e) => setEditForm((form) => ({ ...form, date: e.target.value }))} />
                      <div className="inline-actions"><button className="button button--primary button--compact" type="button" onClick={() => { updateMedicalEvent(event.horseId, event.id, { title: editForm.title, summary: editForm.body, date: editForm.date }); setEditingEventId(null); }}>Save</button><button className="button button--ghost button--compact" type="button" onClick={() => setEditingEventId(null)}>Cancel</button></div>
                    </div>
                  ) : (
                    <><div className="stack-item__top"><div><div className="stack-item__title">{event.horseName}</div><div className="stack-item__copy">{event.title}</div></div><div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Pill tone="blue">{formatDateLabel(event.date)}</Pill><button className="button button--ghost button--compact" style={{ fontSize: '11px' }} type="button" onClick={() => { setEditForm({ title: event.title, body: event.summary, date: event.date }); setEditingEventId(event.id); }}>Edit</button><button className="button button--ghost button--compact" style={{ fontSize: '11px', color: 'var(--rose)' }} type="button" onClick={() => { if (window.confirm('Remove this care evidence?')) deleteMedicalEvent(event.horseId, event.id); }}>Delete</button></div></div><div className="stack-item__copy">{event.summary}</div></>
                  )}
                </div>
              ))}
            </div>
          ) : <EmptyState compact title="No care evidence yet" description="Saved care evidence appears here once logged." />}
        </Panel>
      </div>

      <Panel eyebrow="Care chronology" title="Searchable care evidence trail" description="Use this trail to verify what happened, who was involved, and which command file carries the evidence.">
        {medicalEvents.length > 0 ? <div style={{ marginBottom: '14px' }}><input className="field-input" placeholder="Search command file, event title, or note..." value={timelineQuery} onChange={(event) => setTimelineQuery(event.target.value)} style={{ maxWidth: '420px' }} /></div> : null}
        {medicalEvents.length ? (
          filteredEvents.length ? <div className="table-shell"><table className="data-table"><thead><tr><th>Command file</th><th>Care evidence</th><th>Vet</th><th>Date</th></tr></thead><tbody>{filteredEvents.map((event) => <tr key={event.id} className="table-row--interactive" role="button" tabIndex={0} aria-label={`Open ${event.title} for ${event.horseName}`} title="Press Enter to open details. Press Shift+F10 for actions." onClick={() => openEventDetails(event)} onKeyDown={(keyboardEvent) => { if (keyboardEvent.key === 'Enter' || keyboardEvent.key === ' ') { keyboardEvent.preventDefault(); openEventDetails(event); } }} onContextMenu={(contextEvent) => { contextEvent.preventDefault(); openEventMenu(event.horseId, event.id, contextEvent.clientX, contextEvent.clientY); }}><td>{event.horseName}</td><td>{event.title}</td><td>{event.veterinarian}</td><td>{formatDateLabel(event.date)}</td></tr>)}</tbody></table></div> : <p style={{ color: 'var(--muted)', fontSize: '14px' }}>No care evidence matches "{timelineQuery}".</p>
        ) : <EmptyState title="No care evidence trail yet" description="Create care evidence to start the chronology." />}
      </Panel>

      <ContextMenu open={Boolean(menuHorse || menuEvent)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
