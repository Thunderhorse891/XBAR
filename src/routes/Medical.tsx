import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

export default function Medical() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const addMedicalEvent = useXbarStore((state) => state.addMedicalEvent);
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
  const [eventError, setEventError] = useState('');
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
      <PageHeader
        eyebrow="Medical"
        title="Medical"
      />

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
                if (!selectedHorseId || !eventTitle.trim() || !eventBody.trim() || !eventDate.trim()) {
                  setEventError('Horse, date, title, and care note are required.');
                  return;
                }

                const result = addMedicalEvent(selectedHorseId, {
                  title: eventTitle,
                  body: eventBody,
                  author: 'Medical Desk',
                  date: eventDate,
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
              Save medical event
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Next up" title="Cadence">
          {medicalEvents.length ? (
            <div className="stack-list">
              {medicalEvents.slice(0, 5).map((event) => (
                <div key={event.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{event.horseName}</div>
                      <div className="stack-item__copy">{event.title}</div>
                    </div>
                    <Pill tone="blue">{formatDateLabel(event.date)}</Pill>
                  </div>
                  <div className="stack-item__copy">{event.summary}</div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No care cadence yet" description="Saved events will appear here." />
          )}
        </Panel>
      </div>

      <Panel eyebrow="Timeline" title="Timeline">
        {medicalEvents.length ? (
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Horse</th>
                  <th>Event</th>
                  <th>Owner</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {medicalEvents.map((event) => (
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
          <EmptyState title="No medical timeline yet" description="Create a care event to start the timeline." />
        )}
      </Panel>

      <ContextMenu open={Boolean(menuHorse)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
