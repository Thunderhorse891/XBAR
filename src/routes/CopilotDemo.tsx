import { useMemo, useState } from 'react';
import { XbarMark } from '@/components/BrandMark';
import { RanchCopilot } from '@/components/RanchCopilot';
import { copilotDemoDate, copilotDemoHorse, copilotSecondHorse, copilotFixture } from '@/lib/ranchCopilotDemo';

export default function CopilotDemo() {
  const [horseId, setHorseId] = useState(copilotDemoHorse.id);
  const [corrected, setCorrected] = useState(false);
  const fixture = useMemo(() => copilotFixture(horseId, corrected), [horseId, corrected]);
  return (
    <main className="ranch-copilot-demo">
      <XbarMark title="XBAR" width={160} height={90} />
      <h1>From horse records to a clear next step</h1>
      <p>
        Fictional, rule-based demonstration · fixed review date November 20, 2026. These fictional records never enter
        your ranch. No paid checkout or external actions are available here.
      </p>
      <div className="ranch-copilot-demo__fixtures">
        <label>
          Fictional horse
          <select value={horseId} onChange={(event) => setHorseId(event.target.value)}>
            <option value={copilotDemoHorse.id}>Copper Creek Demo — nickname Copper</option>
            <option value={copilotSecondHorse.id}>Copper Ridge Demo — nickname Copper</option>
          </select>
        </label>
        <label>
          Evidence fixture
          <select
            value={corrected ? 'after' : 'before'}
            onChange={(event) => setCorrected(event.target.value === 'after')}
          >
            <option value="before">Before review</option>
            <option value="after">After Creek registration correction (fixture)</option>
          </select>
        </label>
      </div>
      <p>
        Separate horse IDs, same nickname. The after fixture corrects only Creek's registration source. It does not save
        a correction or change Ridge's evidence.
      </p>
      <RanchCopilot
        key={`${horseId}:${corrected}`}
        horse={fixture.horse}
        documents={fixture.documents}
        now={copilotDemoDate}
      />
    </main>
  );
}
