import { type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';

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
  const roleWorkspace = useCurrentRoleWorkspace();

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
  const offersOut = salesLeads.filter((lead) => lead.stage === 'Offer').length;

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

  const kpis: { label: string; value: string; hint: string; tone: Tone; path: string }[] = [
    { label: 'Sale ready', value: String(lanes.ready.length), hint: `of ${horses.length} assets`, tone: 'emerald', path: '/horses' },
    { label: 'Needs review', value: String(reviewQueue.length), hint: 'documents', tone: reviewQueue.length ? 'amber' : 'slate', path: '/documents' },
    { label: 'Blocked', value: String(lanes.blocked.length), hint: 'release holds', tone: lanes.blocked.length ? 'rose' : 'slate', path: '/ownership' },
    { label: 'Revenue at risk', value: formatCompactCurrency(revenueAtRisk), hint: `${openDeals.length} open deals`, tone: revenueAtRisk ? 'rose' : 'slate', path: '/sales' },
    { label: 'Documents missing', value: String(documentsMissing), hint: 'across packets', tone: documentsMissing ? 'amber' : 'emerald', path: '/documents' },
  ];

  const priorityActions: { key: string; tone: Tone; label: string; reason: string; action: string; path: string }[] = [
    ...transferGaps.map((gap) => ({ key: `tg-${gap.horseId}`, tone: 'rose' as Tone, label: `Resolve transfer blockers · ${gap.horseName}`, reason: gap.reasons.slice(0, 2).join(' · ') || `${gap.pendingCount} documents pending`, action: 'Ownership', path: '/ownership' })),
    ...careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).map((row) => ({ key: `care-${row.horseId}`, tone: 'amber' as Tone, label: `Clear care holds · ${row.horseName}`, reason: row.signals.filter((signal) => signal.status !== 'clear').slice(0, 2).map((signal) => signal.label).join(' · ') || 'Care due', action: 'Health', path: '/medical' })),
    ...reviewQueue.slice(0, 3).map((document) => ({ key: `doc-${document.id}`, tone: 'blue' as Tone, label: `Review ${document.title}`, reason: `${document.type} · waiting in queue`, action: 'Documents', path: '/documents' })),
  ].slice(0, 5);

  const activity = horses
    .flatMap((horse) => (horse.activity ?? []).map((event) => ({ ...event, horseName: horse.name })))
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, 6);

  const ranch = workspaceProfile.ranchName || workspaceProfile.businessName || 'Ranch operations';

  return (
    <div className="xbx">
      {/* HERO FOCAL MODULE */}
      <section className="xbx-hero xb-reveal">
        <div className="xbx-hero__main">
          <div className="xbx-eyebrow">{ranch} · {roleWorkspace.label}</div>
          <h1 className="xbx-hero__title">
            {urgencyCount > 0 ? `${urgencyCount} control point${urgencyCount === 1 ? '' : 's'} need a decision.` : 'Your barn is clear.'}
          </h1>
          <p className="xbx-hero__lead">
            {urgencyCount > 0
              ? 'Start with the items most likely to block a sale or hold up a transfer. XBAR keeps the proof trail intact while you clear them.'
              : 'Use the clear window to strengthen buyer readiness, refresh documents, and prepare the next sale packet.'}
          </p>
          <div className="xbx-hero__actions">
            <button type="button" className="xbx-btn xbx-btn--primary" onClick={() => navigate(nextMovePath)}>Open next move</button>
            <Link to="/horses" className="xbx-btn">View horses</Link>
          </div>
        </div>
        <aside className="xbx-focus">
          <div className="xbx-focus__label">Next decision</div>
          <div className="xbx-focus__headline">{nextMove}</div>
          <ul className="xbx-focus__points">
            <li><span className={`xbx-dot xbx-dot--${transferGaps.length ? 'rose' : 'emerald'}`} />{transferGaps.length} title &amp; transfer holds</li>
            <li><span className={`xbx-dot xbx-dot--${careDueCount ? 'amber' : 'emerald'}`} />{careDueCount} care holds due</li>
            <li><span className={`xbx-dot xbx-dot--${reviewQueue.length ? 'amber' : 'emerald'}`} />{reviewQueue.length} documents in review</li>
          </ul>
          <button type="button" className="xbx-focus__cta" onClick={() => navigate(nextMovePath)}>Resolve now →</button>
        </aside>
      </section>

      {/* KPI STRIP */}
      <section className="xbx-kpis xb-reveal">
        {kpis.map((kpi, index) => (
          <button key={kpi.label} type="button" className={`xbx-kpi xbx-kpi--${kpi.tone}`} style={{ '--xb-reveal-index': index } as CSSProperties} onClick={() => navigate(kpi.path)}>
            <span className="xbx-kpi__label">{kpi.label}</span>
            <span className="xbx-kpi__value">{kpi.value}</span>
            <span className="xbx-kpi__hint">{kpi.hint}</span>
          </button>
        ))}
      </section>

      {/* SALE READINESS RAIL */}
      <section className="xbx-rail xb-reveal">
        <header className="xbx-section-head">
          <div><div className="xbx-eyebrow">Sale readiness</div><h2>Where every horse stands.</h2></div>
          <Link to="/horses" className="xbx-link">All horses →</Link>
        </header>
        <div className="xbx-lanes">
          {([['ready', 'Ready', 'emerald'], ['review', 'Needs review', 'amber'], ['blocked', 'Blocked', 'rose']] as [LaneKey, string, Tone][]).map(([key, label, tone]) => (
            <div className={`xbx-lane xbx-lane--${tone}`} key={key}>
              <div className="xbx-lane__head"><span className={`xbx-dot xbx-dot--${tone}`} />{label}<em>{lanes[key].length}</em></div>
              <div className="xbx-lane__items">
                {lanes[key].slice(0, 6).map((horse) => (
                  <button key={horse.id} type="button" className="xbx-asset-chip" onClick={() => navigate(`/horses/${horse.id}`)}>
                    <strong>{horse.name}</strong>
                    <span>{horse.location.barn} · {Math.round(horse.readiness.score)}%</span>
                  </button>
                ))}
                {!lanes[key].length ? <p className="xbx-lane__empty">None</p> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* BOARD: priority actions + intelligence */}
      <section className="xbx-board">
        <div className="xbx-priority xb-reveal">
          <header className="xbx-section-head"><div><div className="xbx-eyebrow">Priority actions</div><h2>What to fix first.</h2></div></header>
          {priorityActions.length ? (
            <ol className="xbx-actions">
              {priorityActions.map((item, index) => (
                <li key={item.key} className="xbx-action xb-reveal" style={{ '--xb-reveal-index': index } as CSSProperties}>
                  <span className="xbx-action__rank">{String(index + 1).padStart(2, '0')}</span>
                  <span className={`xbx-action__bar xbx-action__bar--${item.tone}`} />
                  <div className="xbx-action__body"><strong>{item.label}</strong><span>{item.reason}</span></div>
                  <button type="button" className="xbx-action__cta" onClick={() => navigate(item.path)}>{item.action} →</button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="xbx-clear"><strong>Nothing is blocking work.</strong><span>Every horse, document, and transfer is current.</span></div>
          )}
        </div>

        <aside className="xbx-intel xb-reveal">
          <div className="xbx-intel__head"><div className="xbx-eyebrow">Intelligence</div></div>
          <div className="xbx-intel__block">
            <span className="xbx-intel__label">Buyer deals</span>
            <strong className="xbx-intel__value">{openDeals.length} open</strong>
            <span className="xbx-intel__meta">{offersOut} at offer · {formatCompactCurrency(revenueAtRisk)} exposed</span>
          </div>
          <div className="xbx-intel__block">
            <span className="xbx-intel__label">Document risk</span>
            <strong className="xbx-intel__value">{documentsMissing} missing</strong>
            <span className="xbx-intel__meta">{reviewQueue.length} awaiting review</span>
          </div>
          <div className="xbx-intel__block">
            <span className="xbx-intel__label">Release blockers</span>
            <strong className="xbx-intel__value">{transferGaps.length}</strong>
            <span className="xbx-intel__meta">title &amp; transfer</span>
          </div>
          <div className="xbx-intel__block xbx-intel__block--meter">
            <span className="xbx-intel__label">Packet readiness</span>
            <strong className="xbx-intel__value">{packetReadiness}%</strong>
            <div className="xbx-meter"><i style={{ width: `${packetReadiness}%` }} /></div>
          </div>
        </aside>
      </section>

      {/* ACTIVITY TRAIL */}
      <section className="xbx-trail xb-reveal">
        <header className="xbx-section-head"><div><div className="xbx-eyebrow">Recent asset activity</div><h2>The proof trail.</h2></div></header>
        {activity.length ? (
          <ul className="xbx-timeline">
            {activity.map((event) => (
              <li key={event.id} className="xbx-tl">
                <span className="xbx-tl__node" />
                <div className="xbx-tl__body">
                  <div className="xbx-tl__top"><strong>{event.title}</strong><time>{formatDateLabel(event.date)}</time></div>
                  <span className="xbx-tl__meta">{event.horseName} · {event.category}{event.owner ? ` · ${event.owner}` : ''}</span>
                  {event.summary ? <p>{event.summary}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="xbx-clear"><strong>No recorded activity yet.</strong><span>Document uploads, transfers, and care events appear here as a verifiable trail.</span></div>
        )}
      </section>
    </div>
  );
}
