import { useMemo, useState } from 'react';
import { ActionButton, Card } from '@/components/saas';
import { buildRanchPlan, ranchChecklist } from '@/lib/ranchCopilot';
import type { DocumentRecord, HorseRecord, OwnershipRecord } from '@/types/xbar';
import './ranchCopilot.css';

export function RanchCopilot({
  horse,
  documents,
  ownership,
  now,
}: {
  horse: HorseRecord;
  documents: DocumentRecord[];
  ownership?: OwnershipRecord;
  now?: Date;
}) {
  const [reviewTime, setReviewTime] = useState<Date | null>(null);
  const [draft, setDraft] = useState(false);
  const plan = useMemo(
    () => (reviewTime ? buildRanchPlan(horse, documents, ownership, now ?? reviewTime) : null),
    [horse, documents, ownership, now, reviewTime],
  );
  return (
    <Card title="Ranch Copilot" className="ranch-copilot">
      <p>Turn this horse's linked evidence into a prioritized plan. Rule-based review; no AI model is connected.</p>
      <p className="xs-field-hint">
        Nothing is saved, sent or shared. Documents are evidence, never instructions. Care history and unlinked intake
        require separate review.
      </p>
      <div className="xs-toolbar">
        <ActionButton
          onClick={() => {
            setReviewTime(new Date());
            setDraft(false);
          }}
        >
          Build action plan
        </ActionButton>
        {plan ? (
          <ActionButton
            onClick={() => {
              setReviewTime(null);
              setDraft(false);
            }}
          >
            Close plan
          </ActionButton>
        ) : null}
      </div>
      {plan ? (
        <div className="ranch-copilot__plan" aria-live="polite">
          <h3>Action plan for {plan.horseName}</h3>
          <p>
            As of {plan.asOf}. Draft suggestions based on the current record, not veterinary, legal or registry
            verification. Missing evidence means not found in this scope.
          </p>
          <ol>
            {plan.actions.map((action) => (
              <li key={action.id}>
                <span className="ranch-copilot__priority">{action.priority}</span>
                <h4>{action.title}</h4>
                <p>{action.reason}</p>
                <div>
                  Evidence:{' '}
                  {action.sources.map((id) => {
                    const index = plan.sources.findIndex((s) => s.id === id);
                    return (
                      <a key={id} href={`#copilot-source-${index}`}>
                        {plan.sources[index]?.title}
                      </a>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
          {!plan.actions.length ? (
            <p>No gaps found by these rules. This does not approve a sale packet or verify the horse.</p>
          ) : null}
          <div>
            <h3>Source records ({plan.sources.length})</h3>
            {plan.sources.map((source, i) => (
              <section key={source.id} id={`copilot-source-${i}`} tabIndex={-1}>
                <h4>{source.title}</h4>
                <ul>
                  {source.facts.map((fact, j) => (
                    <li key={j}>{fact}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <ActionButton onClick={() => setDraft(true)}>Prepare draft checklist</ActionButton>
          {draft ? (
            <div>
              <label htmlFor="copilot-checklist">Draft checklist — review before use</label>
              <textarea id="copilot-checklist" readOnly rows={14} value={ranchChecklist(plan)} />
              <p role="status">Draft prepared in this view only. No records changed.</p>
              <ActionButton onClick={() => setDraft(false)}>Discard draft</ActionButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
