import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, PageHead, ReadinessChart, StatusChip } from '@/components/saas';
import { useXbarStore } from '@/store/useXbarStore';
import { HorsesIcon } from '@/components/icons';

export default function Reports() {
  const navigate = useNavigate();
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const salesLeads = useXbarStore((s) => s.salesLeads);

  const model = useMemo(() => {
    const scores = horses.map((h) => h.readiness?.score ?? 0);
    const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const ready = scores.filter((s) => s >= 95).length;
    const gettingThere = scores.filter((s) => s >= 75 && s < 95).length;
    const notReady = scores.filter((s) => s < 75).length;
    const segments = [
      { label: 'Ready to sell', value: ready, tone: 'var(--xbar-success)' },
      { label: 'Getting there', value: gettingThere, tone: 'var(--xbar-warning)' },
      { label: 'Not ready', value: notReady, tone: 'var(--xbar-danger)' },
    ];
    const needsReview = documents.filter((d) => d.state === 'Needs Review' || d.state === 'Queued' || d.state === 'Matched').length;
    const activeSales = salesLeads.filter((l) => l.stage !== 'Closed').length;
    const buyers = new Set(salesLeads.map((l) => l.name)).size;
    return { avg, segments, needsReview, activeSales, buyers };
  }, [horses, documents, salesLeads]);

  if (horses.length === 0) {
    return (
      <>
        <PageHead eyebrow="Account" title="Reports" subtitle="See how ready your horses are to sell, and what documents need attention." />
        <Card><div className="xs-empty">Add horses and documents to see your reports here.</div></Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Account"
        title="Reports"
        subtitle="See how ready your horses are to sell, and what documents need attention."
      />

      <div className="xs-grid-2">
        <Card title="Ready to Sell" subtitle="How close your horses are to being sale-ready">
          <div className="xs-readiness">
            <div>
              <ReadinessChart score={model.avg} segments={model.segments} mark={<HorsesIcon width={26} height={26} />} />
              <div className="xs-legend">
                {model.segments.map((seg) => (
                  <span key={seg.label} className="xs-legend__item">
                    <span className="xs-legend__swatch" style={{ background: seg.tone }} /> {seg.label} · {seg.value}
                  </span>
                ))}
              </div>
            </div>
            <div className="xs-rows">
              {horses.map((h) => {
                const score = h.readiness?.score ?? 0;
                return (
                  <div key={h.id} className="xs-row" role="button" tabIndex={0} onClick={() => navigate(`/horses/${h.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/horses/${h.id}`)} style={{ cursor: 'pointer' }}>
                    <span className="xs-row__main">
                      <span className="xs-row__title">{h.name}</span>
                      <span className="xs-row__meta">{score}% ready</span>
                    </span>
                    <StatusChip tone={score >= 95 ? 'success' : score >= 75 ? 'warning' : 'danger'}>{score >= 95 ? 'Ready' : score >= 75 ? 'Getting there' : 'Not ready'}</StatusChip>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>

        <Card title="Documents" subtitle="What needs checking">
          <div className="xs-bigstat">
            <span className="xs-bigstat__num">{model.needsReview}</span>
            <span className="xs-bigstat__txt">to check</span>
          </div>
          <button type="button" className="xs-btn xs-btn--block" onClick={() => navigate('/documents')}>
            Open Documents
          </button>
        </Card>
      </div>

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Horses for sale</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{model.activeSales}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Buyers in progress</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{model.buyers}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Average ready-to-sell</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{model.avg}%</div>
        </Card>
      </div>
    </>
  );
}
