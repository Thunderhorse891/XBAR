import { Link } from 'react-router-dom';
import { MetricCard, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCompactCurrency, formatCurrency, formatPercent } from '@/lib/format';
import { buildCommandCenter, buildFieldTools, buildRevenueBlueprint } from '@/lib/xbarGrowth';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';

export default function Dashboard() {
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const weather = useXbarStore((state) => state.weather);
  const subscription = useXbarStore((state) => state.subscription);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const portal = useXbarStore((state) => state.portal);
  const ocrBatches = useXbarStore((state) => state.ocrBatches);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const roleWorkspace = useCurrentRoleWorkspace();

  const saleReady = horses.filter((horse) => horse.readiness.score >= 80);
  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting');
  const ownershipAttention = ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
  const medicalWatch = horses.filter((horse) => horse.status === 'Medical Review');
  const totalInsuredValue = horses.reduce((sum, horse) => sum + horse.insuredValue, 0);
  const attentionHorses = horses.filter((horse) => horse.alerts.length > 0 || horse.readiness.score < 75).slice(0, 4);
  const buyerReadyProfiles = horses.filter((horse) =>
    buildHorsePacketCompleteness(
      horse,
      documents.filter((document) => document.horseId === horse.id),
      ownershipRecords.find((record) => record.horseId === horse.id),
    ).buyerSafe,
  );
  const commandCenter = buildCommandCenter({
    horses,
    documents,
    ownershipRecords,
    salesLeads,
    ranchAssets,
    weather,
    ocrBatches,
  });
  const fieldTools = buildFieldTools({
    horses,
    documents,
    ownershipRecords,
    salesLeads,
    portal,
    weather,
  });
  const revenuePlan = buildRevenueBlueprint(subscription);

  return (
    <>
      <PageHeader
        eyebrow="XBAR LLC"
        title="Control Deck"
        description="Trusted records. Buyer readiness. Ranch execution."
        actions={
          <>
            <Link to="/horses" className="button button--ghost">
              Horses
            </Link>
            <Link to="/documents" className="button button--primary">
              Documents
            </Link>
          </>
        }
      />

      <section className="command-stage">
        <div className="command-stage__copy">
          <div className="eyebrow">Premium ranch records</div>
          <h2 className="command-stage__title">Run XBAR like a high-value asset platform.</h2>
          <p className="command-stage__description">Cleaner records. Faster sales. Sharper field control.</p>
          <div className="inline-actions">
            <Link to="/documents" className="button button--primary button--compact">
              Clear blockers
            </Link>
            <Link to="/subscriptions" className="button button--ghost button--compact">
              ARR path
            </Link>
          </div>
        </div>
        <div className="command-stage__visual">
          <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="command-stage__logo" />
          <div className="command-stage__visual-card">
            <span className="command-stage__label">Signal stack</span>
            <strong>Trust / Buyers / Ops</strong>
            <span className="command-stage__detail">Built to outperform generic ranch tools.</span>
          </div>
        </div>
        <div className="command-stage__stats">
          <div className="command-stage__stat">
            <span className="command-stage__label">Buyer-safe profiles</span>
            <strong>{buyerReadyProfiles.length}</strong>
            <span className="command-stage__detail">Ready to share</span>
          </div>
          <div className="command-stage__stat">
            <span className="command-stage__label">$10M ARR path</span>
            <strong>{Math.round(revenuePlan.targetArr / 1_000_000)}M</strong>
            <span className="command-stage__detail">{revenuePlan.customersNeededAtCurrentTier} customers at this tier</span>
          </div>
          <div className="command-stage__stat">
            <span className="command-stage__label">Trust queue</span>
            <strong>{reviewQueue.length}</strong>
            <span className="command-stage__detail">Records still unresolved</span>
          </div>
        </div>
      </section>

      <div className="metric-grid">
        <MetricCard label="Horse portfolio" value={`${horses.length}`} detail={`${saleReady.length} with market-ready packets`} />
        <MetricCard
          label="Insured value"
          value={formatCompactCurrency(totalInsuredValue)}
          detail={`${ownershipAttention.length} ownership items still need attention`}
          tone="slate"
        />
        <MetricCard
          label="Document review"
          value={`${reviewQueue.length}`}
          detail={`${ocrBatches.reduce((sum, batch) => sum + batch.fileCount, 0)} intake files flowing through the local document queue`}
          tone="amber"
        />
        <MetricCard
          label="Owner portal"
          value={`${portal.activeOwners}/${portal.invitedOwners}`}
          detail={`${portal.openInquiries} live inquiries and ${portal.savedHorses} saved horses`}
          tone="emerald"
        />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          eyebrow="Command center"
          title="Now"
          description="Priority moves."
        >
          <div className="stack-list">
            {commandCenter.map((item) => (
              <Link key={item.id} to={item.href} className="stack-item stack-item--interactive">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{item.title}</div>
                    <div className="stack-item__copy">{item.summary}</div>
                  </div>
                  <div className="status-inline">
                    <Pill tone={item.tone}>{item.value}</Pill>
                    <Pill tone="slate">{item.module}</Pill>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Portfolio watch"
          title="Watchlist"
          description="High-weight horses."
        >
          <div className="stack-list">
            {attentionHorses.map((horse) => (
              <Link key={horse.id} to={`/horses/${horse.id}`} className="stack-item stack-item--interactive">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{horse.name}</div>
                    <div className="stack-item__copy">
                      {horse.segment} · {horse.location.barn} · {horse.owner}
                    </div>
                  </div>
                  <Pill tone={horse.status === 'Medical Review' ? 'rose' : horse.readiness.score >= 85 ? 'emerald' : 'amber'}>
                    {horse.status}
                  </Pill>
                </div>
                <div className="inline-metrics">
                  <span>Readiness {formatPercent(horse.readiness.score)}</span>
                  <span>{horse.documents.length} documents</span>
                  <span>{horse.alerts.length} alerts</span>
                </div>
                <ProgressBar value={horse.readiness.score} tone={horse.readiness.score >= 85 ? 'emerald' : 'amber'} />
              </Link>
            ))}
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel
          eyebrow="Mobile and field tools"
          title="Field tools"
          description="Built for phone and desktop."
        >
          <div className="stack-list">
            {fieldTools.map((tool) => (
              <Link key={tool.id} to={tool.href} className="stack-item stack-item--interactive">
                <div className="stack-item__top">
                  <div>
                    <div className="panel__eyebrow">{tool.eyebrow}</div>
                    <div className="stack-item__title">{tool.title}</div>
                    <div className="stack-item__copy">{tool.summary}</div>
                  </div>
                  <Pill tone={tool.tone}>{tool.metric}</Pill>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Product moat"
          title="Moat"
          description="Why XBAR can win."
        >
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Record trust graph</div>
                <Pill tone="emerald">Premium wedge</Pill>
              </div>
              <div className="stack-item__copy">Every document becomes structured, trusted truth.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Buyer deal room</div>
                <Pill tone="blue">Revenue engine</Pill>
              </div>
              <div className="stack-item__copy">Profiles and packet trust should feel like premium deal software.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Mobile field execution</div>
                <Pill tone="amber">Real-world use</Pill>
              </div>
              <div className="stack-item__copy">Capture updates from the barn, pasture, or trailer fast.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Ownership and compliance radar</div>
                <Pill tone="rose">Hard to replace</Pill>
              </div>
              <div className="stack-item__copy">Transfer risk and title clarity are pain points most tools barely touch.</div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel
          eyebrow="Documents"
          title="Intake queue"
          description="OCR throughput."
        >
          <div className="stack-list">
            {ocrBatches.map((batch) => (
              <div key={batch.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{batch.label}</div>
                    <div className="stack-item__copy">
                      {batch.fileCount} files · {batch.receivedAt} · {batch.source}
                    </div>
                  </div>
                  <Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>
                    {batch.state}
                  </Pill>
                </div>
                <div className="inline-metrics">
                  <span>{batch.matchedCount} matched</span>
                  <span>{batch.needsReviewCount} need review</span>
                  <span>{batch.processedCount}/{batch.fileCount} processed</span>
                </div>
                <ProgressBar value={(batch.processedCount / batch.fileCount) * 100} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          eyebrow="Ownership"
          title="Ownership"
          description="Integrity and transfer status."
        >
          <div className="stack-list">
            {ownershipRecords.map((record) => {
              const horse = horses.find((item) => item.id === record.horseId);
              return (
                <div key={record.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{horse?.name ?? record.legalOwner}</div>
                      <div className="stack-item__copy">Legal owner: {record.legalOwner}</div>
                    </div>
                    <Pill tone={record.transferStatus === 'Clear' ? 'emerald' : 'amber'}>{record.transferStatus}</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{record.pendingDocuments.length || 0} pending docs</span>
                    <span>Confidence {record.confidence}%</span>
                    <span>Due {record.complianceDeadline}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel
          eyebrow="Environment"
          title="Weather"
          description="Field conditions."
        >
          <div className="weather-shell">
            <div className="weather-shell__headline">
              <div>
                <div className="weather-shell__temp">{weather.currentTempF}F</div>
                <div className="weather-shell__copy">{weather.condition}</div>
              </div>
              <Pill tone={weather.riskLevel === 'Action' ? 'rose' : weather.riskLevel === 'Watch' ? 'amber' : 'emerald'}>
                {weather.riskLevel}
              </Pill>
            </div>
            <div className="key-grid">
              <div className="key-grid__item">
                <div className="key-grid__label">Wind</div>
                <div className="key-grid__value">{weather.windMph} mph</div>
              </div>
              <div className="key-grid__item">
                <div className="key-grid__label">Humidity</div>
                <div className="key-grid__value">{weather.humidity}%</div>
              </div>
            </div>
            <div className="detail-block">
              <strong>Pasture impact:</strong> {weather.pastureImpact}
            </div>
            <div className="detail-block">
              <strong>Transport:</strong> {weather.transportImpact}
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Commercial layer"
          title="Commercial"
          description="Plans, ARR, portal."
        >
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">{subscription.tier}</div>
                  <div className="stack-item__copy">{subscription.billingState} · renews {subscription.renewalDate}</div>
                </div>
                <Pill tone="blue">{formatCurrency(subscription.monthlyRate)}/mo</Pill>
              </div>
              <div className="inline-metrics">
                <span>{subscription.usage.seatsUsed}/{subscription.usage.seatLimit} seats</span>
                <span>{subscription.usage.portalSeatsUsed}/{subscription.usage.portalSeatLimit} portal seats</span>
                <span>{subscription.usage.ocrProcessed}/{subscription.usage.ocrLimit} OCR pages</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">$10M ARR blueprint</div>
              <div className="inline-metrics">
                <span>{formatCompactCurrency(revenuePlan.currentArr)} current ARR equivalent</span>
                <span>{formatCompactCurrency(revenuePlan.arrGap)} remaining gap</span>
                <span>{revenuePlan.recommendedMixLabel}</span>
              </div>
              <div className="detail-block subtle">
                Setup helps cash flow. Subscriptions build the business.
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Portal readiness</div>
              <div className="inline-metrics">
                <span>{portal.activeOwners} active owners</span>
                <span>{portal.savedHorses} saved horses</span>
                <span>{portal.openInquiries} open inquiries</span>
              </div>
              <div className="detail-block subtle">
                Google and Facebook login are not connected yet.
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Role focus" title={roleWorkspace.label} description={roleWorkspace.summary} meta={<Pill tone="blue">{roleWorkspace.primaryModules.length} priority modules</Pill>}>
          <div className="token-row">
            {roleWorkspace.primaryModules.map((module) => (
              <Pill key={module} tone="blue">
                {module}
              </Pill>
            ))}
          </div>
          <div className="bullet-list">
            {roleWorkspace.permissions.map((permission) => (
              <div key={permission} className="bullet-list__item">
                {permission}
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Lead intelligence" title="Buyer signals" description="Pipeline view.">
          <div className="stack-list">
            {salesLeads.map((lead) => {
              const horse = horses.find((item) => item.id === lead.horseId);
              return (
                <div key={lead.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{lead.name}</div>
                      <div className="stack-item__copy">
                        {lead.channel} · {horse?.name}
                      </div>
                    </div>
                    <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>
                      {lead.stage}
                    </Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>Last touch {lead.lastTouch}</span>
                    <span>{lead.savedListing ? 'Saved listing' : 'No saved listing yet'}</span>
                    <span>{lead.ownerPortalReady ? 'Portal ready' : 'Portal not sent'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {medicalWatch.length ? (
        <Panel eyebrow="Medical watch" title="Care attention" description="Open medical items.">
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Horse</th>
                  <th>Latest note</th>
                  <th>Owner</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {medicalWatch.map((horse) => (
                  <tr key={horse.id}>
                    <td>{horse.name}</td>
                    <td>{horse.medicalTimeline[0]?.title ?? 'No medical entry'}</td>
                    <td>{horse.assignments.veterinarian}</td>
                    <td>{horse.lastVetVisit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
