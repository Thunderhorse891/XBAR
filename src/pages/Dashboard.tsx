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

const XBAR_ICON = '/brand/xbar-app-icon.png';

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
            <h1 className="xs-hero__headline">Set up your ranch operating system.</h1>
            <p className="xs-hero__sub">Add your first animal and its papers. XBAR builds sale readiness, documents, ownership proof, and buyer folders around your real records.</p>
            <div className="xs-hero__actions">
              <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add first animal</ActionButton>
              <ActionButton onClick={() => navigate('/documents?upload=1')}>Add document</ActionButton>
              <ActionButton variant="ghost" onClick={() => navigate('/getting-started')}>Getting started</ActionButton>
            </div>
          </div>
        </section>

        <div className="xs-ribbon">
          {[
            { v: 0, l: 'Animals', to: '/animals' },
            { v: 0, l: 'Sale prospects', to: '/sales-pipeline' },
            { v: 0, l: 'Documents', to: '/documents-vault' },
            { v: 0, l: 'Buyer folders', to: '/buyer-deal-room' },
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
              { icon: <HorsesIcon width={20} height={20} />, title: 'Add your first animal', meta: 'Name, sex, status, and location — the record everything hangs off.', to: '/horses?new=1' },
              { icon: <Upload size={20} />, title: 'Add document', meta: 'Coggins, registration, health certificates — OCR intake builds the file.', to: '/documents?upload=1' },
              { icon: <ShieldCheck size={20} />, title: 'Configure the ranch', meta: 'Owner, entity, barn, and team access.', to: '/settings' },
            ].map((s) => (
              <button key={s.title} type="button" className="xs-signal xs-signal--info" onClick={() => navigate(s.to)}>
                <span className="xs-signal__icon">{s.icon}</span>
                <span className="xs-signal__body"><span className="xs-signal__title">{s.title}</span><span className="xs-signal__meta">{s.meta}</span></span>
                <span className="xs-signal__cta"><ArrowRight size={16} className="xs-muted" /></span>
              </button>
            ))}
          </div>

          <div className="xs-intel">
            <div className="xs-intel__head"><Sparkles size={13} /> XBAR Intelligence</div>
            <div className="xs-intel__nba">
              <div className="xs-intel__sec-label" style={{ color: 'var(--xbar-cyan-ink)' }}>Next best action</div>
              <div className="xs-intel__nba-title">Add your first animal</div>
              <div className="xs-intel__nba-reason">Signals, sale readiness, and the work queue populate from your real records.</div>
              <ActionButton variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => navigate('/horses?new=1')}>Add animal</ActionButton>
            </div>
            <div className="xs-intel__sec">
              <div className="xs-intel__sec-label">Quick create</div>
              <div className="xs-intel__qc">
                <ActionButton size="sm" icon={<HorsesIcon width={14} height={14} />} onClick={() => navigate('/horses?new=1')}>Animal</ActionButton>
                <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents?upload=1')}>Document</ActionButton>
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
    signals.push({ key: `t-${g.horseId}`, tone: 'danger', icon: 'shield', title: `Ownership transfer — ${g.horseName}`, meta: g.reasons.slice(0, 2).join(' · '), chip: 'Blocked', to: `/animals/${g.horseId}` }),
  );
  careDue.slice(0, 2).forEach((c) =>
    signals.push({ key: `c-${c.horseId}`, tone: 'warning', icon: 'stethoscope', title: `Care due — ${c.horseName}`, meta: c.signals.filter((s) => s.status !== 'clear').map((s) => s.label).join(' · ') || 'Care attention needed', chip: 'Due', to: `/animals/${c.horseId}` }),
  );
  if (reviewQueue.length) {
    signals.push({ key: 'docs', tone: 'info', icon: 'doc', title: `${reviewQueue.length} document${reviewQueue.length === 1 ? '' : 's'} waiting on review`, meta: reviewQueue.slice(0, 3).map((d) => d.title).join(' · '), chip: 'Review', to: '/documents' });
  }
  if (!signals.length) {
    signals.push({ key: 'clear', tone: 'neutral', icon: 'horse', title: 'Records are clear', meta: 'No transfer gaps, overdue care, or documents waiting on review.', chip: 'Clear', to: '/animals' });
  }

  const primary = signals[0];
  const heroLine = primary.tone === 'danger'
    ? <>Ownership documents are blocking a transfer — <em>{transferGaps.length} to clear</em>.</>
    : primary.tone === 'warning'
      ? <>{careDue.length} animal{careDue.length === 1 ? '' : 's'} need care attention today.</>
      : primary.tone === 'info'
        ? <>{reviewQueue.length} document{reviewQueue.length === 1 ? '' : 's'} are waiting on review.</>
        : <>Everything's clear across {horses.length} animals.</>;

  const workItems = [
    ...transferGaps.map((g) => ({ id: `t-${g.horseId}`, title: `Resolve transfer documents — ${g.horseName}`, chip: 'Ownership', to: `/animals/${g.horseId}` })),
    ...careDue.map((c) => ({ id: `c-${c.horseId}`, title: `Complete care — ${c.horseName}`, chip: 'Health', to: `/animals/${c.horseId}` })),
    ...reviewQueue.map((d) => ({ id: `d-${d.id}`, title: `Review ${d.title}`, chip: 'Documents', to: '/documents' })),
  ].slice(0, 5);

  const iconFor = (k: Signal['icon']) =>
    k === 'coins' ? <Coins size={20} /> : k === 'stethoscope' ? <Stethoscope size={20} /> : k === 'doc' ? <FileWarning size={20} /> : k === 'shield' ? <ShieldCheck size={20} /> : <HorsesIcon width={20} height={20} />;

  const ribbon = [
    { v: horses.length, l: 'Animals', to: '/animals' },
    { v: activeSales.length, l: 'Sale prospects', to: '/sales-pipeline' },
    { v: reviewQueue.length, l: 'Docs to review', to: '/documents-vault', warn: reviewQueue.length > 0 },
    { v: transferGaps.length, l: 'Transfer gaps', to: '/ownership-chain', danger: transferGaps.length > 0 },
    { v: `${readiness}%`, l: 'Readiness', to: '/reports' },
  ];

  return (
    <div className="xs-home">
      <section className="xs-hero">
        <img className="xs-hero__wm" src={XBAR_ICON} alt="" aria-hidden="true" />
        <div className="xs-hero__body">
          <div className="xs-hero__eyebrow"><Sparkles size={13} /> {ranchName} · Operations</div>
          <h1 className="xs-hero__headline">{heroLine}</h1>
          <p className="xs-hero__sub">
            {openItems > 0
              ? `${openItems} control point${openItems === 1 ? '' : 's'} need a decision. Start with the item most likely to block a sale or care.`
              : `All control points are clear. ${activeSales.length} active buyer${activeSales.length === 1 ? '' : 's'} in the pipeline.`}
          </p>
          <div className="xs-hero__actions">
            <ActionButton variant="primary" icon={<ArrowRight size={15} />} onClick={() => navigate(primary.to)}>Open next decision</ActionButton>
            <ActionButton onClick={() => navigate('/animals')}>Animals</ActionButton>
            <ActionButton variant="ghost" onClick={() => navigate('/reports')}>Readiness report</ActionButton>
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
            <span className="xs-sectlabel__title">Needs a decision today</span>
            <button type="button" className="xs-card__link" onClick={() => navigate('/today')}>Open work queue</button>
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
                <span className="xs-sectlabel__title">Today's work</span>
                <button type="button" className="xs-card__link" onClick={() => navigate('/today')}>{workItems.length} open</button>
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
          <div className="xs-intel__head"><Sparkles size={13} /> XBAR Intelligence</div>
          <div className="xs-intel__nba">
            <div className="xs-intel__sec-label" style={{ color: 'var(--xbar-cyan-ink)' }}>Next best action</div>
            <div className="xs-intel__nba-title">{primary.title}</div>
            <div className="xs-intel__nba-reason">{primary.meta}</div>
            <ActionButton variant="primary" size="sm" icon={<ArrowRight size={14} />} onClick={() => navigate(primary.to)}>Resolve now</ActionButton>
          </div>
          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Risk</div>
            <div className="xs-intel__line"><ShieldCheck size={14} /><span>{transferGaps.length} ownership transfer{transferGaps.length === 1 ? '' : 's'} pending</span></div>
            <div className="xs-intel__line"><Stethoscope size={14} /><span>{careDue.length} animal{careDue.length === 1 ? '' : 's'} with care due</span></div>
            <div className="xs-intel__line"><FileWarning size={14} /><span>{reviewQueue.length} document{reviewQueue.length === 1 ? '' : 's'} in the review queue</span></div>
          </div>
          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Revenue</div>
            <div className="xs-intel__line"><Coins size={14} /><span>{activeSales.length} active buyer{activeSales.length === 1 ? '' : 's'} in the pipeline</span></div>
            <div className="xs-intel__line"><CalendarClock size={14} /><span>{formatCompactCurrency(budget.total)} spend this month</span></div>
          </div>
          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Quick create</div>
            <div className="xs-intel__qc">
              <ActionButton size="sm" icon={<Plus size={14} />} onClick={() => navigate('/today')}>Task</ActionButton>
              <ActionButton size="sm" icon={<HorsesIcon width={14} height={14} />} onClick={() => navigate('/horses?new=1')}>Animal</ActionButton>
              <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents?upload=1')}>Document</ActionButton>
              <ActionButton size="sm" icon={<Users size={14} />} onClick={() => navigate('/buyer-deal-room')}>Buyer</ActionButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
