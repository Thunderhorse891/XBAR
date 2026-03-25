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
        title="Dashboard"
        description="A premium operating system for records, ownership integrity, buyer trust, and ranch execution across desktop, web, and mobile workflows."
        actions={
          <>
            <Link to="/horses" className="button button--ghost">
              View Horses
            </Link>
            <Link to="/documents" className="button button--primary">
              Open Documents
            </Link>
          </>
        }
      />

      <section className="command-stage">
        <div className="command-stage__copy">
          <div className="eyebrow">Production upgrade</div>
          <h2 className="command-stage__title">Build the category leader around trust, speed, and premium buyer outcomes.</h2>
          <p className="command-stage__description">
            Generic ranch tools stop at chores and logs. XBAR wins by turning paperwork chaos, ownership risk, and sale delays into one premium records and revenue engine.
          </p>
          <div className="inline-actions">
            <Link to="/documents" className="button button--primary button--compact">
              Clear trust blockers
            </Link>
            <Link to="/subscriptions" className="button button--ghost button--compact">
              Open ARR plan
            </Link>
          </div>
        </div>
        <div className="command-stage__stats">
          <div className="command-stage__stat">
            <span className="command-stage__label">Buyer-safe profiles</span>
            <strong>{buyerReadyProfiles.length}</strong>
            <span className="command-stage__detail">Ready to convert with confidence</span>
          </div>
          <div className="command-stage__stat">
            <span className="command-stage__label">$10M ARR path</span>
            <strong>{Math.round(revenuePlan.targetArr / 1_000_000)}M</strong>
            <span className="command-stage__detail">{revenuePlan.customersNeededAtCurrentTier} customers at current tier</span>
          </div>
          <div className="command-stage__stat">
            <span className="command-stage__label">Trust queue</span>
            <strong>{reviewQueue.length}</strong>
            <span className="command-stage__detail">Docs still blocking premium workflows</span>
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
          title="What the team should do next"
          description="A premium product needs to behave like an operating system: visible priorities, clear routes, and a fast path from signal to action."
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
          title="High-context horse signals"
          description="The horses below are carrying the most immediate operational weight across sales, medical, and ownership."
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
          title="Tools that make the app indispensable in the real world"
          description="These are the workflows that need to feel faster, cleaner, and more premium than generic ranch software on a phone or desktop."
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
          title="Why this can beat generic ranch tools"
          description="The winning product is not broader first. It is sharper, more trusted, and more revenue-linked first."
        >
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Record trust graph</div>
                <Pill tone="emerald">Premium wedge</Pill>
              </div>
              <div className="stack-item__copy">Every document should create verified, traceable facts that improve buyer trust and ownership integrity.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Buyer deal room</div>
                <Pill tone="blue">Revenue engine</Pill>
              </div>
              <div className="stack-item__copy">Profiles, packet trust, watchlists, and inquiry handoff should feel closer to premium enterprise sales software than a horse listing site.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Mobile field execution</div>
                <Pill tone="amber">Real-world use</Pill>
              </div>
              <div className="stack-item__copy">Teams need to capture updates from the barn, trailer, pasture, and show ground without friction or data loss.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Ownership and compliance radar</div>
                <Pill tone="rose">Hard to replace</Pill>
              </div>
              <div className="stack-item__copy">Transfer status, signatures, due dates, and audit notes are operational pain points most ranch tools barely touch.</div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel
          eyebrow="Documents"
          title="Intake queue"
          description="The intake, review, and match workflow is live in this workspace. External OCR providers are not connected yet."
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
          title="Integrity and transfer posture"
          description="Legal owner, co-owner, and transfer states are surfaced as first-class operating signals."
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
          title="Weather and ranch conditions"
          description="Operational weather now sits alongside portfolio risk so turnout, transport, and breeding timing stay visible."
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
          title="Plan, seats, ARR path, and external access"
          description="Subscriptions, owner portal, and revenue design are product architecture, not afterthought settings."
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
                Setup fees help cash flow, but subscriptions and premium retention are what get the business to durable eight-figure revenue.
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

        <Panel eyebrow="Lead intelligence" title="Buyer and social signals" description="Lead capture, saved horse behavior, and owner portal handoff can now sit in the same operating picture.">
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
        <Panel eyebrow="Medical watch" title="Open care attention" description="The product now exposes urgent horse care as a real lane inside the dashboard instead of burying it behind basic cards.">
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
