import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowUpRight,
  CalendarClock,
  ChevronRight,
  FileWarning,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { Card, MetricRow, ReadinessChart, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useXbarStore } from '@/store/useXbarStore';
import {
  activity30d,
  dashboardMetrics,
  documentExpiry,
  intelligenceRail,
  pipelineFeature,
  readinessSegments,
  stateToTone,
  topReleaseItems,
  xbarRanch,
} from '@/data/xbarSaasMock';

function formatUsd(n: number) {
  return `$${n.toLocaleString('en-US')}`;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const [bannerOpen, setBannerOpen] = useState(true);
  const [releaseDrawer, setReleaseDrawer] = useState<(typeof topReleaseItems)[number] | null>(null);

  const ranchName = workspaceProfile.ranchName || workspaceProfile.businessName || xbarRanch.name;
  const horseCount = horses.length || dashboardMetrics.horses;
  const docExpiringCount = documentExpiry.total;

  const metrics = [
    { icon: <HorsesIcon width={18} height={18} />, value: horseCount, label: 'Horses', to: '/horses' },
    { icon: <Users size={18} />, value: dashboardMetrics.activeSaleProspects, label: 'Active Sale Prospects', to: '/sales-pipeline' },
    { icon: <FileWarning size={18} />, value: docExpiringCount, label: 'Documents Expiring', to: '/documents' },
    { icon: <Users size={18} />, value: dashboardMetrics.buyerDealRooms, label: 'Buyer Deal Rooms', to: '/buyer-deal-room' },
    { icon: <Sparkles size={18} />, value: `${dashboardMetrics.readinessScore}%`, label: 'Readiness Score', to: '/reports' },
  ];

  const step = pipelineFeature.currentStep;

  return (
    <>
      <div className="xs-page__head">
        <div>
          <div className="xs-eyebrow">{ranchName}</div>
          <h1 className="xs-title">Dashboard</h1>
          <p className="xs-subtitle">Ranch operations and sale-readiness overview across active transaction assets.</p>
        </div>
      </div>

      {bannerOpen ? (
        <div className="xs-banner">
          <span className="xs-banner__icon">
            <Sparkles size={18} />
          </span>
          <div className="xs-banner__body">
            <div className="xs-banner__title">Review the new XBAR Sale Packet Studio</div>
            <div className="xs-banner__sub">Assemble buyer-ready packets, verify Buyer-Safe Proof, and resolve release blockers in one place.</div>
          </div>
          <button type="button" className="xs-btn xs-btn--primary xs-btn--sm" onClick={() => navigate('/sale-packet-studio')}>
            Open Studio
          </button>
          <button type="button" className="xs-iconbtn" aria-label="Dismiss" onClick={() => setBannerOpen(false)}>
            <X size={15} />
          </button>
        </div>
      ) : null}

      <div className="xs-dash">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Top grid: metric stack | readiness | activity */}
          <div className="xs-grid-top">
            <div className="xs-metricstack">
              {metrics.map((m) => (
                <MetricRow key={m.label} icon={m.icon} value={m.value} label={m.label} onClick={() => navigate(m.to)} />
              ))}
            </div>

            <Card title="Sale Readiness" subtitle="Transaction confidence across active sale assets" link="Open readiness report" onLink={() => navigate('/reports')}>
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
                <div>
                  <div className="xs-card__sub" style={{ marginBottom: 6, fontWeight: 600 }}>Top Release Items</div>
                  <div className="xs-readiness-list">
                    {topReleaseItems.map((item) => (
                      <button key={item.label} type="button" className="xs-readiness-row" onClick={() => setReleaseDrawer(item)}>
                        <span className="xs-readiness-row__label">{item.label}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <StatusChip tone={stateToTone[item.state]}>{item.state}</StatusChip>
                          <ChevronRight size={15} className="xs-muted" />
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card title="Activity" subtitle="Last 30 days vs previous">
              <div className="xs-activity">
                {activity30d.map((a) => (
                  <button key={a.label} type="button" className="xs-activity__row" onClick={() => navigate(a.to)}>
                    <span className="xs-activity__num">{a.num}</span>
                    <span className="xs-activity__label">{a.label}</span>
                    <span className="xs-activity__delta">{a.delta}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>

          {/* Bottom grid: pipeline | document expiry */}
          <div className="xs-grid-bottom">
            <Card title="Sales Pipeline" link="Open pipeline" onLink={() => navigate('/sales-pipeline')}>
              <div className="xs-pipeline__head">
                <div className="xs-pipeline__name">{pipelineFeature.name}</div>
                <StatusChip tone="warning">Offer received</StatusChip>
              </div>
              <div className="xs-stepbar">
                {pipelineFeature.steps.map((label, i) => (
                  <div key={label} className="xs-step">
                    <div className={`xs-step__bar${i < step ? ' xs-step__bar--done' : i === step ? ' xs-step__bar--current' : ''}`} />
                    <div className={`xs-step__label${i === step ? ' xs-step__label--current' : ''}`}>{label}</div>
                  </div>
                ))}
              </div>
              <div className="xs-pipeline__stats">
                <div>
                  <div className="xs-stat__value">{formatUsd(pipelineFeature.currentOffer)}</div>
                  <div className="xs-stat__label">Current offer</div>
                </div>
                <div>
                  <div className="xs-stat__value">{formatUsd(pipelineFeature.targetPrice)}</div>
                  <div className="xs-stat__label">Target sale price</div>
                </div>
                <div>
                  <div className="xs-stat__value">{pipelineFeature.daysActive}</div>
                  <div className="xs-stat__label">Days active</div>
                </div>
                <div style={{ marginLeft: 'auto', alignSelf: 'center' }}>
                  <button type="button" className="xs-btn xs-btn--primary xs-btn--sm" onClick={() => navigate('/sales-pipeline')}>
                    Update Deal
                  </button>
                </div>
              </div>
            </Card>

            <Card title="Document Expiry">
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
                View All Documents
              </button>
            </Card>
          </div>
        </div>

        {/* Intelligence rail */}
        <IntelligenceRail navigate={navigate} />
      </div>

      <SlideOverDrawer
        open={Boolean(releaseDrawer)}
        title={releaseDrawer?.label ?? ''}
        subtitle="Release readiness detail"
        onClose={() => setReleaseDrawer(null)}
        footer={
          <>
            <button type="button" className="xs-btn" onClick={() => setReleaseDrawer(null)}>
              Close
            </button>
            <button type="button" className="xs-btn xs-btn--primary" onClick={() => navigate('/sale-packet-studio')}>
              Open in Studio
            </button>
          </>
        }
      >
        {releaseDrawer ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusChip tone={stateToTone[releaseDrawer.state]}>{releaseDrawer.state}</StatusChip>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{releaseDrawer.detail}</p>
            <hr className="xs-divider" />
            <div className="xs-card__sub" style={{ fontWeight: 600 }}>What this controls</div>
            <p className="xs-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              Release items gate whether an asset can move to a buyer. Clear every item to reach a buyer-safe release state.
            </p>
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}

function IntelligenceRail({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="xs-rail">
      <div className="xs-rail__title">
        <Sparkles size={13} /> XBAR Intelligence Rail
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Transaction Command</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Status</span>
          <StatusChip tone="success">{intelligenceRail.status}</StatusChip>
        </div>
        <div className="xs-rail__actions">
          <button type="button" className="xs-btn xs-btn--primary xs-btn--block" onClick={() => navigate('/sale-packet-studio')}>
            Prepare for Release
          </button>
          <div className="xs-rail__secondary">
            <button type="button" className="xs-btn" onClick={() => navigate('/sale-packet-studio')}>
              Share Packet
            </button>
            <button type="button" className="xs-btn" onClick={() => navigate('/buyer-deal-room')}>
              Open Deal Room
            </button>
          </div>
        </div>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Release Status</div>
        {intelligenceRail.release.map((row) => (
          <div key={row.label} className="xs-railrow">
            <span className="xs-railrow__label">{row.label}</span>
            <span className="xs-railrow__value">
              <StatusChip tone={row.tone}>{row.value}</StatusChip>
            </span>
          </div>
        ))}
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Next Action</div>
        <div className="xs-nextaction">
          <div className="xs-nextaction__title">{intelligenceRail.nextAction.title}</div>
          <div className="xs-nextaction__detail">{intelligenceRail.nextAction.detail}</div>
          <button type="button" className="xs-btn xs-btn--brass xs-btn--sm" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => navigate('/sale-packet-studio')}>
            Open <ArrowUpRight size={14} />
          </button>
        </div>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Recent Activity</div>
        <div className="xs-feed">
          {intelligenceRail.recentActivity.map((row) => (
            <div key={row.label} className="xs-feed__row">
              <span className="xs-feed__dot" />
              <span style={{ flex: 1 }}>
                {row.label}
                <div className="xs-feed__time">{row.time}</div>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Document Expiry</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <CalendarClock size={16} className="xs-muted" />
          <strong>{documentExpiry.total}</strong> documents expiring soon
        </div>
        <div className="xs-docchips">
          {documentExpiry.breakdown.map((row) => (
            <div key={row.label} className="xs-docchip">
              <div className="xs-docchip__num">{row.count}</div>
              <div className="xs-docchip__label">{row.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
