import { type CSSProperties, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Check, Coins, Lock, TrendingUp } from 'lucide-react';
import { Card, PageHead, StatusChip } from '@/components/saas';
import { ProgressBar } from '@/components/app-ui';
import { billingPath } from '@/lib/billingRoutes';
import { formatCurrency, formatPercent } from '@/lib/format';
import {
  type AnimalFinancialStatus,
  type FinancialInsightTone,
  buildBankedHeadline,
  buildRanchFinancials,
} from '@/lib/profitIntelligence';
import { profitIntelligenceGate } from '@/lib/subscriptionGates';
import type { ChipTone } from '@/types/saas';
import { useXbarStore } from '@/store/useXbarStore';
import './moneyIntelligence.css';

const statusChip: Record<AnimalFinancialStatus, { tone: ChipTone; label: string }> = {
  sold: { tone: 'success', label: 'Sold' },
  pipeline: { tone: 'info', label: 'In play' },
  held: { tone: 'neutral', label: 'Held' },
};

const insightChip: Record<FinancialInsightTone, { tone: ChipTone; label: string }> = {
  win: { tone: 'success', label: 'Win' },
  risk: { tone: 'danger', label: 'Fix' },
  opportunity: { tone: 'brass', label: 'Move' },
  info: { tone: 'neutral', label: 'Note' },
};

// Positive/negative colouring comes from the value class; when the stat sits in
// the dark hero card, the `.fin-stat--hero` parent selector brightens it.
function ProfitValue({ value }: { value: number }) {
  const dir = value >= 0 ? 'up' : 'down';
  return (
    <span className={`fin-stat__value fin-stat__value--${dir}`}>
      {value >= 0 ? '+' : '−'}
      {formatCurrency(Math.abs(value))}
    </span>
  );
}

// Index a staggered child for the motion system; the CSS var drives its delay.
const motionIndex = (index: number): CSSProperties => ({ ['--motion-index' as string]: index }) as CSSProperties;

