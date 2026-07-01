import { useNavigate } from 'react-router-dom';
import { Card, PageHead, ReadinessChart, StatusChip } from '@/components/saas';
import {
  dashboardMetrics,
  documentExpiry,
  readinessSegments,
  saasHorses,
  stateToTone,
} from '@/data/xbarSaasMock';
import { HorsesIcon } from '@/components/icons';

export default function Reports() {
  const navigate = useNavigate();

  return (
    <>
      <PageHead
        eyebrow="Account"
        title="Reports"
        subtitle="Release readiness, document health, and transaction performance across the operation."
      />

      <div className="xs-grid-2">
        <Card title="Release Readiness" subtitle="Transaction confidence across active sale assets">
          <div className="xs-readiness">
            <div>
              <ReadinessChart score={dashboardMetrics.readinessScore} segments={readinessSegments} mark={<HorsesIcon width={26} height={26} />} />
              <div className="xs-legend">
                {readinessSegments.map((seg) => (
                  <span key={seg.label} className="xs-legend__item">
                    <span className="xs-legend__swatch" style={{ background: seg.tone }} /> {seg.label} · {seg.value}
                  </span>
                ))}
              </div>
            </div>
            <div className="xs-rows">
              {saasHorses.map((h) => (
                <div key={h.id} className="xs-row">
                  <span className="xs-row__main">
                    <span className="xs-row__title">{h.name}</span>
                    <span className="xs-row__meta">Readiness {h.readinessScore}%</span>
                  </span>
                  <StatusChip tone={stateToTone[h.saleStatus]}>{h.saleStatus}</StatusChip>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Document Health" subtitle="Expiring and missing documents by type">
          <div className="xs-bigstat">
            <span className="xs-bigstat__num">{documentExpiry.total}</span>
            <span className="xs-bigstat__txt">expiring soon</span>
          </div>
          <div className="xs-breakdown">
            {documentExpiry.breakdown.map((row) => (
              <div key={row.label} className="xs-breakdown__row">
                <span>{row.label}</span>
                <span className="xs-breakdown__count">{row.count}</span>
              </div>
            ))}
          </div>
          <button type="button" className="xs-btn xs-btn--block" onClick={() => navigate('/documents')}>
            Open Documents
          </button>
        </Card>
      </div>

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Active sale prospects</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{dashboardMetrics.activeSaleProspects}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Buyer folders</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{dashboardMetrics.buyerDealRooms}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Overall readiness</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{dashboardMetrics.readinessScore}%</div>
        </Card>
      </div>
    </>
  );
}
