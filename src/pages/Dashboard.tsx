import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
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
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const sharedAccess = useXbarStore((state) => state.sharedAccess);
  const intakeBatches = useXbarStore((state) => state.intakeBatches);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const roleWorkspace = useCurrentRoleWorkspace();
  const [menuState, setMenuState] = useState<DashboardMenuState | null>(null);

  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const ownershipAttention = ownershipRecords.filter((record) => record.transferStatus !== 'Clear');
  const medicalWatch = horses.filter((horse) => horse.status === 'Medical Review');
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
    intakeBatches,
  });
  const fieldTools = buildFieldTools({
    horses,
    documents,
    ownershipRecords,
    salesLeads,
    sharedAccess,
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
            id: 'open-profile',
            label: 'Open buyer profile',
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
        title="Overview"
        actions={
          <>
            <Link to="/horses" className="button button--ghost button--compact">
              Horses
            </Link>
            <Link to="/documents" className="button button--primary button--compact">
              Review
            </Link>
          </>
        }
      />

      <section className="dashboard-stage">
        <div className="dashboard-stage__hero">
          <h2 className="dashboard-stage__title">Private workspace</h2>
          <div className="inline-actions">
            <Link to="/documents" className="button button--primary button--compact">
              Review
            </Link>
            <Link to="/horses?new=1" className="button button--ghost button--compact">
              New horse
            </Link>
          </div>
          <div className="dashboard-stage__chips">
            <Pill tone="blue">{roleWorkspace.label}</Pill>
            <Pill tone="emerald">{buyerReadyProfiles.length} share-ready</Pill>
            <Pill tone={ownershipAttention.length ? 'amber' : 'slate'}>{ownershipAttention.length ? `${ownershipAttention.length} blockers` : 'Clear'}</Pill>
          </div>
        </div>

        <div className="dashboard-stage__board">
          {commandCenter.slice(0, 3).map((item) => (
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

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel title="Priority">
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
            <EmptyState compact title="No priorities right now" description="New work will appear here." />
          )}
        </Panel>

        <Panel title="Watch">
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
                    <div className="stack-item__title">{horse.name}</div>
                    <Pill tone={horse.status === 'Medical Review' ? 'rose' : horse.readiness.score >= 85 ? 'emerald' : 'amber'}>
                      {horse.status}
                    </Pill>
                  </div>
                  <div className="inline-metrics">
                      <span>{horse.segment}</span>
                      <span>{horse.location.barn}</span>
                      <span>{horse.alerts.length} alerts</span>
                    </div>
                  <ProgressBar value={horse.readiness.score} tone={horse.readiness.score >= 85 ? 'emerald' : 'amber'} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No horses on watch" description="Alerts will appear here." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel title="Intake">
          {intakeBatches.length ? (
            <div className="stack-list">
              {intakeBatches.slice(0, 5).map((batch) => (
                <Link key={batch.id} to="/documents" className="stack-item stack-item--interactive">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{batch.label}</div>
                    <Pill tone={batch.state === 'Completed' ? 'emerald' : batch.state === 'Reviewing' ? 'amber' : 'blue'}>
                      {batch.state}
                    </Pill>
                  </div>
                    <div className="inline-metrics">
                      <span>{formatDateLabel(batch.receivedAt)}</span>
                      <span>{batch.processedCount}/{batch.fileCount} logged</span>
                      <span>{batch.needsReviewCount} review</span>
                    </div>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No intake batches" description="Upload documents to start the queue." />
          )}
        </Panel>

        <Panel title="Transfers">
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
                      <div className="stack-item__title">{horse?.name ?? record.legalOwner}</div>
                      <Pill tone={record.transferStatus === 'Clear' ? 'emerald' : 'amber'}>{record.transferStatus}</Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{record.pendingDocuments.length} pending</span>
                      <span>Due {formatDateLabel(record.complianceDeadline)}</span>
                      <span>{record.confidence}% confidence</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No ownership queue" description="Transfers will appear here." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel title="Leads">
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
                      <div className="stack-item__title">{lead.name}</div>
                      <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>
                        {lead.stage}
                      </Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{horse?.name ?? 'Unassigned'}</span>
                      <span>{lead.channel}</span>
                      <span>{formatDateLabel(lead.lastTouch)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No buyer leads yet" description="Create a lead to start outreach." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--secondary">
        <Panel title="Jump">
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
                  <div className="stack-item__title">{tool.title}</div>
                  <Pill tone={tool.tone}>{tool.metric}</Pill>
                </div>
              </Link>
            ))}
          </div>
        </Panel>

        <Panel title={roleWorkspace.label} meta={<Pill tone="slate">{roleWorkspace.primaryModules.length} modules</Pill>}>
          <div className="token-row">
            {roleWorkspace.primaryModules.map((module) => (
              <Pill key={module} tone="blue">
                {module}
              </Pill>
            ))}
          </div>
        </Panel>
      </div>

      {medicalWatch.length ? (
        <Panel title="Medical">
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