export default function Financials() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const subscription = useXbarStore((state) => state.subscription);

  const fin = useMemo(
    () => buildRanchFinancials(horses, expenseReceipts, salesLeads),
    [horses, expenseReceipts, salesLeads],
  );
  const locked = profitIntelligenceGate(subscription);
  const maxCost = fin.topCostCategories[0]?.amount ?? 0;
  // Same honesty state as the Dashboard money band, from the shared helper, so the
  // drill-down never contradicts the front door.
  const banked = buildBankedHeadline(fin);

  // Only truly empty when there's nothing to account for. A workspace with logged
  // expenses but no horses yet still has a real (negative) picture worth showing.
  if (horses.length === 0 && expenseReceipts.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Money"
          title="Ranch financials"
          subtitle="See what you've made and what's still at stake — the moment you start tracking horses, costs, and offers."
        />
        <Card>
          <div className="xs-empty">
            <div className="xs-empty__title">No numbers yet</div>
            <div className="xs-empty__sub">
              Add a horse with a cost basis, log a few expenses, and record buyer offers. XBAR turns them into a live
              profit-and-loss picture here.
            </div>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Money"
        title="Ranch financials"
        subtitle="What you've actually banked, what's still working in the herd, and the one move that protects the most margin — all from the costs and offers you already track."
      />

      {/* P&L hero — realized profit and total invested are sums of the rancher's
          own records, so they show on every plan. */}
      <div className="fin-hero motion-stagger">
        <div className="fin-stat fin-stat--hero" style={motionIndex(0)}>
          <span className="fin-stat__label">Profit banked</span>
          {banked.state === 'unknown' ? (
            <span className="fin-stat__value">—</span>
          ) : banked.state === 'complete' ? (
            <ProfitValue value={fin.netProfit} />
          ) : (
            // Partial: a concrete floor with sale gaps — shown neutral, not a verdict.
            <span className="fin-stat__value">
              {fin.netProfit >= 0 ? '+' : '−'}
              {formatCurrency(Math.abs(fin.netProfit))}
            </span>
          )}
          <span className="fin-stat__sub">
            {banked.state === 'complete'
              ? `${fin.soldCount} sold · ${formatCurrency(fin.realizedProceeds)} collected${
                  fin.realizedProceeds > 0
                    ? ` · ${formatPercent(Math.round(fin.realizedMarginPercent))} gross margin`
                    : ''
                }${fin.overheadSpend > 0 ? ` · net of ${formatCurrency(fin.overheadSpend)} overhead` : ''}`
              : banked.state === 'partial'
                ? `Partial — ${banked.fixPhrase} to complete`
                : `${fin.soldCount} sold · ${banked.fixPhrase} to see profit`}
          </span>
        </div>

        {locked ? (
          <div className="fin-stat" style={motionIndex(1)}>
            <span className="fin-stat__label">Upside in the herd</span>
            <span className="fin-stat__value" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Lock size={22} /> Ranch Ops
            </span>
            <span className="fin-stat__sub">Projected profit on every held and in-play horse.</span>
          </div>
        ) : (
          <div className="fin-stat" style={motionIndex(1)}>
            <span className="fin-stat__label">Upside in the herd</span>
            <ProfitValue value={fin.projectedProfit} />
            <span className="fin-stat__sub">
              {fin.pipelineCount} in play · {fin.heldCount} held · {formatCurrency(fin.projectedValue)} projected value
            </span>
          </div>
        )}

        <div className="fin-stat" style={motionIndex(2)}>
          <span className="fin-stat__label">Invested to date</span>
          <span className="fin-stat__value">{formatCurrency(fin.totalInvested)}</span>
          <span className="fin-stat__sub">
            {formatCurrency(fin.investedInHerd)} in the herd
            {fin.investedInSold > 0 ? ` · ${formatCurrency(fin.investedInSold)} in sold horses` : ''}
            {fin.overheadSpend > 0 ? ` · ${formatCurrency(fin.overheadSpend)} overhead` : ''}
          </span>
        </div>
      </div>

      {locked ? (
        <Card
          title="Unlock full financial intelligence"
          subtitle={
            banked.state === 'complete'
              ? 'Your banked profit above is real. Ranch Ops turns it into a forward-looking playbook.'
              : 'Complete the missing sale details above to finalize your banked profit — then Ranch Ops turns it into a forward-looking playbook.'
          }
        >
          <div className="fin-lock">
            <ul className="fin-lock__list">
              {[
                'Profit-per-animal ranking across the whole herd — sold, in-play, and held.',
                'Projected profit on every horse from your real asking prices and live offers.',
                'Underwater-price alerts that name the exact price to protect your margin.',
                'Cost-drag analysis showing which category is eating your profit.',
              ].map((line) => (
                <li key={line} className="fin-lock__item">
                  <Check className="fin-lock__bullet" size={16} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <div>
              <button
                type="button"
                className="button button--primary motion-press"
                onClick={() => navigate(billingPath)}
              >
                <TrendingUp size={16} /> Upgrade to Ranch Ops
              </button>
            </div>
            <p className="fin-insight__detail">{locked}</p>
          </div>
        </Card>
      ) : (
        <>
          {fin.insights.length > 0 ? (
            <Card title="Money moves" subtitle="Ranked by what protects or makes the most money right now.">
              <div className="fin-insights motion-stagger">
                {fin.insights.map((insight, index) => {
                  const chip = insightChip[insight.tone];
                  const clickable = Boolean(insight.horseId);
                  const Row = clickable ? 'button' : 'div';
                  return (
                    <Row
                      key={insight.id}
                      type={clickable ? 'button' : undefined}
                      className={`fin-insight fin-insight--${insight.tone}${clickable ? ' motion-lift' : ''}`}
                      style={motionIndex(index)}
                      onClick={clickable ? () => navigate(`/horses/${insight.horseId}`) : undefined}
                    >
                      <span className="fin-insight__rail" aria-hidden="true" />
                      <span>
                        <span className="fin-insight__title">
                          {insight.title} <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                        </span>
                        <span className="fin-insight__detail">{insight.detail}</span>
                      </span>
                      {clickable ? <ArrowUpRight className="fin-insight__go" size={18} aria-hidden="true" /> : <span />}
                    </Row>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {fin.perAnimal.length > 0 ? (
            <Card title="Profit per animal" subtitle="Every horse, most profitable first. Tap one to open its record.">
              <div className="fin-ledger">
                <div className="fin-animal fin-animal__head">
                  <span>Horse</span>
                  <span className="fin-animal__cell--hide">Invested</span>
                  <span className="fin-animal__cell--hide">Value</span>
                  <span>Profit</span>
                  <span className="fin-animal__cell--hide">Margin</span>
                </div>
                {fin.perAnimal.map((row) => {
                  const chip = statusChip[row.status];
                  const priced = row.value > 0;
                  // Profit is only shown when both price and cost are known — a
                  // missing cost basis leaves proceeds visible but profit unknown.
                  const profitKnown = priced && !row.costBlindSpot;
                  const dir = row.profit >= 0 ? 'up' : 'down';
                  return (
                    <button
                      key={row.horseId}
                      type="button"
                      className="fin-animal motion-lift"
                      onClick={() => navigate(`/horses/${row.horseId}`)}
                    >
                      <span className="fin-animal__name">
                        <span className="fin-animal__title">{row.horseName}</span>
                        <span>
                          <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                          {row.saleValueUnknown ? <StatusChip tone="warning">Sale price?</StatusChip> : null}
                          {row.underwater ? <StatusChip tone="danger">Priced to lose</StatusChip> : null}
                          {row.costBlindSpot ? <StatusChip tone="warning">No cost</StatusChip> : null}
                        </span>
                      </span>
                      <span className="fin-animal__cell fin-animal__cell--hide">{formatCurrency(row.invested)}</span>
                      <span className="fin-animal__cell fin-animal__cell--hide">
                        {priced ? formatCurrency(row.value) : '—'}
                      </span>
                      <span className={`fin-animal__cell fin-animal__profit--${dir}`}>
                        {profitKnown ? `${row.profit >= 0 ? '+' : '−'}${formatCurrency(Math.abs(row.profit))}` : '—'}
                      </span>
                      <span className="fin-animal__cell fin-animal__cell--hide">
                        {profitKnown ? formatPercent(Math.round(row.marginPercent)) : '—'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          ) : null}

          {fin.topCostCategories.length > 0 ? (
            <Card title="Where the money goes" subtitle="Total spend by category across the herd.">
              <div className="fin-costs">
                {fin.topCostCategories.slice(0, 6).map((cost) => (
                  <div key={cost.category} className="fin-cost__row">
                    <div className="fin-cost__top">
                      <span>
                        <Coins size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                        {cost.category}
                      </span>
                      <span>{formatCurrency(cost.amount)}</span>
                    </div>
                    <ProgressBar value={maxCost > 0 ? Math.round((cost.amount / maxCost) * 100) : 0} tone="amber" />
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
