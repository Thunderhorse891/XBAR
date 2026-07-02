import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  CalendarClock,
  Coins,
  FileWarning,
  Plus,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Upload,
  Users,
} from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton } from '@/components/saas';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatCompactCurrency } from '@/lib/format';
import { events, track } from '@/lib/telemetry';
import { useXbarStore } from '@/store/useXbarStore';

const XBAR_ICON = '/brand/icon-512.png';

type Tone = 'danger' | 'warning' | 'info' | 'neutral';
type Signal = { key: string; tone: Tone; title: string; meta: string; chip: string; to: string; icon: 'coins' | 'stethoscope' | 'doc' | 'horse' | 'shield' };

export default function Dashboard() {
  const navigate = useNavigate();
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const ownershipRecords = useXbarStore((s) => s.ownershipRecords);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const salesLeads = useXbarStore((s) => s.salesLeads);
  const workspaceProfile = useXbarStore((s) => s.workspaceProfile);

  const ranchName = workspaceProfile.ranchName || workspaceProfile.businessName || 'Your ranch';
  const isEmpty = horses.length === 0;

  const model = useMemo(() => {
    const reviewQueue = documents.filter((d) => d.state === 'Needs Review' || d.state === 'Matched');
    const transferGaps = buildTransferGapRows(horses, ownershipRecords, documents);
    const careBoard = buildCareBoardRows(horses, documents, expenseReceipts);
    const careDue = careBoard.filter((row) => row.signals.some((sig) => sig.status === 'due'));
    const budget = buildBudgetSummary(expenseReceipts);
    const activeSales = salesLeads.filter((l) => l.stage !== 'Closed');
    const readiness = horses.length
      ? Math.round(horses.reduce((sum, h) => sum + (h.readiness?.score ?? 0), 0) / horses.length)
      : 0;
    const openItems = transferGaps.length + careDue.length + reviewQueue.length;
    return { reviewQueue, transferGaps, careDue, budget, activeSales, readiness, openItems };
  }, [horses, documents, ownershipRecords, expenseReceipts, salesLeads]);

  useEffect(() => {
    track(events.pageView, { surface: 'operations_console', empty: isEmpty, horses: horses.length });
  }, [isEmpty, horses.length]);

  /* -------------------------------------------------- Empty (new workspace) */
  if (isEmpty) {
    return (
      <div className="xs-home">
        <section className="xs-hero">
          <img className="xs-hero__wm" src={XBAR_ICON} alt="" aria-hidden="true" />
          <div className="xs-hero__body">
            <div className="xs-hero__eyebrow"><Sparkles size={13} /> {ranchName} · Getting started</div>
            <h1 className="xs-hero__headline">Get your horse records in order.</h1>
            <p className="xs-hero__sub">Add your first horse and its papers. XBAR keeps your health records, registration, ownership history, and buyer folders in one place — and tells you when a horse is ready to sell.</p>
            <div className="xs-hero__actions">
              <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add first animal</ActionButton>
              <ActionButton onClick={() => navigate('/documents?upload=1')}>Upload documents</ActionButton>
              <ActionButton variant="ghost" onClick={() => navigate('/getting-started')}>Getting started</ActionButton>
            </div>
          </div>
        </section>

        <div className="xs-ribbon">
          {[
            { v: 0, l: 'Animals', to: '/animals' },
            { v: 0, l: 'Sale prospects', to: '/sales-pipeline' },
            { v: 0, l: 'Documents', to: '/documents-vault' },
            { v: 0, l: 'Deal rooms', to: '/buyer-deal-room' },
            { v: '—', l: 'Readiness', to: '/reports' },
          ].map((r) => (
            <button key={r.l} type="button" className="xs-ribbon__item" onClick={() => navigate(r.to)}>
              <span className="xs-ribbon__value">{r.v}</span>
              <span className="xs-ribbon__label">{r.l}</span>
            </button>
          ))}
        </div>

        <div className="xs-homegrid">
          <div>
            <div className="xs-sectlabel"><span className="xs-sectlabel__title">First steps</span></div>
            {[
              { icon: <HorsesIcon width={20} height={20} />, title: 'Add your first horse', meta: 'Name, sex, age, and where it lives — the record everything hangs off.', to: '/horses?new=1' },
              { icon: <Upload size={20} />, title: 'Add paperwork', meta: 'Coggins, registration papers, and health records — we read them and file them for you.', to: '/documents?upload=1' },
              { icon: <ShieldCheck size={20} />, title: 'Set up your ranch', meta: 'Owner, barn, and who else can help.', to: '/settings' },
            ].map((s) => (
              <button key={s.title} type="button" className="xs-signal xs-signal--info" onClick={() => navigate(s.to)}>
                <span className="xs-signal__icon">{s.icon}</span>
                <span className="xs-signal__body"><span className="xs-signal__title">{s.title}</span><span className="xs-signal__meta">{s.meta}</span></span>
                <span className="xs-signal__cta"><ArrowRight size={16} className="xs-muted" /></span>
              </button>
            ))}
          </div>

          <div className="xs-intel">
            <div className="xs-intel__head"><Sparkles size={13} /> Smart Help</div>
            <div className="xs-intel__nba">
              <div className="xs-intel__sec-label" style={{ color: 'var(--xbar-cyan-ink)' }}>Start here</div>
              <div className="xs-intel__nba-title">Add your first horse</div>
              <div className="xs-intel__nba-reason">Your care tasks, paperwork, and sale-ready status all fill in from your own records.</div>
              <ActionButton variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => navigate('/horses?new=1')}>Add horse</ActionButton>
            </div>
            <div className="xs-intel__sec">
              <div className="xs-intel__sec-label">Quick add</div>
              <div className="xs-intel__qc">
                <ActionButton size="sm" icon={<HorsesIcon width={14} height={14} />} onClick={() => navigate('/horses?new=1')}>Horse</ActionButton>
                <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents?upload=1')}>Paperwork</ActionButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------ Populated */
  const { reviewQueue, transferGaps, careDue, budget, activeSales, readiness, openItems } = model;

  const signals: Signal[] = [];
  transferGaps.slice(0, 2).forEach((g) =>
    signals.push({ key: `t-${g.horseId}`, tone: 'danger', icon: 'shield', title: `Ownership paperwork — ${g.horseName}`, meta: g.reasons.slice(0, 2).join(' · '), chip: "Can't sell yet", to: `/animals/${g.horseId}` }),
  );
  careDue.slice(0, 2).forEach((c) =>
    signals.push({ key: `c-${c.horseId}`, tone: 'warning', icon: 'stethoscope', title: `Care due — ${c.horseName}`, meta: c.signals.filter((s) => s.status !== 'clear').map((s) => s.label).join(' · ') || 'Needs care', chip: 'Due', to: `/animals/${c.horseId}` }),
  );
  if (reviewQueue.length) {
    signals.push({ key: 'docs', tone: 'info', icon: 'doc', title: `${reviewQueue.length} piece${reviewQueue.length === 1 ? '' : 's'} of paperwork to check`, meta: reviewQueue.slice(0, 3).map((d) => d.title).join(' · '), chip: 'Check', to: '/documents' });
  }
  if (!signals.length) {
    signals.push({ key: 'clear', tone: 'neutral', icon: 'horse', title: 'Everything looks good', meta: 'No missing paperwork, overdue care, or paperwork waiting to be checked.', chip: 'All set', to: '/animals' });
  }

  const primary = signals[0];
  const heroLine = primary.tone === 'danger'
    ? <>Missing paperwork is holding up a sale — <em>{transferGaps.length} to finish</em>.</>
    : primary.tone === 'warning'
      ? <>{careDue.length} horse{careDue.length === 1 ? '' : 's'} need care today.</>
      : primary.tone === 'info'
        ? <>{reviewQueue.length} piece{reviewQueue.length === 1 ? '' : 's'} of paperwork need checking.</>
        : <>Everything looks good across {horses.length} horses.</>;

  const workItems = [
    ...transferGaps.map((g) => ({ id: `t-${g.horseId}`, title: `Finish ownership paperwork — ${g.horseName}`, chip: 'Paperwork', to: `/animals/${g.horseId}` })),
    ...careDue.map((c) => ({ id: `c-${c.horseId}`, title: `Take care of — ${c.horseName}`, chip: 'Care', to: `/animals/${c.horseId}` })),
    ...reviewQueue.map((d) => ({ id: `d-${d.id}`, title: `Check ${d.title}`, chip: 'Paperwork', to: '/documents' })),
  ].slice(0, 5);

  const iconFor = (k: Signal['icon']) =>
    k === 'coins' ? <Coins size={20} /> : k === 'stethoscope' ? <Stethoscope size={20} /> : k === 'doc' ? <FileWarning size={20} /> : k === 'shield' ? <ShieldCheck size={20} /> : <HorsesIcon width={20} height={20} />;

  const ribbon = [
    { v: horses.length, l: 'Horses', to: '/animals' },
    { v: activeSales.length, l: 'For sale', to: '/sales-pipeline' },
    { v: reviewQueue.length, l: 'Paperwork to check', to: '/documents-vault', warn: reviewQueue.length > 0 },
    { v: transferGaps.length, l: 'Missing paperwork', to: '/ownership-chain', danger: transferGaps.length > 0 },
    { v: `${readiness}%`, l: 'Ready to sell', to: '/reports' },
  ];

  return (
    <div className="xs-home">
      <section className="xs-hero">
        <img className="xs-hero__wm" src={XBAR_ICON} alt="" aria-hidden="true" />
        <div className="xs-hero__body">
          <div className="xs-hero__eyebrow"><Sparkles size={13} /> {ranchName} · Dashboard</div>
          <h1 className="xs-hero__headline">{heroLine}</h1>
          <p className="xs-hero__sub">
            {openItems > 0
              ? `${openItems} thing${openItems === 1 ? '' : 's'} need attention. Start with what's most likely to hold up a sale or a horse's care.`
              : `Nothing needs attention right now. ${activeSales.length} buyer${activeSales.length === 1 ? '' : 's'} in progress.`}
          </p>
          <div className="xs-hero__actions">
            <ActionButton variant="primary" icon={<ArrowRight size={15} />} onClick={() => navigate(primary.to)}>Start here</ActionButton>
            <ActionButton onClick={() => navigate('/animals')}>Horses</ActionButton>
            <ActionButton variant="ghost" onClick={() => navigate('/reports')}>Ready-to-sell report</ActionButton>
          </div>
        </div>
      </section>

      <div className="xs-ribbon">
        {ribbon.map((r) => (
          <button key={r.l} type="button" className="xs-ribbon__item" onClick={() => navigate(r.to)}>
            <span className={`xs-ribbon__value${r.warn ? ' xs-ribbon__value--warn' : ''}${r.danger ? ' xs-ribbon__value--danger' : ''}`}>{r.v}</span>
            <span className="xs-ribbon__label">{r.l}</span>
          </button>
        ))}
      </div>

      <div className="xs-homegrid">
        <div>
          <div className="xs-sectlabel">
            <span className="xs-sectlabel__title">Needs your attention</span>
            <button type="button" className="xs-card__link" onClick={() => navigate('/today')}>See all tasks</button>
          </div>
          {signals.map((s) => (
            <button key={s.key} type="button" className={`xs-signal xs-signal--${s.tone === 'neutral' ? 'info' : s.tone}`} onClick={() => navigate(s.to)}>
              <span className={`xs-signal__icon${s.tone === 'danger' ? ' xs-signal__icon--danger' : s.tone === 'warning' ? ' xs-signal__icon--warning' : ''}`}>{iconFor(s.icon)}</span>
              <span className="xs-signal__body"><span className="xs-signal__title">{s.title}</span><span className="xs-signal__meta">{s.meta}</span></span>
              <span className="xs-signal__cta"><span className={`xs-chip xs-chip--${s.tone === 'danger' ? 'danger' : s.tone === 'warning' ? 'warning' : s.tone === 'info' ? 'info' : 'success'}`}>{s.chip}</span></span>
            </button>
          ))}

          {workItems.length ? (
            <>
              <div className="xs-sectlabel" style={{ marginTop: 26 }}>
                <span className="xs-sectlabel__title">Today's tasks</span>
                <button type="button" className="xs-card__link" onClick={() => navigate('/today')}>{workItems.length} to do</button>
              </div>
              <div className="xs-card" style={{ padding: '6px 18px' }}>
                <div className="xs-workmini">
                  {workItems.map((w) => (
                    <div key={w.id} className="xs-workmini__row" role="button" tabIndex={0} onClick={() => navigate(w.to)} onKeyDown={(e) => e.key === 'Enter' && navigate(w.to)}>
                      <span className="xs-chip xs-chip--neutral">{w.chip}</span>
                      <span className="xs-workmini__title">{w.title}</span>
                      <ArrowRight size={15} className="xs-muted" />
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <div className="xs-intel">
          <div className="xs-intel__head"><Sparkles size={13} /> Smart Help</div>
          <div className="xs-intel__nba">
            <div className="xs-intel__sec-label" style={{ color: 'var(--xbar-cyan-ink)' }}>Start here</div>
            <div className="xs-intel__nba-title">{primary.title}</div>
            <div className="xs-intel__nba-reason">{primary.meta}</div>
            <ActionButton variant="primary" size="sm" icon={<ArrowRight size={14} />} onClick={() => navigate(primary.to)}>Take care of it</ActionButton>
          </div>
          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Paperwork &amp; care</div>
            <div className="xs-intel__line"><ShieldCheck size={14} /><span>{transferGaps.length} horse{transferGaps.length === 1 ? '' : 's'} with missing ownership paperwork</span></div>
            <div className="xs-intel__line"><Stethoscope size={14} /><span>{careDue.length} horse{careDue.length === 1 ? '' : 's'} with care due</span></div>
            <div className="xs-intel__line"><FileWarning size={14} /><span>{reviewQueue.length} piece{reviewQueue.length === 1 ? '' : 's'} of paperwork to check</span></div>
          </div>
          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Selling &amp; costs</div>
            <div className="xs-intel__line"><Coins size={14} /><span>{activeSales.length} buyer{activeSales.length === 1 ? '' : 's'} in progress</span></div>
            <div className="xs-intel__line"><CalendarClock size={14} /><span>{formatCompactCurrency(budget.total)} spent this month</span></div>
          </div>
          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Quick add</div>
            <div className="xs-intel__qc">
              <ActionButton size="sm" icon={<Plus size={14} />} onClick={() => navigate('/today')}>Task</ActionButton>
              <ActionButton size="sm" icon={<HorsesIcon width={14} height={14} />} onClick={() => navigate('/horses?new=1')}>Horse</ActionButton>
              <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents?upload=1')}>Paperwork</ActionButton>
              <ActionButton size="sm" icon={<Users size={14} />} onClick={() => navigate('/buyer-deal-room')}>Buyer</ActionButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
