import { Fragment, useMemo, useState } from 'react';
import { useConfirm } from '@/components/ConfirmDialog';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { MedicalIcon } from '@/components/icons';
import { buildCareBoardRows } from '@/lib/dashboardOps';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCloudStore } from '@/store/useCloudStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { MedicalEventType } from '@/types/xbar';
import { medicalEventTypes } from '@/features/health/constants';
import './operationsExperience.css';

const EVENT_TYPE_TONE: Record<string, 'blue' | 'rose' | 'amber' | 'emerald' | 'slate'> = {
  'Vet visit': 'blue',
  'Wormer': 'emerald',
  'Dental': 'amber',
  'Coggins': 'blue',
  'Vaccination': 'emerald',
  'Injury': 'rose',
  'Surgery': 'rose',
};

export default function Medical() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const addMedicalEvent = useXbarStore((state) => state.addMedicalEvent);
  const updateMedicalEvent = useXbarStore((state) => state.updateMedicalEvent);
  const deleteMedicalEvent = useXbarStore((state) => state.deleteMedicalEvent);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const session = useCloudStore((state) => state.session);
  const currentUserName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.email?.split('@')[0] ||
    workspaceProfile.ranchManagerName ||
    workspaceProfile.defaultOwnerName ||
    'Ranch Staff';
  const { pushToast, openDrawer } = useUiStore((state) => ({ pushToast: state.pushToast, openDrawer: state.openDrawer }));
  const canManageMedical = useCurrentRoleCapability('manageMedical');

  const medicalWatch = useMemo(() => horses.filter((h) => h.status === 'Medical Review'), [horses]);
  const medicalEvents = useMemo(
    () =>
      horses
        .flatMap((h) =>
          h.medicalTimeline.map((event) => ({
            horseName: h.name,
            veterinarian: h.assignments.veterinarian,
            horseId: h.id,
            ...event,
          })),
        )
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [horses],
  );
  const kits = ranchAssets.filter((a) => a.category === 'Medical Kit');
  const careBoard = useMemo(() => buildCareBoardRows(horses, documents, expenseReceipts), [horses, documents, expenseReceipts]);
  const careDueRows = useMemo(() => careBoard.filter((r) => r.signals.some((s) => s.status === 'due')), [careBoard]);
  const careWatchRows = useMemo(() => careBoard.filter((r) => r.signals.some((s) => s.status === 'watch') && !r.signals.some((s) => s.status === 'due')), [careBoard]);
  const wormerDueCount = useMemo(() => careBoard.filter((r) => r.signals.some((s) => s.key === 'wormer' && s.status !== 'clear')).length, [careBoard]);
  const dentalDueCount = useMemo(() => careBoard.filter((r) => r.signals.some((s) => s.key === 'dental' && s.status !== 'clear')).length, [careBoard]);
  const cogginsDueCount = useMemo(() => careBoard.filter((r) => r.signals.some((s) => s.key === 'coggins' && s.status !== 'clear')).length, [careBoard]);

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
  const [editForm, setEditForm] = useState({ title: '', body: '', date: '', type: '' });
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);

  const menuHorse = horses.find((h) => h.id === menuState?.horseId);
  const menuItems = menuHorse
    ? [
        { id: 'open-profile', label: 'Open horse profile', onSelect: () => navigate(`/horses/${menuHorse.id}`) },
        { id: 'prepare-event', label: 'Add care event', onSelect: () => setSelectedHorseId(menuHorse.id) },
        { id: 'view-health-drawer', label: 'Quick view health', onSelect: () => openDrawer({ type: 'horse-health', horseId: menuHorse.id }) },
      ]
    : [];

  return (
    <>
      {confirmDialog}

      <div className="ops-hero">
        <div className="ops-hero__main">
          <div className="ops-hero__eyebrow">Health & Care</div>
          <h1 className="ops-hero__title">Medical</h1>
          <p className="ops-hero__sub">Vet visits, wormer schedules, dental, and Coggins — log care events, track the watchlist, and keep every horse's health timeline current.</p>
          <div className="ops-hero__chips">
            {medicalWatch.length > 0 ? (
              <span className="ops-briefing-chip ops-briefing-chip--warning">{medicalWatch.length} on watch</span>
            ) : (
              <span className="ops-briefing-chip ops-briefing-chip--success">No horses on watch</span>
            )}
            {careDueRows.length > 0 && <span className="ops-briefing-chip ops-briefing-chip--warning">{careDueRows.length} care due</span>}
            <span className="ops-briefing-chip">{medicalEvents.length} timeline event{medicalEvents.length !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="ops-hero__stats">
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{medicalWatch.length || '—'}</span>
            <span className="ops-hero__stat-label">On watch</span>
          </div>
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{careDueRows.length || '—'}</span>
            <span className="ops-hero__stat-label">Care due</span>
          </div>
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{medicalEvents.length}</span>
            <span className="ops-hero__stat-label">Timeline events</span>
          </div>
          <div className="ops-hero__stat">
            <span className="ops-hero__stat-value">{documents.filter((d) => d.type === 'Vet Record' || d.type === 'Coggins').length}</span>
            <span className="ops-hero__stat-label">Vet docs</span>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Watchlist" value={`${medicalWatch.length}`} detail="Horses needing care attention" tone={medicalWatch.length ? 'rose' : 'emerald'} />
        <MetricCard label="Wormer due" value={`${wormerDueCount}`} detail="Overdue or expiring soon" tone={wormerDueCount ? 'amber' : 'emerald'} />
        <MetricCard label="Dental due" value={`${dentalDueCount}`} detail="Annual float approaching" tone={dentalDueCount ? 'amber' : 'emerald'} />
        <MetricCard label="Coggins watch" value={`${cogginsDueCount}`} detail="Expiring or missing certificates" tone={cogginsDueCount ? 'amber' : 'emerald'} />
      </div>

      {(careDueRows.length > 0 || careWatchRows.length > 0) && (
        <Panel
          eyebrow="Care board"
          title="Care signals"
          meta={<Pill tone={careDueRows.length ? 'rose' : 'amber'}>{careDueRows.length + careWatchRows.length} flagged</Pill>}
          action={<Link to="/medical" className="button button--ghost button--compact">Refresh</Link>}
        >
          <div className="stack-list">
            {[...careDueRows, ...careWatchRows].slice(0, 8).map((row) => (
              <button
                key={row.horseId}
                type="button"
                className="stack-item stack-item--interactive"
                onClick={() => openDrawer({ type: 'horse-health', horseId: row.horseId })}
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuState({ horseId: row.horseId, x: event.clientX, y: event.clientY });
                }}
              >
                <div className="stack-item__top">
                  <div className="stack-item__title">{row.horseName}</div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    {row.signals.filter((s) => s.status !== 'clear').map((sig) => (
                      <Pill key={sig.key} tone={sig.status === 'due' ? 'rose' : 'amber'}>{sig.label}</Pill>
                    ))}
                  </div>
                </div>
                <div className="inline-metrics">
                  {row.signals.filter((s) => s.status !== 'clear').map((sig) => (
                    <span key={sig.key}>{sig.detail}</span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </Panel>
      )}

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="On Watch" title="Medical watch">
          {medicalWatch.length ? (
            <div className="stack-list">
              {medicalWatch.map((horse) => {
                const careRow = careBoard.find((r) => r.horseId === horse.id);
                return (
                  <div
                    key={horse.id}
                    className="stack-item stack-item--interactive"
                    role="button"
                    tabIndex={0}
                    aria-label={`Open health record for ${horse.name}`}
                    onClick={() => openDrawer({ type: 'horse-health', horseId: horse.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openDrawer({ type: 'horse-health', horseId: horse.id });
                      }
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuState({ horseId: horse.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{horse.name}</div>
                        <div className="stack-item__copy">{horse.medicalTimeline[0]?.title ?? horse.medicalNotes}</div>
                      </div>
                      <div className="row-actions">
                        <Pill tone="rose">Watch</Pill>
                        <Link className="button button--ghost button--xs" to={`/horses/${horse.id}`} onClick={(e) => e.stopPropagation()}>Profile</Link>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      <span>{horse.assignments.veterinarian}</span>
                      <span>Last visit {formatDateLabel(horse.lastVetVisit)}</span>
                      {careRow && <span>{careRow.signals.filter((s) => s.status !== 'clear').length} signal{careRow.signals.filter((s) => s.status !== 'clear').length !== 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No horses on medical watch" description="Set a horse status to Medical Review to add to the watchlist." />
          )}
        </Panel>

        <Panel eyebrow="Medical Kits" title="Ranch medical kits">
          {kits.length ? (
            <div className="stack-list">
              {kits.map((asset) => (
                <div key={asset.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{asset.name}</div>
                      <div className="stack-item__copy">{asset.location}</div>
                    </div>
                    <Pill tone={asset.condition === 'Attention Required' ? 'rose' : asset.condition === 'Service Soon' ? 'amber' : 'emerald'}>
                      {asset.condition}
                    </Pill>
                  </div>
                  <div className="stack-item__copy">{asset.notes}</div>
                  {asset.nextService && (
                    <div className="inline-metrics"><span>Service due {formatDateLabel(asset.nextService)}</span></div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No medical kits tracked" description="Add kits in Ranch Toolkit." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Care action" title="Add care event">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select className="field-input" value={selectedHorseId} onChange={(e) => setSelectedHorseId(e.target.value)} disabled={!canManageMedical}>
                {horses.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Event date</span>
              <input className="field-input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} disabled={!canManageMedical} />
            </label>
            <label className="field-stack">
              <span className="field-label">Event type</span>
              <select
                className="field-select"
                value={eventType}
                onChange={(e) => { setEventType(e.target.value as MedicalEventType); setEventError(''); }}
                disabled={!canManageMedical}
              >
                {medicalEventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Event title</span>
              <input className="field-input" value={eventTitle} onChange={(e) => { setEventTitle(e.target.value); setEventError(''); }} disabled={!canManageMedical} />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Care note</span>
              <textarea className="field-textarea" rows={4} value={eventBody} onChange={(e) => { setEventBody(e.target.value); setEventError(''); }} disabled={!canManageMedical} />
            </label>
          </div>
          {eventError ? <div className="field-error">{eventError}</div> : null}
          <div className="inline-actions inline-actions--mt-sm">
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
                pushToast({ title: result.ok ? 'Medical event added' : 'Medical event blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                if (result.ok) { setEventBody(''); setEventError(''); }
              }}
              disabled={!canManageMedical}
            >
              Save care event
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Recent care" title="Care history">
          {medicalEvents.length ? (
            <div className="stack-list">
              {medicalEvents.slice(0, 6).map((event) => (
                <div key={event.id} className="stack-item">
                  {editingEventId === event.id ? (
                    <div className="stack-item__top stack-item__top--column">
                      <input className="field-input" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" />
                      <input className="field-input" value={editForm.body} onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))} placeholder="Notes" />
                      <input className="field-input" type="date" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} />
                      <select className="field-select" value={editForm.type} onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}>
                        {medicalEventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <div className="inline-actions">
                        <button
                          className="button button--primary button--compact"
                          type="button"
                          disabled={!editForm.title.trim() || !editForm.date.trim()}
                          onClick={() => {
                            const result = updateMedicalEvent(event.horseId, event.id, { title: editForm.title, summary: editForm.body, date: editForm.date, status: editForm.type });
                            pushToast({ title: result.ok ? 'Event updated' : 'Update failed', message: result.message, tone: result.ok ? 'success' : 'error' });
                            if (result.ok) setEditingEventId(null);
                          }}
                        >
                          Save
                        </button>
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
                        <div className="row-actions">
                          <Pill tone={EVENT_TYPE_TONE[event.status ?? ''] ?? 'slate'}>{formatDateLabel(event.date)}</Pill>
                          {canManageMedical && (
                            <button
                              className="button button--ghost button--xs"
                              type="button"
                              onClick={() => {
                                setEditForm({ title: event.title, body: event.summary, date: event.date, type: event.status ?? '' });
                                setEditingEventId(event.id);
                              }}
                            >
                              Edit
                            </button>
                          )}
                          {canManageMedical && (
                            <button
                              className="button button--ghost button--xs button--danger-ghost"
                              type="button"
                              onClick={async () => {
                                if (await confirm('Remove event?', 'Remove this medical event? This cannot be undone.')) {
                                  const result = deleteMedicalEvent(event.horseId, event.id);
                                  pushToast({ title: result.ok ? 'Event removed' : 'Remove failed', message: result.message, tone: result.ok ? 'success' : 'error' });
                                }
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="stack-item__copy">{event.summary}</div>
                      <div className="inline-metrics">
                        <span>{event.status}</span>
                        <span>{event.veterinarian}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No care history yet" description="Saved events will appear here." />
          )}
        </Panel>
      </div>

      <Panel eyebrow="Timeline" title="Medical timeline">
        {medicalEvents.length > 0 && (
          <div className="search-wrap">
            <input
              className="field-input"
              placeholder="Search by horse name or event title…"
              aria-label="Search medical timeline"
              value={timelineQuery}
              onChange={(e) => setTimelineQuery(e.target.value)}
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
                    <th scope="col">Horse</th>
                    <th scope="col">Event</th>
                    <th scope="col">Type</th>
                    <th scope="col">Vet</th>
                    <th scope="col">Date</th>
                    {canManageMedical && <th scope="col" className="th--action">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((event) => (
                    <Fragment key={event.id}>
                      <tr>
                        <td>{event.horseName}</td>
                        <td>{event.title}</td>
                        <td><Pill tone={EVENT_TYPE_TONE[event.status ?? ''] ?? 'slate'}>{event.status ?? '—'}</Pill></td>
                        <td>{event.veterinarian}</td>
                        <td>{formatDateLabel(event.date)}</td>
                        {canManageMedical && (
                          <td>
                            <div className="row-actions--tight">
                              <button
                                className="button button--ghost button--xs"
                                type="button"
                                onClick={() => {
                                  setEditForm({ title: event.title, body: event.summary, date: event.date, type: event.status ?? '' });
                                  setEditingEventId(event.id);
                                }}
                              >
                                Edit
                              </button>
                              <button
                                className="button button--ghost button--xs button--danger-ghost"
                                type="button"
                                onClick={async () => {
                                  if (await confirm('Remove event?', 'Remove this medical event? This cannot be undone.')) {
                                    const result = deleteMedicalEvent(event.horseId, event.id);
                                    pushToast({ title: result.ok ? 'Event removed' : 'Remove failed', message: result.message, tone: result.ok ? 'success' : 'error' });
                                  }
                                }}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {editingEventId === event.id && (
                        <tr>
                          <td colSpan={canManageMedical ? 6 : 5} className="td--edit">
                            <div className="form-column--narrow">
                              <input className="field-input" value={editForm.title} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" />
                              <input className="field-input" value={editForm.body} onChange={(e) => setEditForm((f) => ({ ...f, body: e.target.value }))} placeholder="Notes" />
                              <input className="field-input" type="date" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} />
                              <select className="field-select" value={editForm.type} onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}>
                                {medicalEventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                              <div className="inline-actions">
                                <button
                                  className="button button--primary button--compact"
                                  type="button"
                                  disabled={!editForm.title.trim() || !editForm.date.trim()}
                                  onClick={() => {
                                    const result = updateMedicalEvent(event.horseId, event.id, { title: editForm.title, summary: editForm.body, date: editForm.date, status: editForm.type });
                                    pushToast({ title: result.ok ? 'Event updated' : 'Update failed', message: result.message, tone: result.ok ? 'success' : 'error' });
                                    if (result.ok) setEditingEventId(null);
                                  }}
                                >
                                  Save
                                </button>
                                <button className="button button--ghost button--compact" type="button" onClick={() => setEditingEventId(null)}>Cancel</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted">No events match "{timelineQuery}".</p>
          );
        })() : (
          <EmptyState icon={MedicalIcon} title="No medical timeline yet" description="Create a care event to start the timeline." />
        )}
      </Panel>

      <ContextMenu open={Boolean(menuHorse)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
