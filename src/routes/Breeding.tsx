import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandBrief } from '@/components/CommandBrief';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { DocumentBlock, Timeline } from '@/components/InteractionSystem';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { billingPath } from '@/lib/billingRoutes';
import { buildBreedingRevenueProfile, emptyBreedingEconomics } from '@/lib/breedingRevenue';
import { buildBreedingProgram, type MareStatus } from '@/lib/breedingIntelligence';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { breedingRevenueGate } from '@/lib/subscriptionGates';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

export default function Breeding() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const subscription = useXbarStore((state) => state.subscription);
  const addBreedingEvent = useXbarStore((state) => state.addBreedingEvent);
  const deleteBreedingEvent = useXbarStore((state) => state.deleteBreedingEvent);
  const updateBreedingEconomics = useXbarStore((state) => state.updateBreedingEconomics);
  const pushToast = useUiStore((state) => state.pushToast);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const session = useCloudStore((state) => state.session);
  const currentUserName =
    session?.user?.user_metadata?.full_name ||
    session?.user?.email?.split('@')[0] ||
    workspaceProfile.ranchManagerName ||
    workspaceProfile.defaultOwnerName ||
    'Ranch Staff';
  const canManageBreeding = useCurrentRoleCapability('manageBreeding');
  const breedingHorses = horses.filter((horse) => horse.segment === 'Stud' || horse.sex === 'Mare');
  const breedingDocs = documents.filter((document) => document.type === 'Breeding Contract');
  const [selectedHorseId, setSelectedHorseId] = useState(breedingHorses[0]?.id ?? '');
  const selectedHorse = breedingHorses.find((horse) => horse.id === selectedHorseId) ?? breedingHorses[0];
  const selectedRevenue = selectedHorse ? buildBreedingRevenueProfile(selectedHorse, expenseReceipts) : undefined;
  const revenueGate = breedingRevenueGate(subscription);
  const initialEconomics = { ...emptyBreedingEconomics, ...selectedHorse?.breedingEconomics };
  const [economics, setEconomics] = useState({
    studFee: String(initialEconomics.studFee),
    bookedMares: String(initialEconomics.bookedMares),
    breedingCosts: String(initialEconomics.breedingCosts),
    mareProductionValue: String(initialEconomics.mareProductionValue),
    foalProjectedValue: String(initialEconomics.foalProjectedValue),
  });
  const [eventTitle, setEventTitle] = useState('Breeding milestone');
  const [eventBody, setEventBody] = useState('');
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [eventError, setEventError] = useState('');
  const [milestoneQuery, setMilestoneQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ horseId: string; eventId: string; horseName: string } | null>(
    null,
  );
  const addEventFormRef = useRef<HTMLDivElement | null>(null);
  const milestoneCount = breedingHorses.reduce((sum, horse) => sum + horse.breedingTimeline.length, 0);
  const blockedHorses = breedingHorses.filter((horse) => horse.readiness.packetStatus !== 'Ready');
  const program = useMemo(() => buildBreedingProgram(horses), [horses]);
  const programEdge = program.overdueCheckCount > 0 ? 'rose' : program.nearTerm > 0 ? 'amber' : 'blue';
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);
  const menuHorse = breedingHorses.find((horse) => horse.id === menuState?.horseId);
  const menuItems = menuHorse
    ? [
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'prepare-event',
          label: 'Log breeding event',
          onSelect: () => setSelectedHorseId(menuHorse.id),
        },
      ]
    : [];

  return (
    <>
      <CommandBrief
        variant="split"
        eyebrow="Breeding"
        entity="Breeding"
        status={
          blockedHorses.length
            ? { label: `${blockedHorses.length} record blockers`, tone: 'amber' }
            : { label: 'Program records clear', tone: 'blue' }
        }
        summary={`${breedingHorses.length} mares and studs tracked with ${milestoneCount} program milestones on file.`}
        evidence={[
          { label: 'Program horses', value: String(breedingHorses.length), to: '/horses' },
          { label: 'Contracts', value: String(breedingDocs.length), to: '/documents' },
          { label: 'Upcoming milestones', value: String(milestoneCount) },
        ]}
        risks={blockedHorses.slice(0, 5).map((horse) => ({
          label: `${horse.name} — ${horse.readiness.packetStatus}`,
          severity: 'amber' as const,
          to: `/horses/${horse.id}`,
        }))}
        nextAction={
          canManageBreeding
            ? {
                label: 'Log breeding event',
                onClick: () => {
                  addEventFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  addEventFormRef.current?.querySelector<HTMLElement>('select, input')?.focus({ preventScroll: true });
                },
              }
            : { label: 'Log breeding event', disabledReason: 'Your role cannot manage breeding records.' }
        }
      />

      <div className="metric-grid">
        <MetricCard
          label="Program horses"
          value={`${breedingHorses.length}`}
          detail="Mares and studs tracked in active breeding context"
        />
        <MetricCard
          label="Contract docs"
          value={`${breedingDocs.length}`}
          detail="Breeding-specific documents linked into the record model"
          tone="blue"
        />
        <MetricCard
          label="Live milestones"
          value={`${milestoneCount}`}
          detail="Timeline entries currently supporting the program"
          tone="blue"
        />
        <MetricCard
          label="Missing records"
          value={`${blockedHorses.length}`}
          detail="Horses still missing packet elements or imagery"
          tone="amber"
        />
      </div>

      <Panel
        eyebrow="Breeding intelligence"
        title="Foaling forecast & program value"
        description="Gestation, pregnancy checks, and live-foal guarantees computed from each mare's breeding timeline. Every mare carries her next action."
        edge={programEdge}
      >
        {program.maresTracked ? (
          <>
            <div className="inline-metrics" style={{ marginBottom: 14 }}>
              <span>{program.inFoal} confirmed in foal</span>
              <span>{program.nearTerm} near term</span>
              <span>{program.overdueCheckCount} overdue checks</span>
              <span>Projected foal value {formatCompactCurrency(program.projectedProgramValue)}</span>
              <span>Projected margin {formatCompactCurrency(program.projectedProgramMargin)}</span>
            </div>
            <div className="stack-list">
              {program.mares.map((mareState) => {
                const tone: Record<MareStatus, 'blue' | 'amber' | 'rose' | 'slate'> = {
                  open: 'slate',
                  'bred-awaiting-check': 'amber',
                  'in-foal': 'blue',
                  'near-term': 'amber',
                  'foaled-live': 'blue',
                  'foaled-loss': 'rose',
                  'not-breeding': 'slate',
                };
                return (
                  <div
                    key={mareState.horseId}
                    className="stack-item stack-item--interactive"
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/horses/${mareState.horseId}`)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        navigate(`/horses/${mareState.horseId}`);
                      }
                    }}
                  >
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">
                          {mareState.horseName}
                          {mareState.mateName ? ` × ${mareState.mateName}` : ''}
                        </div>
                        <div className="stack-item__copy">{mareState.actionLabel}</div>
                      </div>
                      <div className="status-inline">
                        {mareState.overdueCheckpoints.length ? (
                          <Pill tone="rose">{mareState.overdueCheckpoints.length} overdue</Pill>
                        ) : null}
                        {mareState.guarantee === 'rebreed-owed' ? (
                          <Pill tone="rose">rebreed owed</Pill>
                        ) : mareState.guarantee === 'covered' ? (
                          <Pill tone="blue">LFG covered</Pill>
                        ) : null}
                        <Pill tone={tone[mareState.status]}>{mareState.statusLabel}</Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      {mareState.expectedFoalingDate ? (
                        <span>
                          Due {formatDateLabel(mareState.expectedFoalingDate)}
                          {typeof mareState.daysToFoaling === 'number' ? ` (${mareState.daysToFoaling}d)` : ''}
                        </span>
                      ) : null}
                      {mareState.foalingWindowStart && mareState.foalingWindowEnd ? (
                        <span>
                          Window {formatDateLabel(mareState.foalingWindowStart)} –{' '}
                          {formatDateLabel(mareState.foalingWindowEnd)}
                        </span>
                      ) : null}
                      {mareState.nextCheckpoint ? <span>Next: {mareState.nextCheckpoint.label}</span> : null}
                      {mareState.projectedFoalValue ? (
                        <span>Foal value {formatCompactCurrency(mareState.projectedFoalValue)}</span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <EmptyState
            compact
            title="No mares in the breeding cycle yet"
            description="Log a breeding event on a mare and XBAR forecasts her foaling window, schedules the pregnancy checks, and tracks the live-foal guarantee."
          />
        )}
      </Panel>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Breeding Board" title="Board">
          {breedingHorses.length ? (
            <div className="stack-list">
              {breedingHorses.map((horse) => (
                <div
                  key={horse.id}
                  className="stack-item stack-item--interactive"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/horses/${horse.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/horses/${horse.id}`);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ horseId: horse.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{horse.name}</div>
                      <div className="stack-item__copy">
                        {horse.sex} · {horse.bloodline.family}
                      </div>
                    </div>
                    <Pill tone="blue">{horse.segment}</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{horse.assignments.ranchManager}</span>
                    <span>{horse.location.barn}</span>
                    <span>{horse.breedingTimeline.length} milestones</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No horses in the breeding program"
              description="Move a mare or stud into the breeding lane to start tracking milestones."
            />
          )}
        </Panel>

        <Panel eyebrow="Milestones" title="Milestones">
          {breedingHorses.some((horse) => horse.breedingTimeline.length) ? (
            (() => {
              const allMilestones = breedingHorses.flatMap((horse) =>
                horse.breedingTimeline.map((event) => ({ horse, event })),
              );
              const filtered = milestoneQuery.trim()
                ? allMilestones.filter(
                    ({ horse, event }) =>
                      horse.name.toLowerCase().includes(milestoneQuery.toLowerCase()) ||
                      event.title.toLowerCase().includes(milestoneQuery.toLowerCase()),
                  )
                : allMilestones;
              return (
                <>
                  <div style={{ marginBottom: '14px' }}>
                    <input
                      className="field-input"
                      placeholder="Search horse or milestone..."
                      value={milestoneQuery}
                      onChange={(e) => setMilestoneQuery(e.target.value)}
                      style={{ maxWidth: '320px' }}
                    />
                  </div>
                  {filtered.length ? (
                    <Timeline
                      label="Breeding milestones"
                      items={filtered.map(({ horse, event }) => ({
                        id: event.id,
                        date: formatDateLabel(event.date),
                        title: `${horse.name} | ${event.title}`,
                        description: event.summary,
                        onActivate: () => navigate(`/horses/${horse.id}`),
                        action: (
                          <div className="inline-actions">
                            <button
                              className="button button--ghost button--compact"
                              type="button"
                              onClick={() => navigate(`/horses/${horse.id}`)}
                            >
                              Open
                            </button>
                            {canManageBreeding ? (
                              <button
                                className="button button--ghost button--compact"
                                type="button"
                                style={{ color: 'var(--rose)' }}
                                onClick={() =>
                                  setPendingDelete({ horseId: horse.id, eventId: event.id, horseName: horse.name })
                                }
                              >
                                Delete
                              </button>
                            ) : null}
                          </div>
                        ),
                      }))}
                    />
                  ) : (
                    <p style={{ color: 'var(--muted)', fontSize: '14px' }}>No milestones match "{milestoneQuery}".</p>
                  )}
                </>
              );
            })()
          ) : (
            <EmptyState
              compact
              title="No breeding milestones yet"
              description="Log breeding events to track contracts, foaling, and program timing."
            />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary" ref={addEventFormRef}>
        <Panel
          eyebrow="Revenue program"
          title="Breeding economics"
          description="Turn contracts, mare performance, foal value, and linked spend into an ROI decision."
        >
          {selectedRevenue ? (
            <>
              <div className="metric-grid">
                <MetricCard
                  label="Stallion revenue"
                  value={formatCompactCurrency(selectedRevenue.stallionRevenue)}
                  detail="Stud fee multiplied by booked mares"
                  tone="emerald"
                />
                <MetricCard
                  label="Mare production"
                  value={formatCompactCurrency(selectedRevenue.economics.mareProductionValue)}
                  detail="Attributed production value"
                  tone="blue"
                />
                <MetricCard
                  label="Foal projected"
                  value={formatCompactCurrency(selectedRevenue.economics.foalProjectedValue)}
                  detail="Projected foal value"
                />
                <MetricCard
                  label="Program ROI"
                  value={`${Math.round(selectedRevenue.roi)}%`}
                  detail={`${formatCompactCurrency(selectedRevenue.totalCosts)} total linked costs`}
                  tone={selectedRevenue.roi >= 0 ? 'emerald' : 'rose'}
                />
              </div>
              {revenueGate ? (
                <div className="stack-item">
                  <div className="stack-item__title">Unlock premium breeding-operation controls</div>
                  <div className="stack-item__copy">{revenueGate}</div>
                  <button
                    className="button button--primary button--compact"
                    type="button"
                    onClick={() => navigate(billingPath)}
                  >
                    Upgrade to unlock
                  </button>
                </div>
              ) : (
                <div className="form-grid form-grid--tight">
                  {(
                    [
                      ['studFee', 'Stud fee'],
                      ['bookedMares', 'Booked mares'],
                      ['breedingCosts', 'Direct breeding costs'],
                      ['mareProductionValue', 'Mare production value'],
                      ['foalProjectedValue', 'Foal projected value'],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="field-stack" key={key}>
                      <span className="field-label">{label}</span>
                      <input
                        className="field-input"
                        type="number"
                        min="0"
                        value={economics[key]}
                        onChange={(event) => setEconomics((current) => ({ ...current, [key]: event.target.value }))}
                        disabled={!canManageBreeding}
                      />
                    </label>
                  ))}
                  <button
                    className="button button--primary button--compact"
                    type="button"
                    disabled={!selectedHorse || !canManageBreeding}
                    onClick={() => {
                      if (!selectedHorse) return;
                      const result = updateBreedingEconomics(selectedHorse.id, {
                        studFee: Number(economics.studFee),
                        bookedMares: Number(economics.bookedMares),
                        breedingCosts: Number(economics.breedingCosts),
                        mareProductionValue: Number(economics.mareProductionValue),
                        foalProjectedValue: Number(economics.foalProjectedValue),
                      });
                      pushToast({
                        title: result.ok ? 'Breeding economics saved' : 'Revenue update blocked',
                        message: result.message,
                        tone: result.ok ? 'success' : 'error',
                      });
                    }}
                  >
                    Save revenue model
                  </button>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              compact
              title="Select a breeding horse"
              description="Assign a mare or stud to the program to calculate value and ROI."
            />
          )}
        </Panel>

        <Panel eyebrow="Program action" title="Add breeding event" description="Log a milestone.">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Horse</span>
              <select
                className="field-input"
                value={selectedHorseId}
                onChange={(event) => {
                  const horse = breedingHorses.find((item) => item.id === event.target.value);
                  const values = { ...emptyBreedingEconomics, ...horse?.breedingEconomics };
                  setSelectedHorseId(event.target.value);
                  setEconomics({
                    studFee: String(values.studFee),
                    bookedMares: String(values.bookedMares),
                    breedingCosts: String(values.breedingCosts),
                    mareProductionValue: String(values.mareProductionValue),
                    foalProjectedValue: String(values.foalProjectedValue),
                  });
                }}
                disabled={!canManageBreeding}
              >
                <option value="">Select horse</option>
                {breedingHorses.map((horse) => (
                  <option key={horse.id} value={horse.id}>
                    {horse.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Event date</span>
              <input
                className="field-input"
                type="date"
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
                disabled={!canManageBreeding}
              />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Milestone</span>
              <input
                className="field-input"
                value={eventTitle}
                onChange={(event) => {
                  setEventTitle(event.target.value);
                  setEventError('');
                }}
                disabled={!canManageBreeding}
              />
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Breeding note</span>
              <textarea
                className="field-textarea"
                rows={4}
                value={eventBody}
                onChange={(event) => {
                  setEventBody(event.target.value);
                  setEventError('');
                }}
                disabled={!canManageBreeding}
              />
            </label>
          </div>
          {eventError ? <div className="field-error">{eventError}</div> : null}
          <div className="inline-actions">
            <button
              className="button button--primary button--compact"
              type="button"
              onClick={() => {
                if (!selectedHorseId || !eventTitle.trim() || !eventBody.trim() || !eventDate.trim()) {
                  setEventError('Horse, date, milestone, and note are required.');
                  return;
                }

                const result = addBreedingEvent(selectedHorseId, {
                  title: eventTitle,
                  body: eventBody,
                  author: currentUserName,
                  date: eventDate,
                });

                pushToast({
                  title: result.ok ? 'Breeding event added' : 'Breeding event blocked',
                  message: result.message,
                  tone: result.ok ? 'success' : 'error',
                });

                if (result.ok) {
                  setEventBody('');
                  setEventError('');
                }
              }}
              disabled={!canManageBreeding}
            >
              Save breeding event
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Contracts" title="Contract coverage" description="Linked documents.">
          {breedingDocs.length ? (
            <div className="stack-list">
              {breedingDocs.map((document) => (
                <DocumentBlock
                  key={document.id}
                  title={document.title}
                  type={document.type}
                  state={document.state}
                  detail={document.summary}
                  onActivate={() => navigate('/documents')}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              compact
              title="No breeding contracts linked"
              description="Upload breeding contracts in Documents to tie program records into this lane."
            />
          )}
        </Panel>
      </div>

      <ContextMenu
        open={Boolean(menuHorse)}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        items={menuItems}
        onClose={() => setMenuState(null)}
      />

      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        tone="danger"
        title="Delete breeding record"
        consequences={[
          `The event is removed from ${pendingDelete?.horseName ?? 'this horse'}'s breeding timeline.`,
          'Deletion is recorded in the audit log.',
          'This cannot be undone.',
        ]}
        confirmLabel="Delete record"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const result = deleteBreedingEvent(pendingDelete.horseId, pendingDelete.eventId);
          pushToast({
            title: result.ok ? 'Event removed' : 'Remove blocked',
            message: result.message,
            tone: result.ok ? 'warning' : 'error',
          });
          setPendingDelete(null);
        }}
      />
    </>
  );
}
