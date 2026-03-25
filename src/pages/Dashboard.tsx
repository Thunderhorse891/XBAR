import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCompactCurrency, formatDateLabel, formatPercent } from '@/lib/format';
import { buildCommandCenter, buildFieldTools } from '@/lib/xbarGrowth';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';

type DashboardMenuState =
  | { type: 'command'; id: string; x: number; y: number }
  | { type: 'horse'; id: string; x: number; y: number }
  | { type: 'record'; id: string; x: number; y: number }
  | { type: 'lead'; id: string; x: number; y: number };

export default function Dashboard() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const weather = useXbarStore((state) => state.weather);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const portal = useXbarStore((state) => state.portal);
  const ocrBatches = useXbarStore((state) => state.ocrBatches);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const roleWorkspace = useCurrentRoleWorkspace();
  const [menuState, setMenuState] = useState<DashboardMenuState | null>(null);

  const saleReady = horses.filter((horse) => horse.readiness.score >= 80);
  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting');
  const ownershipAttention = ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
  const medicalWatch = horses.filter((horse) => horse.status === 'Medical Review');
  const totalInsuredValue = horses.reduce((sum, horse) => sum + horse.insuredValue, 0);
  const averageReadiness = horses.length ? Math.round(horses.reduce((sum, horse) => sum + horse.readiness.score, 0) / horses.length) : 0;
  const attentionHorses = horses.filter((horse) => horse.alerts.length > 0 || horse.readiness.score < 75).slice(0, 5);
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
  }).slice(0, 4);

  const menuCommand = menuState?.type === 'command' ? commandCenter.find((item) => item.id === menuState.id) ?? fieldTools.find((item) => item.id === menuState.id) : undefined;
  const menuHorse = menuState?.type === 'horse' ? horses.find((horse) => horse.id === menuState.id) : undefined;
  const menuRecord = menuState?.type === 'record' ? ownershipRecords.find((record) => record.id === menuState.id) : undefined;
  const menuLead = menuState?.type === 'lead' ? salesLeads.find((lead) => lead.id === menuState.id) : undefined;
  const menuRecordHorse = horses.find((horse) => horse.id === menuRecord?.horseId);
  const menuLeadHorse = horses.find((horse) => horse.id === menuLead?.horseId);
  const menuItems = menuCommand
    ? [
        {
          id: 'open-workspace',
          label: 'Open workspace',
          onSelect: () => navigate(menuCommand.href),
        },
      ]
    : menuHorse
      ? [
          {
            id: 'open-horse',
            label: 'Open horse profile',
            onSelect: () => navigate(`/horses/${menuHorse.id}`),
          },
          {
            id: 'preview-profile',
            label: 'Preview buyer profile',
            onSelect: () => navigate(`/profiles/${menuHorse.id}`),
          },
          {
            id: 'open-sales',
            label: 'Open sales board',
            onSelect: () => navigate('/sales'),
          },
        ]
      : menuRecord
        ? [
            {
              id: 'open-ownership',
              label: 'Open ownership record',
              onSelect: () => navigate('/ownership'),
            },
            ...(menuRecordHorse
              ? [
                  {
                    id: 'open-record-horse',
                    label: 'Open horse profile',
                    onSelect: () => navigate(`/horses/${menuRecordHorse.id}`),
                  },
                ]
              : []),
          ]
        : menuLead
          ? [
              {
                id: 'open-sales-lead',
                label: 'Open sales board',
                onSelect: () => navigate('/sales'),
              },
              ...(menuLeadHorse
                ? [
                    {
                      id: 'open-lead-horse',
                      label: 'Open horse profile',
                      onSelect: () => navigate(`/horses/${menuLeadHorse.id}`),
                    },
                  ]
                : []),
            ]
          : [];

  return (
    <>
      <PageHeader
        eyebrow="Ops center"
        title="Control deck"
        description="Queue, transfers, buyers, weather."
        actions={
          <>
            <Link to="/horses" className="button button--ghost button--compact">
              Ledger
            </Link>
            <Link to="/documents" className="button button--primary button--compact">
              Review queue
            </Link>
          </>
        }
      />

      <section className="dashboard-stage">
        <div className="dashboard-stage__hero">
          <div className="eyebrow">Live operations</div>
          <h2 className="dashboard-stage__title">Clear the queue. Keep transfers clean. Move buyers faster.</h2>
          <p className="dashboard-stage__description">Built for working records, not decorative farm software.</p>
          <div className="inline-actions">
            <Link to="/documents" className="button button--primary button--compact">
              Review intake
            </Link>
            <Link to="/horses?new=1" className="button button--ghost button--compact">
              Add horse
            </Link>
          </div>
          <div className="dashboard-stage__chips">
            <Pill tone="blue">{roleWorkspace.label}</Pill>
            <Pill tone="emerald">{buyerReadyProfiles.length} buyer-safe</Pill>
            <Pill tone={ownershipAttention.length ? 'amber' : 'emerald'}>
              {ownershipAttention.length ? `${ownershipAttention.length} transfer blockers` : 'Transfers clear'}
            </Pill>
          </div>
        </div>

        <div className="dashboard-stage__board">
          {commandCenter.slice(0, 4).map((item) => (
            <Link
              key={item.id}
              to={item.href}
              className={`signal-card signal-card--${item.tone}`}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenuState({ type: 'command', id: item.id, x: event.clientX, y: event.clientY });
              }}
            >
              <div className="signal-card__module">{item.module}</div>
              <div className="signal-card__title">{item.title}</div>
              <div className="signal-card__copy">{item.summary}</div>
              <div className="signal-card__value">{item.value}</div>
            </Link>
          ))}
        </div>

        <div className="dashboard-stage__aside">
          <div className="dashboard-brand-panel">
            <div className="dashboard-brand-panel__mark">
              <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="dashboard-brand-panel__logo" />
            </div>
            <div className="dashboard-brand-panel__copy">
              <span>Average readiness</span>
              <strong>{averageReadiness}%</strong>
            </div>
          </div>

          <div className="dashboard-kpi-list">
            <div className="dashboard-kpi">
              <span className="dashboard-kpi__label">Review queue</span>
              <strong className="dashboard-kpi__value">{reviewQueue.length}</strong>
              <span className="dashboard-kpi__detail">Documents waiting on review</span>
            </div>
            <div className="dashboard-kpi">
              <span className="dashboard-kpi__label">Open transfers</span>
              <strong className="dashboard-kpi__value">{ownershipAttention.length}</strong>
              <span className="dashboard-kpi__detail">Ownership records not yet clear</span>
            </div>
            <div className="dashboard-kpi">
              <span className="dashboard-kpi__label">Qualified buyers</span>
              <strong className="dashboard-kpi__value">{salesLeads.filter((lead) => lead.stage === 'Qualified' || lead.stage === 'Offer').length}</strong>
              <span className="dashboard-kpi__detail">Qualified and offer-stage leads</span>
            </div>
          </div>
        </div>
      </section>

      <div className="metric-grid">
        <MetricCard label="Portfolio" value={`${horses.length}`} detail={`${saleReady.length} market ready`} />
        <MetricCard label="Insured value" value={formatCompactCurrency(totalInsuredValue)} detail={`${ownershipAttention.length} transfer blockers`} tone="slate" />
        <MetricCard label="Buyer-safe" value={`${buyerReadyProfiles.length}`} detail="Profiles clear to share" tone="emerald" />
        <MetricCard label="Medical watch" value={`${medicalWatch.length}`} detail="Care-sensitive horses" tone="rose" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Priority board" title="What needs action now">
          {commandCenter.length ? (
            <div className="stack-list">
              {commandCenter.map((item) => (
                <Link
                  key={item.id}
                  to={item.href}
                  className="stack-item stack-item--interactive"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'command', id: item.id, x: event.clientX, y: event.clientY });
                  }}
                >
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
          ) : (
            <EmptyState compact title="No priorities right now" description="As activity builds, the command center will bubble the next high-weight moves here." />
          )}
        </Panel>

        <Panel eyebrow="Horse watch" title="Records carrying risk">
          {attentionHorses.length ? (
            <div className="stack-list">
              {attentionHorses.map((horse) => (
                <Link
                  key={horse.id}
                  to={`/horses/${horse.id}`}
                  className="stack-item stack-item--interactive"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'horse', id: horse.id, x: event.clientX, y: event.clientY });
                  }}
                >
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
                    <span>Trust {formatPercent(horse.readiness.score)}</span>
                    <span>{horse.documents.length} docs</span>
                    <span>{horse.alerts.length} alerts</span>
                  </div>
                  <ProgressBar value={horse.readiness.score} tone={horse.readiness.score >= 85 ? 'emerald' : 'amber'} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No horses on watch" description="Medical and readiness alerts will surface here when a profile needs attention." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel eyebrow="Documents" title="Recent intake">
          {ocrBatches.length ? (
            <div className="stack-list">
              {ocrBatches.slice(0, 5).map((batch) => (
                <Link key={batch.id} to="/documents" className="stack-item stack-item--interactive">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{batch.label}</div>
                      <div className="stack-item__copy">
                        {batch.fileCount} files · {batch.source} · {formatDateLabel(batch.receivedAt)}
                      </div>
                    </div>
                    <Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>
                      {batch.state}
                    </Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{batch.processedCount}/{batch.fileCount} processed</span>
                    <span>{batch.matchedCount} matched</span>
                    <span>{batch.needsReviewCount} in review</span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No intake batches" description="Upload documents to start the review queue." />
          )}
        </Panel>

        <Panel eyebrow="Ownership" title="Transfer queue">
          {ownershipRecords.length ? (
            <div className="stack-list">
              {ownershipRecords.slice(0, 5).map((record) => {
                const horse = horses.find((item) => item.id === record.horseId);
                return (
                  <button
                    key={record.id}
                    type="button"
                    className="stack-item stack-item--interactive"
                    onClick={() => navigate('/ownership')}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuState({ type: 'record', id: record.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{horse?.name ?? record.legalOwner}</div>
                        <div className="stack-item__copy">Legal owner: {record.legalOwner}</div>
                      </div>
                      <Pill tone={record.transferStatus === 'Clear' ? 'emerald' : 'amber'}>{record.transferStatus}</Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{record.pendingDocuments.length} pending docs</span>
                      <span>Due {formatDateLabel(record.complianceDeadline)}</span>
                      <span>Confidence {record.confidence}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No ownership queue" description="Transfers will appear here once horses and ownership records are active." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel eyebrow="Buyer signals" title="Recent leads">
          {salesLeads.length ? (
            <div className="stack-list">
              {salesLeads.slice(0, 5).map((lead) => {
                const horse = horses.find((item) => item.id === lead.horseId);
                return (
                  <button
                    key={lead.id}
                    type="button"
                    className="stack-item stack-item--interactive"
                    onClick={() => navigate('/sales')}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuState({ type: 'lead', id: lead.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{lead.name}</div>
                        <div className="stack-item__copy">
                          {lead.channel} · {horse?.name ?? 'Unassigned horse'}
                        </div>
                      </div>
                      <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>
                        {lead.stage}
                      </Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>Last touch {formatDateLabel(lead.lastTouch)}</span>
                      <span>{lead.savedListing ? 'Saved listing' : 'Not saved yet'}</span>
                      <span>{lead.ownerPortalReady ? 'Portal ready' : 'Portal pending'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No buyer leads yet" description="Create a lead from a horse profile or the sales board to start tracking outreach." />
          )}
        </Panel>

        <Panel eyebrow="Weather" title="Field conditions">
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
              <strong>Pasture:</strong> {weather.pastureImpact}
            </div>
            <div className="detail-block">
              <strong>Transport:</strong> {weather.transportImpact}
            </div>
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel eyebrow="Field tools" title="Fast jumps">
          <div className="stack-list">
            {fieldTools.map((tool) => (
              <Link
                key={tool.id}
                to={tool.href}
                className="stack-item stack-item--interactive"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuState({ type: 'command', id: tool.id, x: event.clientX, y: event.clientY });
                }}
              >
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{tool.title}</div>
                    <div className="stack-item__copy">{tool.summary}</div>
                  </div>
                  <Pill tone={tool.tone}>{tool.metric}</Pill>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Role focus" title={roleWorkspace.label} meta={<Pill tone="blue">{roleWorkspace.primaryModules.length} modules</Pill>}>
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
      </div>

      {medicalWatch.length ? (
        <Panel eyebrow="Medical watch" title="Recent care-sensitive horses">
          <div className="table-shell">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Horse</th>
                  <th>Latest note</th>
                  <th>Veterinarian</th>
                  <th>Last visit</th>
                </tr>
              </thead>
              <tbody>
                {medicalWatch.map((horse) => (
                  <tr key={horse.id} className="table-row--interactive" onClick={() => navigate(`/horses/${horse.id}`)}>
                    <td>{horse.name}</td>
                    <td>{horse.medicalTimeline[0]?.title ?? 'No medical entry'}</td>
                    <td>{horse.assignments.veterinarian}</td>
                    <td>{formatDateLabel(horse.lastVetVisit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
