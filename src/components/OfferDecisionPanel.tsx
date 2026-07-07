import { Link } from 'react-router-dom';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { Checkbox } from '@/components/ui/checkbox';
import { formatCompactCurrency } from '@/lib/format';
import type { OfferDecision } from '@/lib/profitIntelligence';

function decisionTone(status: OfferDecision['status']) {
  if (status === 'loss') return 'rose';
  if (status === 'thin-margin' || status === 'missing-costs') return 'amber';
  if (status === 'protected-margin') return 'emerald';
  return 'slate';
}

export function OfferDecisionPanel({
  decision,
  horseName,
  overrideApproved,
  canManageSales,
  onOverrideApproved,
  onCounterAtFloor,
  onPrepareDeposit,
}: {
  decision: OfferDecision;
  horseName: string;
  overrideApproved: boolean;
  canManageSales: boolean;
  onOverrideApproved: (approved: boolean) => void;
  onCounterAtFloor: () => void;
  onPrepareDeposit: () => void;
}) {
  const tone = decisionTone(decision.status);

  return (
    <Panel
      eyebrow="Offer guardrail"
      title={`${horseName} deal decision`}
      description="Connect the buyer offer to real horse costs before accepting, countering, or requesting a deposit."
      meta={<Pill tone={tone}>{decision.label}</Pill>}
      action={
        <Link className="button button--ghost button--compact" to="/expenses">
          Review costs
        </Link>
      }
    >
      <div className="metric-grid">
        <MetricCard
          label="Effective offer"
          value={formatCompactCurrency(decision.effectiveOffer)}
          detail="Counteroffer takes priority"
          tone={tone}
        />
        <MetricCard
          label="Break-even"
          value={formatCompactCurrency(decision.breakEven)}
          detail="Cost basis plus linked expenses"
        />
        <MetricCard
          label="Protected floor"
          value={formatCompactCurrency(decision.safeSalePrice)}
          detail="Break-even plus protected margin"
          tone="blue"
        />
        <MetricCard
          label="Profit at offer"
          value={formatCompactCurrency(decision.expectedProfit)}
          detail={`${Math.round(decision.marginPercent)}% margin`}
          tone={decision.expectedProfit < 0 ? 'rose' : decision.overrideRequired ? 'amber' : 'emerald'}
        />
      </div>

      <div className="stack-list" style={{ marginTop: 14 }}>
        <div className="stack-item">
          <div className="stack-item__top">
            <div>
              <div className="stack-item__title">Recommended seller action</div>
              <div className="stack-item__copy">{decision.recommendation}</div>
            </div>
            <Pill tone={tone}>
              {decision.acceptanceBlocked
                ? 'Acceptance blocked'
                : decision.overrideRequired
                  ? 'Approval required'
                  : 'Ready'}
            </Pill>
          </div>
        </div>
      </div>

      {decision.overrideRequired ? (
        <div className="stack-item" style={{ marginTop: 14 }}>
          <div className="stack-item__top">
            <Checkbox
              id="offer-margin-override"
              checked={overrideApproved}
              onCheckedChange={(checked) => onOverrideApproved(checked === true)}
              disabled={!canManageSales}
            />
            <label className="stack-item__copy" htmlFor="offer-margin-override">
              {decision.status === 'missing-costs'
                ? 'I approve moving forward before the horse cost record is complete.'
                : 'I reviewed the cost evidence and approve accepting below the protected floor.'}
            </label>
          </div>
        </div>
      ) : null}

      <div className="inline-actions" style={{ marginTop: 14 }}>
        <button
          className="button button--ghost button--compact"
          type="button"
          onClick={onCounterAtFloor}
          disabled={!canManageSales || decision.safeSalePrice <= 0}
        >
          Counter at protected floor
        </button>
        <button
          className="button button--primary button--compact"
          type="button"
          onClick={onPrepareDeposit}
          disabled={!canManageSales || decision.acceptanceBlocked || (decision.overrideRequired && !overrideApproved)}
        >
          Prepare deposit step
        </button>
      </div>
    </Panel>
  );
}
