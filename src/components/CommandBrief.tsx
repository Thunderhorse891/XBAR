import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './commandBrief.css';

/*
 * Dark graphite command module used as the hero of every operational route.
 * One brand system, route-specific silhouettes: the variant + children slot
 * let each page lead with its own content instead of a stamped stat grid.
 * Structure follows the workflow contract: Entity → Status → Evidence →
 * Risk → Next action.
 */

export type CommandBriefTone = 'blue' | 'amber' | 'rose' | 'steel';

export interface CommandBriefProps {
  eyebrow: string;
  entity: ReactNode;
  status?: { label: string; tone: CommandBriefTone };
  summary?: string;
  evidence?: { label: string; value: string; to?: string }[];
  risks?: { label: string; severity: 'amber' | 'rose'; to?: string }[];
  nextAction?: { label: string; onClick?: () => void; to?: string; disabledReason?: string };
  secondaryActions?: { label: string; onClick?: () => void; to?: string }[];
  variant?: 'wide' | 'split' | 'compact';
  children?: ReactNode;
}

function BriefAction({ action }: { action: NonNullable<CommandBriefProps['nextAction']> }) {
  if (action.disabledReason) {
    return (
      <div className="command-brief__next">
        <button type="button" className="command-brief__primary" disabled>
          {action.label}
        </button>
        <p className="command-brief__disabled-reason">{action.disabledReason}</p>
      </div>
    );
  }
  if (action.to) {
    return (
      <Link to={action.to} className="command-brief__primary">
        {action.label}
      </Link>
    );
  }
  return (
    <button type="button" className="command-brief__primary" onClick={action.onClick}>
      {action.label}
    </button>
  );
}

export function CommandBrief({
  eyebrow,
  entity,
  status,
  summary,
  evidence = [],
  risks = [],
  nextAction,
  secondaryActions = [],
  variant = 'wide',
  children,
}: CommandBriefProps) {
  return (
    <section className={`command-brief command-brief--${variant}`} aria-label={eyebrow}>
      <div className="command-brief__main">
        <span className="command-brief__eyebrow">{eyebrow}</span>
        <div className="command-brief__entity-row">
          <h2 className="command-brief__entity">{entity}</h2>
          {status && (
            <span className={`command-brief__status command-brief__status--${status.tone}`}>{status.label}</span>
          )}
        </div>
        {summary && <p className="command-brief__summary">{summary}</p>}

        {evidence.length > 0 && (
          <dl className="command-brief__evidence">
            {evidence.map((item) => (
              <div key={item.label} className="command-brief__evidence-item">
                <dt>{item.label}</dt>
                <dd>{item.to ? <Link to={item.to}>{item.value}</Link> : item.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {risks.length > 0 && (
          <ul className="command-brief__risks" aria-label="Open risks">
            {risks.map((risk) =>
              risk.to ? (
                <li key={risk.label}>
                  <Link to={risk.to} className={`command-brief__risk command-brief__risk--${risk.severity}`}>
                    {risk.label}
                  </Link>
                </li>
              ) : (
                <li key={risk.label}>
                  <span className={`command-brief__risk command-brief__risk--${risk.severity}`}>{risk.label}</span>
                </li>
              ),
            )}
          </ul>
        )}
      </div>

      <div className="command-brief__side">
        {nextAction && <BriefAction action={nextAction} />}
        {secondaryActions.length > 0 && (
          <div className="command-brief__secondary-row">
            {secondaryActions.map((action) =>
              action.to ? (
                <Link key={action.label} to={action.to} className="command-brief__secondary">
                  {action.label}
                </Link>
              ) : (
                <button key={action.label} type="button" className="command-brief__secondary" onClick={action.onClick}>
                  {action.label}
                </button>
              ),
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
