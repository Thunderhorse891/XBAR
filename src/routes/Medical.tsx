import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCloudStore } from '@/store/useCloudStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import type { MedicalEventType } from '@/types/xbar';
import { medicalEventTypes } from '@/features/health/constants';

export default function Medical() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const addMedicalEvent = useXbarStore((state) => state.addMedicalEvent);
  const updateMedicalEvent = useXbarStore((state) => state.updateMedicalEvent);
  const deleteMedicalEvent = useXbarStore((state) => state.deleteMedicalEvent);
  const session = useCloudStore((state) => state.session);
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || 'Vet Records';
  const pushToast = useUiStore((state) => state.pushToast);
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
  const [selectedHorseId, setSelectedHorseId] = useState(medicalWatch[0]?.id ?? horses[0]?.id ?? '');
  const [eventTitle, setEventTitle] = useState('Vet follow-up');
  const [eventBody, setEventBody] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventType, setEventType] = useState<MedicalEventType>('Vet visit');
  const [eventError, setEventError] = useState('');
  const [timelineQuery, setTimelineQuery] = useState('');
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ title: '', body: '', date: '' });
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);
  const menuHorse = horses.find((horse) => horse.id === menuState?.horseId);
  const menuItems = menuHorse
    ? [
        {
          id: 'open-profile',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'prepare-event',
          label: 'Log care event',
          onSelect: () => setSelectedHorseId(menuHorse.id),
        },
      ]
    : [];

  return (
    <>
      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Health & Care</span>
            <h1 className="surface-hero__title">Coggins, vaccines, dental, and vet records.</h1>
            <p className="page-description" style={{ marginTop: '10px', color: 'var(--muted)' }}>
              Log every care event as it happens. Coggins expiration, dewormer cycles, dental float windows, and vet visits — kept in one verifiable timeline per horse.
            </p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat">
              <span>Watch</span>
              <strong style={{ color: medicalWatch.length ? 'var(--rose)' : 'var(--emerald)' }}>{medicalWatch.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Timeline</span>
              <strong>{medicalEvents.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Kits</span>
              <strong>{kits.length}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Vet docs</span>
              <strong>{documents.filter((document) => document.type === 'Vet Record' || document.type === 'Coggins').length}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Watchlist" value={`${medicalWatch.length}`} detail="Horses needing care attention" tone="rose" />
        <MetricCard label="Timeline entries" value={`${medicalEvents.length}`} detail="Care records on file" />
        <MetricCard label="Medical kits" value={`${kits.length}`} detail="Travel and treatment kits" tone="blue" />
        <MetricCard label="Vet-linked docs" value={`${documents.filter((document) => document.type === 'Vet Record' || document.type === 'Coggins').length}`} detail="Medical docs linked" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Care watch" title="Watch">
          {medicalWatch.length ? (
            <div className="stack-list">
              {medicalWatch.map((horse) => (
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
                      <div className="stack-item__copy">{horse.medicalTimeline[0]?.title ?? horse.medicalNotes}</div>
                    </div>
                    <Pill tone="rose">Watch</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{horse.assignments.veterinarian}</span>
                    <span>Last visit {formatDateLabel(horse.lastVetVisit)}</span>
                    <span>{horse.documents.length} linked docs</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No horses on medical watch" description="Add a care event to start the watchlist." />
          )}
        </Panel>

        <Panel eyebrow="Kit readiness" title="Kits">
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
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No medical kits tracked" description="Add kits in Ranch Toolkit." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Care action" title="Log care">
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
                          <button className="button button--ghost button--compact" style={{ fontSize: '11px', color: 'var(--rose)' }} type="button" onClick={() => { if (window.confirm('Remove this medical event?')) deleteMedicalEvent(event.horseId, event.id); }}>Delete</button>
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
                    <tr key={event.id}>
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

      <ContextMenu open={Boolean(menuHorse)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
