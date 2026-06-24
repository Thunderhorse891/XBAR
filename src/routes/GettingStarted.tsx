import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Card, PageHead, ProgressRing } from '@/components/saas';
import { gettingStartedSteps } from '@/data/xbarSaasMock';

export default function GettingStarted() {
  const navigate = useNavigate();
  const [steps, setSteps] = useState(gettingStartedSteps);

  const doneCount = steps.filter((s) => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  function toggle(id: string) {
    setSteps((current) => current.map((s) => (s.id === id ? { ...s, done: !s.done } : s)));
  }

  return (
    <>
      <PageHead
        eyebrow="Onboarding"
        title="Getting Started"
        subtitle="Stand up your ranch operations and reach buyer-ready release. Each step contributes to your setup progress."
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <ProgressRing value={progress} size={56} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 24, fontWeight: 600 }}>{progress}% Ranch setup</div>
            <div className="xs-card__sub">
              {doneCount} of {steps.length} steps complete — finish setup to unlock full release readiness.
            </div>
          </div>
          <button type="button" className="xs-btn xs-btn--primary" onClick={() => navigate('/subscriptions')}>
            Choose plan
          </button>
        </div>
      </Card>

      <div className="xs-checklist">
        {steps.map((s) => (
          <div key={s.id} className={`xs-checkitem${s.done ? ' xs-checkitem--done' : ''}`}>
            <button
              type="button"
              className={`xs-check${s.done ? ' xs-check--done' : ''}`}
              aria-label={s.done ? 'Mark incomplete' : 'Mark complete'}
              onClick={() => toggle(s.id)}
            >
              <Check size={15} />
            </button>
            <div className="xs-checkitem__body">
              <div className="xs-checkitem__title">{s.title}</div>
              <div className="xs-checkitem__sub">{s.detail}</div>
            </div>
            <button type="button" className="xs-btn xs-btn--sm" onClick={() => navigate(s.to)}>
              {s.action}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
