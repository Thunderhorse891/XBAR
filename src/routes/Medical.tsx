import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function Medical() {
  const horses = useXbarStore((state) => state.horses);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const medicalWatch = horses.filter((horse) => horse.status === 'Medical Review');
  const medicalEvents = horses.flatMap((horse) =>
    horse.medicalTimeline.map((event) => ({
      horseName: horse.name,
      veterinarian: horse.assignments.veterinarian,
      ...event,
    })),
  );
  const kits = ranchAssets.filter((asset) => asset.category === 'Medical Kit');

  return (
    <>
      <PageHeader
        eyebrow="Medical"
        title="Medical control"
        description="This module turns care history into an operating lane with watchlists, care calendars, document-linked notes, and kit readiness."
      />

      <div className="metric-grid">
        <MetricCard label="Watchlist" value={`${medicalWatch.length}`} detail="Horses currently carrying medical sensitivity" tone="rose" />
        <MetricCard label="Timeline entries" value={`${medicalEvents.length}`} detail="Care records flowing through profiles and documents" />
        <MetricCard label="Medical kits" value={`${kits.length}`} detail="Tracked kits and readiness for treatment or travel" tone="blue" />
        <MetricCard label="Vet-linked docs" value={`${horses.filter((horse) => horse.documents.some((id) => id.includes('vet') || id.includes('coggins'))).length}`} detail="Profiles already connected to medical documents" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Care watch" title="Horses needing visibility" description="Active medical risk now has its own product lane instead of disappearing into general notes.">
          <div className="stack-list">
            {medicalWatch.map((horse) => (
              <div key={horse.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{horse.name}</div>
                    <div className="stack-item__copy">{horse.medicalTimeline[0]?.title ?? horse.medicalNotes}</div>
                  </div>
                  <Pill tone="rose">Watch</Pill>
                </div>
                <div className="inline-metrics">
                  <span>{horse.assignments.veterinarian}</span>
                  <span>Last visit {horse.lastVetVisit}</span>
                  <span>{horse.documents.length} linked docs</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Kit readiness" title="Travel and treatment assets" description="Medical kits and equipment have their own readiness picture so care execution is not just a note in the margin.">
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
        </Panel>
      </div>

      <Panel eyebrow="Timeline" title="Recent care activity" description="Care notes, exam cadence, and follow-up actions are structured here so profiles can inherit them cleanly.">
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
                  <td>{event.date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
