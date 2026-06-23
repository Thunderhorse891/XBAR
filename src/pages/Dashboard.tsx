import { type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { useXbarStore } from '@/store/useXbarStore';
import '@/styles/xbarFlagship.css';

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

  const dealByHorse = new Map(salesLeads.map((lead) => [lead.horseId, lead] as const));
  const packetByHorse = new Map(commandPackets.map((item) => [item.horse.id, item.packet] as const));
  const enrichHorse = (horse: (typeof horses)[number]) => {
    const packet = packetByHorse.get(horse.id);
    const missing = packet ? packet.saleSlots.filter((slot) => slot.status !== 'ready').length : 0;
    const deal = dealByHorse.get(horse.id);
    const lastEvent = [...(horse.activity ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return {
      missing,
      buyerStage: deal?.stage ?? null,
      isBlocked: blockedIds.has(horse.id),
      release: blockedIds.has(horse.id) ? 'Release held' : 'Releasable',
      lastProof: lastEvent?.title ?? 'No recorded events',
      lastProofCat: lastEvent?.category ?? '',
      lastProofDate: lastEvent ? formatDateLabel(lastEvent.date) : '',
      score: Math.round(horse.readiness.score),
      monogram: horse.name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase(),
      entity: horse.ownerEntity || horse.owner,
    };
  };

  const headline = urgencyCount > 0 ? `${urgencyCount} decision${urgencyCount === 1 ? '' : 's'} protect your sale today.` : 'Every horse is sale-ready today.';

  return (
    <div className="xbf">
      {/* ============ OPENING SURFACE — full-bleed editorial, flat ============ */}
      <header className="xbf-open xbf-reveal">
        <div className="xbf-open__atmos" aria-hidden="true">
          <svg className="xbf-open__x" viewBox="0 0 240 240" preserveAspectRatio="xMidYMid meet"><path d="M44 36 L196 204 M196 36 L44 204" /></svg>
          <HorseContour className="xbf-open__horse" />
        </div>
        <div className="xbf-open__inner">
          <div className="xbf-open__brandline">
            <span className="xbf-open__mark"><XbarMark tone="mono" /></span>
            <span className="xbf-open__brand">XBAR</span>
            <span className="xbf-open__sep" />
            <span className="xbf-open__kicker">Sale-readiness operating surface — {ranch}</span>
          </div>
          <div className="xbf-open__grid">
            <div className="xbf-open__lead">
              <h1 className="xbf-open__title">{headline}</h1>
              <p className="xbf-open__sub">
                {urgencyCount > 0
                  ? 'XBAR ranks the horses, documents, and transfers most likely to hold up a sale — and keeps an audit-grade proof trail as you clear them.'
                  : 'Documents, ownership, and care are current across the herd. Stage the next buyer packet while the window is clear.'}
              </p>
              <div className="xbf-open__cta">
                <button type="button" className="xbf-btn xbf-btn--primary" title={nextMove} onClick={() => navigate(nextMovePath)}>Open next move</button>
                <Link to="/horses" className="xbf-btn">View the herd</Link>
              </div>
            </div>
            <div className="xbf-open__score">
              <div className="xbf-ring" style={{ '--val': packetReadiness } as CSSProperties}><span>{packetReadiness}<i>%</i></span></div>
              <div className="xbf-open__score-copy">
                <span className="xbf-open__score-label">Today's sale readiness</span>
                <strong>{lanes.ready.length} of {horses.length} buyer-ready</strong>
                <div className="xbf-open__segbar" aria-hidden="true">
                  <span className="xbf-seg xbf-seg--ready" style={{ flexGrow: lanes.ready.length || 0.05 } as CSSProperties} />
                  <span className="xbf-seg xbf-seg--review" style={{ flexGrow: lanes.review.length || 0.05 } as CSSProperties} />
                  <span className="xbf-seg xbf-seg--blocked" style={{ flexGrow: lanes.blocked.length || 0.05 } as CSSProperties} />
                </div>
              </div>
            </div>
          </div>
          <div className="xbf-open__ribbon">
            <button type="button" className="xbf-stat" onClick={() => navigate('/horses')}><span>Buyer-ready</span><strong>{lanes.ready.length}<i>/{horses.length}</i></strong></button>
            <button type="button" className="xbf-stat" onClick={() => navigate('/ownership')}><span>Release blockers</span><strong className={transferGaps.length ? 'xbf-rose' : ''}>{transferGaps.length}</strong></button>
            <button type="button" className="xbf-stat" onClick={() => navigate('/documents')}><span>Documents missing</span><strong className={documentsMissing ? 'xbf-amber' : ''}>{documentsMissing}</strong></button>
            <button type="button" className="xbf-stat" onClick={() => navigate('/ownership')}><span>Ownership confidence</span><strong>{ownershipConfidence}<i>%</i></strong></button>
            <button type="button" className="xbf-stat" onClick={() => navigate('/sales')}><span>Open deals</span><strong>{openDeals.length}</strong></button>
          </div>
        </div>
      </header>

      {/* ============ SPLIT OPERATIONAL LAYOUT ============ */}
      <div className="xbf-split">
        <main className="xbf-main">
          {/* SALE READINESS BOARD — horizontal lane bands */}
          <section className="xbf-block xbf-reveal">
            <div className="xbf-block__head">
              <div><span className="xbf-ey">Sale readiness board</span><h2>Where every horse stands.</h2></div>
              <Link to="/horses" className="xbf-link">All horses →</Link>
            </div>
            <div className="xbf-lanes">
              {(['ready', 'review', 'blocked'] as LaneKey[]).map((key) => {
                const meta = laneMeta[key];
                return (
                  <section className={`xbf-lane xbf-lane--${meta.tone}`} key={key}>
                    <div className="xbf-lane__rail">
                      <span className={`xbf-dot xbf-dot--${meta.tone}`} />
                      <span className="xbf-lane__label">{meta.label}</span>
                      <em>{lanes[key].length}</em>
                      <button type="button" className="xbf-lane__act" onClick={() => navigate(meta.path)}>{meta.action} →</button>
                    </div>
                    <div className="xbf-lane__cards">
                      {lanes[key].length ? lanes[key].slice(0, 6).map((horse) => {
                        const x = enrichHorse(horse);
                        return (
                          <article key={horse.id} className="xbf-hcard" role="button" tabIndex={0} onClick={() => navigate(`/horses/${horse.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/horses/${horse.id}`); }}>
                            <header className="xbf-hcard__head">
                              <span className="xbf-hcard__mono">{x.monogram}</span>
                              <div className="xbf-hcard__id"><strong>{horse.name}</strong><span>{x.entity}</span></div>
                              <span className="xbf-hcard__score">{x.score}<i>%</i></span>
                            </header>
                            <div className="xbf-hcard__states">
                              <span className={`xbf-tag xbf-tag--${x.missing ? 'amber' : 'emerald'}`}>{x.missing ? `${x.missing} docs missing` : 'Docs complete'}</span>
                              <span className={`xbf-tag xbf-tag--${x.isBlocked ? 'rose' : 'emerald'}`}>{x.release}</span>
                              <span className={`xbf-tag xbf-tag--${x.buyerStage ? 'blue' : 'slate'}`}>{x.buyerStage ? `Buyer: ${x.buyerStage}` : 'No active buyer'}</span>
                            </div>
                            <footer className="xbf-hcard__foot">
                              <span className="xbf-hcard__proof">{x.lastProofCat ? <i className={`xbf-pdot xbf-pdot--${x.lastProofCat.toLowerCase()}`} /> : null}{x.lastProof}{x.lastProofDate ? ` · ${x.lastProofDate}` : ''}</span>
                              <span className="xbf-hcard__open">Open →</span>
                            </footer>
                          </article>
                        );
                      }) : <p className="xbf-lane__empty">No horses in this lane.</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </section>

          {/* PRIORITY ACTIONS INTELLIGENCE */}
          <section className="xbf-block xbf-reveal">
            <div className="xbf-block__head"><div><span className="xbf-ey">Priority actions intelligence</span><h2>What protects money today.</h2></div></div>
            {priorityActions.length ? (
              <ol className="xbf-pa">
                {priorityActions.map((item, index) => (
                  <li key={item.key} className={`xbf-pa__item xbf-pa__item--${item.tone} xbf-reveal`} style={{ '--xbf-i': index } as CSSProperties}>
                    <span className="xbf-pa__rank">{String(index + 1).padStart(2, '0')}</span>
                    <div className="xbf-pa__body">
                      <div className="xbf-pa__top"><span className={`xbf-sev xbf-sev--${item.tone}`}>{item.severity}</span><span className="xbf-pa__horse">{item.horse}</span></div>
                      <strong className="xbf-pa__problem">{item.problem}</strong>
                      <span className="xbf-pa__detail">{item.detail}</span>
                      <span className="xbf-pa__impact"><i />{item.impact}</span>
                    </div>
                    <button type="button" className="xbf-pa__cta" onClick={() => navigate(item.path)}>{item.action} →</button>
                  </li>
                ))}
              </ol>
            ) : <div className="xbf-clear"><strong>Nothing is blocking a sale.</strong><span>Every horse, document, and transfer is current.</span></div>}
          </section>
        </main>

        {/* ============ GRAPHITE INTELLIGENCE RAIL ============ */}
        <aside className="xbf-rail">
          <div className="xbf-rail__title">Intelligence</div>

          <section className="xbf-imod xbf-imod--blocker xbf-reveal">
            <div className="xbf-imod__head"><span className="xbf-imod__ey">Release blockers</span><span className={`xbf-imod__n ${transferGaps.length ? 'xbf-rose' : 'xbf-ok'}`}>{transferGaps.length}</span></div>
            <div className="xbf-imod__rows">
              {transferGaps.length ? transferGaps.slice(0, 4).map((gap) => (
                <button key={gap.horseId} type="button" className="xbf-irow" onClick={() => navigate('/ownership')}>
                  <span className="xbf-irow__a">{gap.horseName}</span>
                  <span className="xbf-irow__b">{gap.reasons[0] ?? `${gap.pendingCount} documents pending`}</span>
                </button>
              )) : <p className="xbf-imod__clear">Titles are clear. Nothing is holding a release.</p>}
            </div>
            {revenueAtRisk ? <div className="xbf-imod__foot"><span className="xbf-dot xbf-dot--rose" />{formatCompactCurrency(revenueAtRisk)} exposed behind blockers</div> : null}
          </section>

          <section className="xbf-imod xbf-imod--doc xbf-reveal">
            <div className="xbf-imod__head"><span className="xbf-imod__ey">Document risk map</span><span className={`xbf-imod__n ${documentsMissing ? 'xbf-amber' : 'xbf-ok'}`}>{documentsMissing}</span></div>
            {docRiskMap.length ? (
              <div className="xbf-docmap">
                {docRiskMap.map((entry) => (
                  <button key={entry.label} type="button" className="xbf-docmap__c" onClick={() => navigate('/documents')}><span>{entry.label}</span><strong>{entry.count}</strong></button>
                ))}
              </div>
            ) : <p className="xbf-imod__clear">Every required document is on file.</p>}
          </section>

          <section className="xbf-imod xbf-imod--packet xbf-reveal">
            <div className="xbf-imod__head"><span className="xbf-imod__ey">Buyer packet status</span></div>
            <div className="xbf-packet">
              <div className="xbf-ring xbf-ring--dark" style={{ '--val': buyerSafePct } as CSSProperties}><span>{buyerSafePct}<i>%</i></span></div>
              <div className="xbf-packet__copy"><strong>{buyerSafe} of {horses.length} buyer-safe</strong><span>{Math.max(horses.length - buyerSafe, 0)} packets still need proof</span></div>
            </div>
            <button type="button" className="xbf-imod__cta" onClick={() => navigate('/documents')}>Open packet review →</button>
          </section>

          <section className="xbf-imod xbf-imod--chain xbf-reveal">
            <div className="xbf-imod__head"><span className="xbf-imod__ey">Ownership confidence</span><span className="xbf-imod__n">{ownershipConfidence}<i>%</i></span></div>
            <div className="xbf-chain">
              <div className="xbf-chain__n xbf-chain__n--on"><i />Breeder</div>
              <div className="xbf-chain__l" />
              <div className="xbf-chain__n xbf-chain__n--on"><i />Owner</div>
              <div className={`xbf-chain__l ${transferGaps.length ? 'xbf-chain__l--risk' : ''}`} />
              <div className={`xbf-chain__n ${transferGaps.length ? 'xbf-chain__n--risk' : 'xbf-chain__n--on'}`}><i />Transfer</div>
            </div>
            <p className="xbf-imod__note">{clearTitle} of {horses.length} hold clear title{transferGaps.length ? ` · ${transferGaps.length} mid-transfer` : ''}.</p>
          </section>
        </aside>
      </div>

      {/* ============ ASSET TIMELINE ============ */}
      <section className="xbf-block xbf-reveal">
        <div className="xbf-block__head"><div><span className="xbf-ey">Horse asset timeline</span><h2>The proof trail.</h2></div></div>
        {activity.length ? (
          <ul className="xbf-tl">
            {activity.map((event) => (
              <li key={event.id} className={`xbf-tl__i xbf-tl__i--${event.category.toLowerCase()}`}>
                <span className="xbf-tl__node" />
                <div className="xbf-tl__body">
                  <div className="xbf-tl__top"><span className="xbf-tl__cat">{event.category}</span><strong>{event.title}</strong><time>{formatDateLabel(event.date)}</time></div>
                  <span className="xbf-tl__meta">{event.horseName}{event.owner ? ` · ${event.owner}` : ''}</span>
                  {event.summary ? <p>{event.summary}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <div className="xbf-clear"><strong>No recorded activity yet.</strong><span>Document uploads, transfers, and care events appear here as a verifiable trail.</span></div>}
      </section>
    </div>
  );
}
