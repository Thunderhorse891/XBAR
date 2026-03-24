import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function Breeding() {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const breedingHorses = horses.filter((horse) => horse.segment === 'Stud' || horse.sex === 'Mare');
  const breedingDocs = documents.filter((document) => document.type === 'Breeding Contract');

  return (
    <>
      <PageHeader
        eyebrow="Breeding"
        title="Breeding program"
        description="Stud and mare workflows now have a real home in the product: program visibility, contract coverage, milestone timing, and packet readiness."
      />

      <div className="metric-grid">
        <MetricCard label="Program horses" value={`${breedingHorses.length}`} detail="Mares and studs tracked in active breeding context" />
        <MetricCard label="Contract docs" value={`${breedingDocs.length}`} detail="Breeding-specific paperwork linked into the record model" tone="blue" />
        <MetricCard label="Live milestones" value={`${breedingHorses.reduce((sum, horse) => sum + horse.breedingTimeline.length, 0)}`} detail="Timeline entries currently supporting the program" tone="emerald" />
        <MetricCard label="Packet blockers" value={`${breedingHorses.filter((horse) => horse.readiness.packetStatus !== 'Ready').length}`} detail="Horses still missing packet elements or imagery" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Program board" title="Stud and mare pipeline" description="The breeding lane now tracks real horses and program timing instead of behaving like a blank placeholder.">
          <div className="stack-list">
            {breedingHorses.map((horse) => (
              <div key={horse.id} className="stack-item">
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
        </Panel>

        <Panel eyebrow="Milestones" title="Program timing and disclosures" description="Even before live breeding integrations, the system can hold the milestone structure and contract traceability.">
          <div className="stack-list">
            {breedingHorses.flatMap((horse) =>
              horse.breedingTimeline.map((event) => (
                <div key={event.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{horse.name}</div>
                      <div className="stack-item__copy">{event.title}</div>
                    </div>
                    <Pill tone="slate">{event.date}</Pill>
                  </div>
                  <div className="stack-item__copy">{event.summary}</div>
                </div>
              )),
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
