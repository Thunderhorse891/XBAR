import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommandBrief } from '@/components/CommandBrief';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { DocumentBlock, Timeline } from '@/components/InteractionSystem';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { requestFeatureUpgrade } from '@/store/useUpgradeStore';
import { buildBreedingRevenueProfile, emptyBreedingEconomics } from '@/lib/breedingRevenue';
import { buildBreedingProgram, type MareStatus } from '@/lib/breedingIntelligence';
import {
  BREEDING_COMPLETION_STATES,
  BREEDING_ENTRY_KINDS,
  FOALING_RESULTS,
  PREGNANCY_RESULTS,
} from '@/lib/breedingEntry';
import { formatCompactCurrency, formatDateLabel, localIsoDate } from '@/lib/format';
import { breedingRevenueGate } from '@/lib/subscriptionGates';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { useDayKey } from '@/hooks/useDayKey';
import { useEffectiveSubscription } from '@/hooks/useOwnerPreview';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';

export default function Breeding() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const subscription = useEffectiveSubscription();
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
  // The person's own calendar day, not UTC's: an evening entry in Chicago
  // otherwise defaulted to tomorrow.
  const [eventDate, setEventDate] = useState(localIsoDate());
  // What the entry is, and a check's result, are chosen -- never read out of
  // the note (audit F07). No default: a guessed type is the defect.
  const [eventKind, setEventKind] = useState('');
  const [eventResult, setEventResult] = useState('');
  const [eventCompletionState, setEventCompletionState] = useState('');
  const [eventError, setEventError] = useState('');
  const [milestoneQuery, setMilestoneQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ horseId: string; eventId: string; horseName: string } | null>(
    null,
  );
  const addEventFormRef = useRef<HTMLDivElement | null>(null);
  const milestoneCount = breedingHorses.reduce((sum, horse) => sum + horse.breedingTimeline.length, 0);
  const blockedHorses = breedingHorses.filter((horse) => horse.readiness.packetStatus !== 'Ready');
  const dayKey = useDayKey();
  const program = useMemo(
    () => buildBreedingProgram(horses),
    // Refresh forecasts and recorded contract dates when the local day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [horses, dayKey],
  );
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
          label="Breeding entries"
          value={`${milestoneCount}`}
          detail="Recorded events, plans and notes in the program"
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
        description="Gestation estimates and pregnancy-check timing from recorded breeding evidence. Guarantee labels reflect recorded terms and review needs; they do not establish coverage or entitlement."
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
                  'foaling-unknown': 'amber',
                  'pregnancy-unknown': 'amber',
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
                        <Pill tone="slate">{mareState.guaranteeLabel}</Pill>
                        <Pill tone={tone[mareState.status]}>{mareState.statusLabel}</Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      {mareState.expectedFoalingDate ? (
                        <span>
                          Estimated foaling {formatDateLabel(mareState.expectedFoalingDate)}
                          {mareState.status === 'bred-awaiting-check' ? ' if pregnant' : ''}
                          {typeof mareState.daysToFoaling === 'number' ? ` (${mareState.daysToFoaling}d)` : ''}
                        </span>
                      ) : null}
                      {mareState.foalingWindowStart && mareState.foalingWindowEnd ? (
                        <span>
                          Estimated window {formatDateLabel(mareState.foalingWindowStart)} –{' '}
                          {formatDateLabel(mareState.foalingWindowEnd)}
                        </span>
                      ) : null}
                      {mareState.nextCheckpoint ? <span>Next: {mareState.nextCheckpoint.label}</span> : null}
                      {mareState.projectedFoalValue ? (
                        <span>Entered foal projection {formatCompactCurrency(mareState.projectedFoalValue)}</span>
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
            description="Record a completed breeding on a mare to estimate her foaling window and pregnancy-check timing. Plans and cancelled events stay on file without confirming pregnancy."
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
                        description: event.completionState
                          ? `${BREEDING_COMPLETION_STATES.find((option) => option.value === event.completionState)?.label ?? 'Occurrence unconfirmed'}: ${event.summary}`
                          : event.summary,
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
                  {canPresentPurchaseFlow() ? (
                    <button
                      className="button button--primary button--compact"
                      type="button"
                      onClick={() => requestFeatureUpgrade('breedingRevenue')}
                    >
                      Upgrade to unlock
                    </button>
                  ) : null}
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
            <label className="field-stack">
              <span className="field-label">Entry type</span>
              <select
                className="field-input"
                value={eventKind}
                onChange={(event) => {
                  setEventKind(event.target.value);
                  setEventResult('');
                  setEventError('');
                }}
                disabled={!canManageBreeding}
              >
                <option value="">Choose…</option>
                {BREEDING_ENTRY_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Occurrence</span>
              <select
                className="field-input"
                value={eventCompletionState}
                onChange={(event) => {
                  setEventCompletionState(event.target.value);
                  setEventResult('');
                  setEventError('');
                }}
                disabled={!canManageBreeding}
              >
                <option value="">Choose…</option>
                {BREEDING_COMPLETION_STATES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {eventCompletionState === 'completed' && (eventKind === 'pregnancy-check' || eventKind === 'foaling') ? (
              <label className="field-stack">
                <span className="field-label">{eventKind === 'foaling' ? 'Foaling outcome' : 'Check result'}</span>
                <select
                  className="field-input"
                  value={eventResult}
                  onChange={(event) => {
                    setEventResult(event.target.value);
                    setEventError('');
                  }}
                  disabled={!canManageBreeding}
                >
                  <option value="">Choose…</option>
                  {(eventKind === 'foaling' ? FOALING_RESULTS : PREGNANCY_RESULTS).map((result) => (
                    <option key={result.value} value={result.value}>
                      {result.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
                  kind: eventKind,
                  result: eventResult,
                  completionState: eventCompletionState,
                });

                pushToast({
                  title: result.ok ? 'Breeding event added' : 'Breeding event blocked',
                  message: result.message,
                  tone: result.ok ? 'success' : 'error',
                });

                if (result.ok) {
                  setEventBody('');
                  setEventResult('');
                  setEventError('');
                } else {
                  setEventError(result.message);
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
