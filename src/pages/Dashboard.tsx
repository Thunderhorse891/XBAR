import { type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { useXbarStore } from '@/store/useXbarStore';

const EMPTY_PROFILE_CARDS = [
  { label: 'Horse Record', title: 'Name, barn, owner, status', meta: 'Start with the basic file.', status: 'Ready', metric: '01' },
  { label: 'Documents', title: 'Registration, Coggins, receipts', meta: 'Upload documents when they are available.', status: 'Next', metric: '02' },
  { label: 'Health', title: 'Vet, dental, worming, turnout', meta: 'Track care history from one place.', status: 'Planned', metric: '03' },
  { label: 'Sales', title: 'Photos, notes, buyer details', meta: 'Prepare sale materials when needed.', status: 'Optional', metric: '04' },
];

const EMPTY_SETUP_STEPS = [
  { number: '01', title: 'Add a horse', body: 'Create the first horse record with name, barn, owner, and status.', action: 'Add Horse', path: '/horses?new=1' },
  { number: '02', title: 'Upload documents', body: 'Add Coggins, registration, health papers, contracts, and receipts.', action: 'Upload Documents', path: '/documents?upload=1' },
  { number: '03', title: 'Set up the ranch', body: 'Confirm barn, pasture, owner, weather, and account settings.', action: 'Settings', path: '/settings' },
];

function HorseContour({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 560 270" fill="none" aria-hidden="true">
      <path d="M26 183c49-38 102-57 159-57 32 0 54 9 80 26 21 14 43 20 72 17 46-5 78-26 111-57 18-17 37-30 61-35 12-2 22 1 28 11 6 12-2 26-19 35-19 10-39 17-58 23-15 5-28 13-39 24-17 17-35 34-60 44-38 15-81 10-119-3-35-12-67-13-104-4-41 10-76 7-112-24Z" />
      <path d="M179 126c10-31 31-54 61-66 32-13 71-9 101 10 23 15 40 38 58 60" />
      <path d="M247 65c-9-22-6-42 9-54 17 22 20 42 8 60" />
      <path d="M314 66c9-19 25-29 47-28-1 25-14 40-39 44" />
      <path d="M118 190c-14 16-24 34-29 55" />
      <path d="M202 205c-6 18-10 35-10 52" />
      <path d="M371 207c5 18 15 34 30 48" />
      <path d="M438 177c20 17 33 38 38 64" />
    </svg>
  );
}

type Tone = 'emerald' | 'amber' | 'rose' | 'blue' | 'slate';

export default function Dashboard() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);

  const hasWorkspaceData = Boolean(
    horses.length || documents.length || ownershipRecords.length || expenseReceipts.length || salesLeads.length,
  );

  if (!hasWorkspaceData) {
    return (
      <>
        <section className="xbar-home-atelier xbar-home-briefing" aria-labelledby="xbar-home-title">
          <div className="xbar-home-atelier__x" aria-hidden="true" />
          <div className="xbar-home-atelier__copy">
            <div className="xbar-home-atelier__brandline">
              <span className="xbar-home-atelier__mark"><XbarMark tone="mono" /></span>
              <span>Your Barn</span>
            </div>
            <h1 id="xbar-home-title">Add your first horse.</h1>
            <p>
              Create a record for your first horse and upload its papers. XBAR keeps health, ownership, buyers, weather, and costs organized around it.
            </p>
            <div className="xbar-home-atelier__chips" aria-label="First workspace modules">
              <span>Horse Records</span>
              <span>Documents</span>
              <span>Health</span>
              <span>Sales</span>
            </div>
            <div className="xbar-home-atelier__actions">
              <Link to="/horses?new=1" className="xbar-home-action xbar-home-action--primary">Add Horse</Link>
              <Link to="/documents?upload=1" className="xbar-home-action">Upload Documents</Link>
              <Link to="/settings" className="xbar-home-action">Settings</Link>
            </div>
          </div>

          <div className="xbar-home-atelier__visual" aria-hidden="true">
            <HorseContour className="xbar-home-atelier__horse" />
            <div className="xbar-profile-carousel">
              {EMPTY_PROFILE_CARDS.map((card, index) => (
                <article className="xbar-profile-card" style={{ '--card-index': index, '--card-delay': `${index * -3.15}s` } as CSSProperties} key={card.label}>
                  <span className="xbar-profile-card__metric">{card.metric}</span>
                  <div className="xbar-profile-card__head"><span>{card.label}</span><i /></div>
                  <strong>{card.title}</strong>
                  <small>{card.meta}</small>
                  <em>{card.status}</em>
                  <span className="xbar-profile-card__rail" />
                </article>
              ))}
            </div>
          </div>

          <div className="xbar-home-runway" aria-label="Empty workspace counters">
            <div><span>Horses</span><strong>0</strong><small>none yet</small></div>
            <div><span>Documents</span><strong>0</strong><small>none uploaded</small></div>
            <div><span>Transfers</span><strong>0</strong><small>none pending</small></div>
            <div><span>Buyers</span><strong>0</strong><small>no activity yet</small></div>
          </div>
        </section>

        <section className="xbar-setup-flow" aria-label="First setup sequence">
          <div className="xbar-setup-flow__header">
            <div><span>Get Started</span><h2>Create the first horse record</h2></div>
            <p>XBAR becomes useful as soon as one horse has a record, documents, and care details attached.</p>
          </div>
          <div className="xbar-setup-flow__grid">
            {EMPTY_SETUP_STEPS.map((step, index) => (
              <Link className="xbar-sequence-card" to={step.path} key={step.number} style={{ '--step-delay': `${index * 90}ms` } as CSSProperties}>
                <span className="xbar-sequence-card__number">{step.number}</span>
                <div><strong>{step.title}</strong><p>{step.body}</p></div>
                <em>{step.action}</em>
              </Link>
            ))}
          </div>
        </section>
      </>
    );
  }

  // ---- derivations ------------------------------------------------------
  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const transferGaps = buildTransferGapRows(horses, ownershipRecords, documents);
  const careBoard = buildCareBoardRows(horses, documents, expenseReceipts);
  const careDueCount = careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).length;
  const blockedIds = new Set(transferGaps.map((gap) => gap.horseId));

  const commandPackets = horses.map((horse) => ({
    horse,
    packet: buildHorsePacketCompleteness(
      horse,
      documents.filter((document) => document.horseId === horse.id),
      ownershipRecords.find((record) => record.horseId === horse.id),
    ),
  }));
  const documentsMissing = commandPackets.reduce((sum, item) => sum + item.packet.saleSlots.filter((slot) => slot.status !== 'ready').length, 0);
  const packetReadiness = commandPackets.length
    ? Math.round(commandPackets.reduce((sum, item) => sum + item.packet.score, 0) / commandPackets.length)
    : 0;

  type LaneKey = 'ready' | 'review' | 'blocked';
  const lanes: Record<LaneKey, typeof horses> = { ready: [], review: [], blocked: [] };
  horses.forEach((horse) => {
    const key: LaneKey = blockedIds.has(horse.id) || (horse.readiness.blockers?.length ?? 0) > 0
      ? 'blocked'
      : horse.readiness.packetStatus === 'Ready'
        ? 'ready'
        : 'review';
    lanes[key].push(horse);
  });

  const openDeals = salesLeads.filter((lead) => lead.stage === 'Offer' || lead.stage === 'Qualified');
  const revenueAtRisk = openDeals.filter((lead) => blockedIds.has(lead.horseId)).reduce((sum, lead) => sum + (lead.offerAmount ?? 0), 0);

  const urgencyCount = transferGaps.length + careDueCount + reviewQueue.length;
  const nextMove = transferGaps.length
    ? 'Resolve the title and transfer blockers'
    : careDueCount
      ? 'Clear the care holds that are due'
      : reviewQueue.length
        ? 'Review the documents waiting in the queue'
        : openDeals.length
          ? 'Move qualified buyers toward an offer'
          : 'Prepare the next buyer-ready horse record';
  const nextMovePath = transferGaps.length ? '/ownership' : careDueCount ? '/medical' : reviewQueue.length ? '/documents' : openDeals.length ? '/sales' : '/horses';

  const priorityActions: { key: string; tone: Tone; severity: string; horse: string; problem: string; impact: string; detail: string; action: string; path: string }[] = [
    ...transferGaps.map((gap) => ({ key: `tg-${gap.horseId}`, tone: 'rose' as Tone, severity: 'Critical', horse: gap.horseName, problem: 'Title & transfer blocked', impact: 'Sale cannot close until ownership clears', detail: gap.reasons.slice(0, 2).join(' · ') || `${gap.pendingCount} documents pending`, action: 'Open ownership', path: '/ownership' })),
    ...careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).map((row) => ({ key: `care-${row.horseId}`, tone: 'amber' as Tone, severity: 'High', horse: row.horseName, problem: 'Care hold due', impact: 'Welfare risk and lost buyer trust', detail: row.signals.filter((signal) => signal.status !== 'clear').slice(0, 2).map((signal) => signal.label).join(' · ') || 'Care due', action: 'Open health', path: '/medical' })),
    ...reviewQueue.slice(0, 3).map((document) => ({ key: `doc-${document.id}`, tone: 'blue' as Tone, severity: 'Medium', horse: horses.find((horse) => horse.id === document.horseId)?.name ?? 'Document queue', problem: `Review ${document.title}`, impact: 'Buyer packet stays incomplete', detail: `${document.type} · waiting in queue`, action: 'Open documents', path: '/documents' })),
  ].slice(0, 5);

  const laneMeta: Record<LaneKey, { label: string; tone: Tone; action: string; path: string }> = {
    ready: { label: 'Ready', tone: 'emerald', action: 'Stage buyer packets', path: '/horses' },
    review: { label: 'Needs review', tone: 'amber', action: 'Clear documents & vet review', path: '/documents' },
    blocked: { label: 'Blocked', tone: 'rose', action: 'Resolve ownership holds', path: '/ownership' },
  };

  // Document Risk Map — aggregate missing release-evidence slots by type
  const docRiskMap = (() => {
    const counts = new Map<string, number>();
    commandPackets.forEach((item) => item.packet.saleSlots.forEach((slot) => {
      if (slot.status !== 'ready') counts.set(slot.label, (counts.get(slot.label) ?? 0) + 1);
    }));
    return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 6);
  })();

  // Ownership confidence
  const clearTitle = horses.filter((horse) => !blockedIds.has(horse.id)).length;
  const ownershipConfidence = horses.length ? Math.round((clearTitle / horses.length) * 100) : 0;

  const buyerSafe = lanes.ready.length;
  const buyerSafePct = horses.length ? Math.round((buyerSafe / horses.length) * 100) : 0;

  const activity = horses
    .flatMap((horse) => (horse.activity ?? []).map((event) => ({ ...event, horseName: horse.name })))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  const ranch = workspaceProfile.ranchName || workspaceProfile.businessName || 'Ranch operations';

  return (
    <div className="xbx">
      {/* HERO — full-bleed split product surface with integrated intelligence */}
      <section className="xbx-hero xb-reveal">
        <div className="xbx-hero__face">
          <div className="xbx-hero__atmos" aria-hidden="true">
            <svg className="xbx-hero__xmark" viewBox="0 0 200 200" preserveAspectRatio="xMidYMid meet">
              <path d="M40 32 L160 168 M160 32 L40 168" />
            </svg>
            <HorseContour className="xbx-hero__horse" />
          </div>
          <div className="xbx-hero__main">
            <div className="xbx-hero__tagrow">
              <span className="xbx-hero__brandtag">XBAR</span>
              <span className="xbx-hero__eyebrow">Ranch operations · {ranch}</span>
            </div>
            <h1 className="xbx-hero__title">
              {urgencyCount > 0 ? `${urgencyCount} control point${urgencyCount === 1 ? '' : 's'} need a decision today.` : 'Your barn is clear today.'}
            </h1>
            <p className="xbx-hero__lead">
              {urgencyCount > 0
                ? 'These are the horses, documents, and transfers most likely to hold up a sale right now. Clear them — XBAR keeps the proof trail intact.'
                : 'Every horse, document, and transfer is current. Use the clear window to prepare the next buyer-ready packet.'}
            </p>
            <div className="xbx-hero__actions">
              <button type="button" className="xbx-btn xbx-btn--primary" onClick={() => navigate(nextMovePath)}>Open next move</button>
              <Link to="/horses" className="xbx-btn">View the herd</Link>
            </div>
            <div className="xbx-hero__trust">
              <span><strong>{horses.length}</strong> horses managed</span><i />
              <span><strong>{packetReadiness}%</strong> sale ready</span><i />
              <span><strong>{transferGaps.length}</strong> release blockers</span>
            </div>
          </div>
        </div>

        <div className="xbx-hero__intel">
          <div className="xbx-hero__intel-head"><span>Today's sale readiness</span><i className="xbx-live" /></div>
          <div className="xbx-readiness">
            <div className="xbx-score__ring" style={{ '--val': packetReadiness } as CSSProperties}>
              <span className="xbx-score__pct">{packetReadiness}<i>%</i></span>
            </div>
            <div className="xbx-readiness__copy">
              <strong>{lanes.ready.length} of {horses.length}</strong>
              <span>horses buyer-ready</span>
            </div>
          </div>
          <div className="xbx-readbar" aria-hidden="true">
            <span className="xbx-readbar__seg xbx-readbar__seg--ready" style={{ flexGrow: lanes.ready.length || 0.04 } as CSSProperties} />
            <span className="xbx-readbar__seg xbx-readbar__seg--review" style={{ flexGrow: lanes.review.length || 0.04 } as CSSProperties} />
            <span className="xbx-readbar__seg xbx-readbar__seg--blocked" style={{ flexGrow: lanes.blocked.length || 0.04 } as CSSProperties} />
          </div>
          <div className="xbx-readlegend">
            <span><i className="xbx-dot xbx-dot--emerald" />Ready <strong>{lanes.ready.length}</strong></span>
            <span><i className="xbx-dot xbx-dot--amber" />Review <strong>{lanes.review.length}</strong></span>
            <span><i className="xbx-dot xbx-dot--rose" />Blocked <strong>{lanes.blocked.length}</strong></span>
          </div>
          <button type="button" className="xbx-hero__resolve" onClick={() => navigate(nextMovePath)}>
            <span className="xbx-hero__resolve-label">Next decision</span>
            <span className="xbx-hero__resolve-val">{nextMove}</span>
            <span className="xbx-hero__resolve-go">Resolve now →</span>
          </button>
        </div>
      </section>

      {/* EDITORIAL STAGE — asymmetric main column + sticky intelligence rail */}
      <div className="xbx-stage">
        <main className="xbx-stage__main">

          {/* SALE READINESS BOARD */}
          <section className="xbx-section xb-reveal">
            <header className="xbx-section-head">
              <div><div className="xbx-eyebrow">Sale readiness board</div><h2>Where every horse stands.</h2></div>
              <Link to="/horses" className="xbx-link">All horses →</Link>
            </header>
            <div className="xbx-lanes">
              {(['ready', 'review', 'blocked'] as LaneKey[]).map((key) => {
                const meta = laneMeta[key];
                return (
                  <div className={`xbx-lane xbx-lane--${meta.tone}`} key={key}>
                    <div className="xbx-lane__head"><span className={`xbx-dot xbx-dot--${meta.tone}`} />{meta.label}<em>{lanes[key].length}</em></div>
                    <div className="xbx-lane__items">
                      {lanes[key].slice(0, 5).map((horse) => {
                        const packet = commandPackets.find((item) => item.horse.id === horse.id)?.packet;
                        const missing = packet ? packet.saleSlots.filter((slot) => slot.status !== 'ready').length : 0;
                        const isBlocked = blockedIds.has(horse.id);
                        return (
                          <button key={horse.id} type="button" className="xbx-acard" onClick={() => navigate(`/horses/${horse.id}`)}>
                            <span className="xbx-acard__id">{horse.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
                            <span className="xbx-acard__body">
                              <strong>{horse.name}</strong>
                              <span className="xbx-acard__owner">{horse.ownerEntity || horse.owner}</span>
                              <span className="xbx-acard__chips">
                                <i className={`xbx-mchip xbx-mchip--${missing ? 'amber' : 'emerald'}`}>{missing ? `${missing} docs` : 'Docs clear'}</i>
                                <i className={`xbx-mchip xbx-mchip--${isBlocked ? 'rose' : 'emerald'}`}>{isBlocked ? 'Release held' : 'Releasable'}</i>
                              </span>
                            </span>
                            <span className="xbx-acard__score">{Math.round(horse.readiness.score)}<i>%</i></span>
                          </button>
                        );
                      })}
                      {!lanes[key].length ? <p className="xbx-lane__empty">No horses in this lane.</p> : null}
                    </div>
                    <button type="button" className="xbx-lane__action" onClick={() => navigate(meta.path)}>{meta.action} →</button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* PRIORITY ACTIONS INTELLIGENCE */}
          <section className="xbx-section xbx-priority xb-reveal">
            <header className="xbx-section-head"><div><div className="xbx-eyebrow">Priority actions intelligence</div><h2>What to fix first.</h2></div></header>
            {priorityActions.length ? (
              <ol className="xbx-actions">
                {priorityActions.map((item, index) => (
                  <li key={item.key} className={`xbx-pa xbx-pa--${item.tone} xb-reveal`} style={{ '--xb-reveal-index': index } as CSSProperties}>
                    <span className="xbx-pa__rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="xbx-pa__body">
                      <div className="xbx-pa__top">
                        <span className={`xbx-sev xbx-sev--${item.tone}`}>{item.severity}</span>
                        <span className="xbx-pa__horse">{item.horse}</span>
                      </div>
                      <strong className="xbx-pa__problem">{item.problem}</strong>
                      <span className="xbx-pa__detail">{item.detail}</span>
                      <span className="xbx-pa__impact"><i className="xbx-pa__impact-rule" />{item.impact}</span>
                    </div>
                    <button type="button" className="xbx-pa__cta" onClick={() => navigate(item.path)}>{item.action} →</button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="xbx-clear"><strong>Nothing is blocking work.</strong><span>Every horse, document, and transfer is current.</span></div>
            )}
          </section>

          {/* HORSE ASSET TIMELINE */}
          <section className="xbx-section xbx-trail xb-reveal">
            <header className="xbx-section-head"><div><div className="xbx-eyebrow">Horse asset timeline</div><h2>The proof trail.</h2></div></header>
            {activity.length ? (
              <ul className="xbx-timeline">
                {activity.map((event) => (
                  <li key={event.id} className={`xbx-tl xbx-tl--${event.category.toLowerCase()}`}>
                    <span className="xbx-tl__node" />
                    <div className="xbx-tl__body">
                      <div className="xbx-tl__top"><span className="xbx-tl__cat">{event.category}</span><strong>{event.title}</strong><time>{formatDateLabel(event.date)}</time></div>
                      <span className="xbx-tl__meta">{event.horseName}{event.owner ? ` · ${event.owner}` : ''}</span>
                      {event.summary ? <p>{event.summary}</p> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="xbx-clear"><strong>No recorded activity yet.</strong><span>Document uploads, transfers, and care events appear here as a verifiable trail.</span></div>
            )}
          </section>
        </main>

        {/* STICKY INTELLIGENCE RAIL — signature micro-modules */}
        <div className="xbx-irail">
          <section className="xbx-mod xbx-mod--blocker xb-reveal">
            <div className="xbx-mod__head"><span className="xbx-mod__ey">Release blockers</span><span className={`xbx-mod__big ${transferGaps.length ? 'xbx-mod__big--rose' : 'xbx-mod__big--ok'}`}>{transferGaps.length}</span></div>
            <div className="xbx-mod__rows">
              {transferGaps.length ? transferGaps.slice(0, 4).map((gap) => (
                <button key={gap.horseId} type="button" className="xbx-mod__row" onClick={() => navigate('/ownership')}>
                  <span className="xbx-mod__row-main">{gap.horseName}</span>
                  <span className="xbx-mod__row-sub">{gap.reasons[0] ?? `${gap.pendingCount} documents pending`}</span>
                </button>
              )) : <p className="xbx-mod__clear">Titles are clear. Nothing is holding a release.</p>}
            </div>
            {revenueAtRisk ? <div className="xbx-mod__foot"><span className="xbx-dot xbx-dot--rose" />{formatCompactCurrency(revenueAtRisk)} exposed behind blockers</div> : null}
          </section>

          <section className="xbx-mod xbx-mod--docrisk xb-reveal">
            <div className="xbx-mod__head"><span className="xbx-mod__ey">Document risk map</span><span className={`xbx-mod__big ${documentsMissing ? 'xbx-mod__big--amber' : 'xbx-mod__big--ok'}`}>{documentsMissing}</span></div>
            {docRiskMap.length ? (
              <div className="xbx-docmap">
                {docRiskMap.map((entry) => (
                  <button key={entry.label} type="button" className="xbx-docmap__cell" onClick={() => navigate('/documents')}>
                    <span className="xbx-docmap__label">{entry.label}</span>
                    <span className="xbx-docmap__count">{entry.count}</span>
                  </button>
                ))}
              </div>
            ) : <p className="xbx-mod__clear">Every required document is on file.</p>}
          </section>

          <section className="xbx-mod xbx-mod--chain xb-reveal">
            <div className="xbx-mod__head"><span className="xbx-mod__ey">Ownership confidence</span><span className="xbx-mod__big">{ownershipConfidence}<i>%</i></span></div>
            <div className="xbx-chain">
              <div className="xbx-chain__node"><i />Breeder</div>
              <div className="xbx-chain__link" />
              <div className="xbx-chain__node xbx-chain__node--active"><i />Owner</div>
              <div className={`xbx-chain__link ${transferGaps.length ? 'xbx-chain__link--risk' : ''}`} />
              <div className={`xbx-chain__node ${transferGaps.length ? 'xbx-chain__node--risk' : 'xbx-chain__node--active'}`}><i />Transfer</div>
            </div>
            <p className="xbx-mod__note">{clearTitle} of {horses.length} horses hold clear title{transferGaps.length ? ` · ${transferGaps.length} mid-transfer` : ''}.</p>
          </section>

          <section className="xbx-mod xbx-mod--proof xb-reveal">
            <div className="xbx-mod__head"><span className="xbx-mod__ey">Buyer-safe proof</span></div>
            <div className="xbx-proof">
              <div className="xbx-proof__shield" style={{ '--val': buyerSafePct } as CSSProperties}><span>{buyerSafePct}<i>%</i></span></div>
              <div className="xbx-proof__copy"><strong>{buyerSafe} of {horses.length} buyer-safe</strong><span>packets verified end to end</span></div>
            </div>
            <button type="button" className="xbx-mod__cta" onClick={() => navigate('/documents')}>Open packet review →</button>
          </section>
        </div>
      </div>
    </div>
  );
}
