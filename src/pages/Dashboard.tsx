import { type CSSProperties, useEffect, useRef, useState } from 'react';
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

  const [period, setPeriod] = useState('This week');
  const [periodOpen, setPeriodOpen] = useState(false);
  const periodRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!periodOpen) return;
    const onDoc = (event: MouseEvent) => {
      if (periodRef.current && !periodRef.current.contains(event.target as Node)) setPeriodOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setPeriodOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [periodOpen]);

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

  const laneOfHorse = new Map<string, LaneKey>();
  (['ready', 'review', 'blocked'] as LaneKey[]).forEach((key) => lanes[key].forEach((horse) => laneOfHorse.set(horse.id, key)));
  const statementDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="xbs">
      {/* MASTHEAD */}
      <header className="xbs-mast">
        <div className="xbs-mast__brand">
          <span className="xbs-mast__mark"><XbarMark tone="mono" /></span>
          <div className="xbs-mast__id">
            <span className="xbs-mast__word">XBAR</span>
            <span className="xbs-mast__ranch">{ranch}</span>
          </div>
        </div>
        <div className="xbs-mast__doc">
          <div className="xbs-mast__title">Statement of Sale Readiness</div>
          <div className="xbs-mast__period" ref={periodRef}>
            <span className="xbs-mast__asof">As of {statementDate} ·</span>
            <button type="button" className="xbs-drop__btn" aria-haspopup="listbox" aria-expanded={periodOpen} onClick={() => setPeriodOpen((open) => !open)}>
              {period}
              <svg className="xbs-drop__chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            {periodOpen ? (
              <div className="xbs-drop__menu" role="listbox">
                {['This week', 'This month', 'This quarter', 'Year to date'].map((option) => (
                  <button key={option} type="button" role="option" aria-selected={option === period} className={`xbs-drop__opt${option === period ? ' is-on' : ''}`} onClick={() => { setPeriod(option); setPeriodOpen(false); }}>
                    <span>{option}</span>
                    {option === period ? <svg viewBox="0 0 14 14" aria-hidden="true" className="xbs-drop__check"><path d="M2.5 7.5 6 11l5.5-7" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* SUMMARY FIGURES */}
      <section className="xbs-summary">
        <div className="xbs-fig">
          <span className="xbs-fig__label">Portfolio readiness</span>
          <span className="xbs-fig__val">{packetReadiness}<i>%</i></span>
          <span className="xbs-fig__sub">{lanes.ready.length} of {horses.length} assets buyer-ready</span>
        </div>
        <div className="xbs-fig xbs-fig--divide">
          <span className="xbs-fig__label">Release blockers</span>
          <span className={`xbs-fig__val${transferGaps.length ? ' xbs-fig__val--rose' : ''}`}>{transferGaps.length}</span>
          <span className="xbs-fig__sub">{transferGaps.length ? 'assets cannot transfer yet' : 'titles are clear to release'}</span>
        </div>
        <div className="xbs-fig xbs-fig--divide">
          <span className="xbs-fig__label">Capital exposed</span>
          <span className="xbs-fig__val">{formatCompactCurrency(revenueAtRisk)}</span>
          <span className="xbs-fig__sub">behind unresolved blockers</span>
        </div>
        <div className="xbs-fig xbs-fig--divide">
          <span className="xbs-fig__label">Documents outstanding</span>
          <span className={`xbs-fig__val${documentsMissing ? ' xbs-fig__val--amber' : ''}`}>{documentsMissing}</span>
          <span className="xbs-fig__sub">across active sale packets</span>
        </div>
      </section>

      {/* ADVISORY */}
      <section className="xbs-advisory">
        <span className="xbs-kicker">Advisory</span>
        <p className="xbs-advisory__lead">{headline}</p>
        <p className="xbs-advisory__body">
          {urgencyCount > 0
            ? `${transferGaps.length ? `${transferGaps.length} ${transferGaps.length === 1 ? 'asset is' : 'assets are'} blocked from transfer because required proof is missing — until that clears, no sale can close` : reviewQueue.length ? `${reviewQueue.length} document${reviewQueue.length === 1 ? '' : 's'} are waiting for review before the packet is buyer-safe` : `${careDueCount} care hold${careDueCount === 1 ? '' : 's'} are due and should be cleared before listing`}. We recommend resolving the highest-exposure item first.`
            : 'Documents, ownership, and care are current across the portfolio. This is the window to prepare the next buyer-ready packet.'}
        </p>
        <button type="button" className="xbs-advisory__cta" onClick={() => navigate(nextMovePath)}>{nextMove} <span aria-hidden="true">→</span></button>
      </section>

      {/* HOLDINGS LEDGER */}
      <section className="xbs-sec">
        <div className="xbs-sec__head"><h2>Holdings</h2><span className="xbs-sec__meta">{horses.length} {horses.length === 1 ? 'asset' : 'assets'} under management</span></div>
        <div className="xbs-ledger" role="table">
          <div className="xbs-ledger__hr" role="row">
            <span role="columnheader">Asset</span>
            <span role="columnheader">Owner of record</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Outstanding</span>
            <span role="columnheader" className="xbs-ta-r">Readiness</span>
          </div>
          {horses.map((horse) => {
            const x = enrichHorse(horse);
            const lane = laneOfHorse.get(horse.id) ?? 'review';
            const meta = laneMeta[lane];
            const gap = transferGaps.find((row) => row.horseId === horse.id);
            const outstanding = gap ? (gap.reasons[0] ?? `${gap.pendingCount} documents pending`) : x.missing ? `${x.missing} document${x.missing === 1 ? '' : 's'} outstanding` : 'None';
            return (
              <button key={horse.id} type="button" className="xbs-ledger__row" role="row" onClick={() => navigate(`/horses/${horse.id}`)}>
                <span className="xbs-cell xbs-cell--asset"><strong>{horse.name}</strong><i>{horse.location.barn}</i></span>
                <span className="xbs-cell xbs-cell--mut">{x.entity}</span>
                <span className="xbs-cell"><span className={`xbs-stat xbs-stat--${meta.tone}`}><i />{meta.label}</span></span>
                <span className={`xbs-cell xbs-cell--out${outstanding === 'None' ? ' xbs-cell--mut' : ''}`}>{outstanding}</span>
                <span className="xbs-cell xbs-cell--ready">
                  <span className="xbs-track"><i style={{ width: `${x.score}%` }} className={`xbs-track__fill xbs-track__fill--${meta.tone}`} /></span>
                  <b>{x.score}%</b>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* SCHEDULES — document risk + ownership chain */}
      <section className="xbs-cols">
        <div className="xbs-sec">
          <div className="xbs-sec__head"><h2>Document risk schedule</h2><span className="xbs-sec__meta">{documentsMissing} outstanding</span></div>
          {docRiskMap.length ? (
            <div className="xbs-rows">
              {docRiskMap.map((entry) => (
                <button key={entry.label} type="button" className="xbs-line" onClick={() => navigate('/documents')}>
                  <span className="xbs-line__a">{entry.label}</span>
                  <span className="xbs-line__lead" aria-hidden="true" />
                  <span className="xbs-line__b">{entry.count}</span>
                </button>
              ))}
            </div>
          ) : <p className="xbs-empty">Every required document is on file.</p>}
        </div>
        <div className="xbs-sec">
          <div className="xbs-sec__head"><h2>Ownership chain</h2><span className="xbs-sec__meta">{ownershipConfidence}% confidence</span></div>
          <div className="xbs-chain">
            <div className="xbs-chain__n xbs-chain__n--on"><i />Breeder</div>
            <div className="xbs-chain__l" />
            <div className="xbs-chain__n xbs-chain__n--on"><i />Owner of record</div>
            <div className={`xbs-chain__l${transferGaps.length ? ' xbs-chain__l--risk' : ''}`} />
            <div className={`xbs-chain__n ${transferGaps.length ? 'xbs-chain__n--risk' : 'xbs-chain__n--on'}`}><i />Buyer / transfer</div>
          </div>
          <p className="xbs-note">{clearTitle} of {horses.length} assets hold clear, transfer-ready title{transferGaps.length ? `; ${transferGaps.length} ${transferGaps.length === 1 ? 'is' : 'are'} mid-transfer and awaiting proof.` : '.'}</p>
        </div>
      </section>

      {/* RECORDED ACTIVITY */}
      <section className="xbs-sec">
        <div className="xbs-sec__head"><h2>Recorded activity</h2><span className="xbs-sec__meta">audit-grade proof trail</span></div>
        {activity.length ? (
          <div className="xbs-rows">
            {activity.map((event) => (
              <div key={event.id} className="xbs-act">
                <time className="xbs-act__date">{formatDateLabel(event.date)}</time>
                <span className={`xbs-act__cat xbs-act__cat--${event.category.toLowerCase()}`}>{event.category}</span>
                <span className="xbs-act__title">{event.title}</span>
                <span className="xbs-act__asset">{event.horseName}</span>
              </div>
            ))}
          </div>
        ) : <p className="xbs-empty">No recorded activity yet.</p>}
      </section>

      <footer className="xbs-foot">
        <span>Prepared by XBAR — sale-readiness intelligence</span>
        <span>Every figure traces to a source document · {statementDate}</span>
      </footer>
    </div>
  );
}
