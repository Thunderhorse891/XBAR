import { Link } from 'react-router-dom';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatCompactCurrency } from '@/lib/format';
import { followUpTiming } from '@/lib/salesFollowUp';
import { useXbarStore } from '@/store/useXbarStore';

function pct(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function Bar({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="xbar-intel-bar">
      <div className="xbar-intel-bar__top">
        <span>{label}</span>
        <strong>{pct(value)}</strong>
      </div>
      <div className="xbar-intel-bar__track">
        <span style={{ width: pct(value) }} />
      </div>
      <small>{detail}</small>
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const safePoints = points.length ? points : [8, 18, 14, 22, 20, 28];
  const max = Math.max(...safePoints, 1);
  const polyline = safePoints
    .map((value, index) => {
      const x = safePoints.length === 1 ? 0 : (index / (safePoints.length - 1)) * 100;
      const y = 46 - (value / max) * 36;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="xbar-intel-sparkline" viewBox="0 0 100 52" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 44H100" />
      <path d="M0 28H100" />
      <path d="M0 12H100" />
      <polyline points={polyline} />
    </svg>
  );
}

export function XbarIntelligenceRail() {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const subscription = useXbarStore((state) => state.subscription);

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const transferGaps = buildTransferGapRows(horses, ownershipRecords, documents);
  const careBoard = buildCareBoardRows(horses, documents, expenseReceipts);
  const careDueCount = careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).length;
  const budget = buildBudgetSummary(expenseReceipts);
  const activeLeads = salesLeads.filter((lead) => lead.stage !== 'Closed');
  const offerLeads = activeLeads.filter((lead) => lead.stage === 'Offer');
  const buyerDue = activeLeads.filter((lead) => {
    const timing = followUpTiming(lead);
    return timing === 'Overdue' || timing === 'Today';
  }).length;
  const offerValue = offerLeads.reduce((sum, lead) => sum + (lead.offerAmount ?? 0), 0);
  const proofScore = documents.length ? ((documents.length - reviewQueue.length) / documents.length) * 100 : 86;
  const careScore = careBoard.length ? ((careBoard.length - careDueCount) / careBoard.length) * 100 : 91;
  const buyerScore = activeLeads.length ? ((activeLeads.length - buyerDue) / activeLeads.length) * 100 : 76;
  const revenueScore = Math.min(100, 24 + offerLeads.length * 18 + activeLeads.length * 7);
  const motionFeed = [
    { label: 'Proof chain', value: `${transferGaps.length + reviewQueue.length} open`, to: transferGaps.length ? '/ownership' : '/documents' },
    { label: 'Buyer heat', value: `${buyerDue} due now`, to: '/follow-ups' },
    { label: 'Plan engine', value: subscription.tier, to: '/subscriptions' },
  ];
  const linePoints = [
    transferGaps.length + 4,
    reviewQueue.length + 8,
    careDueCount + 6,
    activeLeads.length + 12,
    offerLeads.length * 3 + 10,
    Math.max(12, Math.round(budget.total / 1000)),
  ];

  return (
    <section className="xbar-intelligence-rail" aria-label="XBAR operating intelligence">
      <div className="xbar-intelligence-rail__copy">
        <span>XBAR intelligence</span>
        <strong>The operating system for modern horse operations</strong>
        <p>Every tab now reads from the same command model: proof, care, buyers, spend, plan pressure, and the next decision.</p>
      </div>

      <div className="xbar-intelligence-rail__graph" aria-label="Operational trend">
        <div className="xbar-intelligence-rail__graph-head">
          <span>Live command curve</span>
          <strong>{formatCompactCurrency(offerValue || budget.total || 0)}</strong>
        </div>
        <Sparkline points={linePoints} />
      </div>

      <div className="xbar-intelligence-rail__bars">
        <Bar label="Proof" value={proofScore} detail={`${reviewQueue.length} review items`} />
        <Bar label="Care" value={careScore} detail={`${careDueCount} holds`} />
        <Bar label="Buyers" value={buyerScore} detail={`${activeLeads.length} active`} />
        <Bar label="Revenue" value={revenueScore} detail={`${offerLeads.length} offers`} />
      </div>

      <div className="xbar-intelligence-rail__motion" aria-label="Moving command boxes">
        {motionFeed.map((item, index) => (
          <Link className="xbar-motion-box" to={item.to} key={item.label} style={{ animationDelay: `${index * 110}ms` }}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </Link>
        ))}
      </div>
    </section>
  );
}
