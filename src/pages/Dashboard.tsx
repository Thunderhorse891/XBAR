import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Coins,
  FileWarning,
  Plus,
  Sparkles,
  Stethoscope,
  Upload,
  Users,
} from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton, StatusChip } from '@/components/saas';
import { AnimalProfileDrawer, ResolveBlockerWizard, TaskDrawer } from '@/components/saas/flows';
import { useXbarStore } from '@/store/useXbarStore';
import { events, track } from '@/lib/telemetry';
import {
  commandActivity,
  commandMetrics,
  commandRevenue,
  commandRisk,
  dashboardMetrics,
  documentExpiry,
  nextBestAction,
  todayTasks,
  watchAnimals,
  xbarRanch,
  type WatchAnimal,
  type WorkTask,
} from '@/data/xbarSaasMock';

const XBAR_ICON = '/brand/xbar_public_assets/public/brand/xbar-app-icon-512.png';
const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

export default function Dashboard() {
  const navigate = useNavigate();
  const workspaceProfile = useXbarStore((s) => s.workspaceProfile);
  const ranchName = workspaceProfile.ranchName || workspaceProfile.businessName || xbarRanch.name;

  const [openTask, setOpenTask] = useState<WorkTask | null>(null);
  const [animal, setAnimal] = useState<WatchAnimal | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  useEffect(() => {
    track(events.pageView, { surface: 'operations_console' });
  }, []);

  const previewTasks = useMemo(() => todayTasks.slice(0, 4), []);
  const medicalHold = watchAnimals.find((a) => a.group === 'Medical Hold');
  const reviewAnimal = watchAnimals.find((a) => a.group === 'Missing Records');

  const ribbon = [
    { value: commandMetrics.activeSaleProspects + 24, label: 'Animals', to: '/animals' },
    { value: commandMetrics.activeSaleProspects, label: 'Sale prospects', to: '/sales-pipeline' },
    { value: commandMetrics.documentsExpiring, label: 'Docs expiring', to: '/documents-vault', tone: 'warn' as const },
    { value: commandMetrics.buyerDealRooms, label: 'Deal rooms', to: '/buyer-deal-room' },
    { value: `${dashboardMetrics.readinessScore}%`, label: 'Readiness', to: '/reports' },
  ];

  function openResolve() {
    track(events.blockerOpened, { source: 'home_hero' });
    setResolveOpen(true);
  }

  return (
    <div className="xs-home">
      {/* ---------------------------------------------------------- Hero */}
      <section className="xs-hero">
        <img className="xs-hero__wm" src={XBAR_ICON} alt="" aria-hidden="true" />
        <div className="xs-hero__body">
          <div className="xs-hero__eyebrow"><Sparkles size={13} /> {ranchName} · Sale Season</div>
          <h1 className="xs-hero__headline">
            1 sale is blocked — <em>{usd(commandMetrics.revenueBlocked)}</em> at risk.
          </h1>
          <p className="xs-hero__sub">
            RHA Pine Barrel Prospect can't move to a buyer until its health certificate expiration is added.
            Clear it and {commandMetrics.activeBuyers} active buyers can proceed. {commandMetrics.tasksDueToday} tasks are due today, {commandMetrics.overdueTasks} overdue.
          </p>
          <div className="xs-hero__actions">
            <ActionButton variant="primary" icon={<ArrowRight size={15} />} onClick={openResolve}>Resolve blocker</ActionButton>
            <ActionButton onClick={() => navigate('/today')}>Open work queue</ActionButton>
            <ActionButton variant="ghost" onClick={() => navigate('/reports')}>Readiness report</ActionButton>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- Ribbon */}
      <div className="xs-ribbon">
        {ribbon.map((r) => (
          <button key={r.label} type="button" className="xs-ribbon__item" onClick={() => navigate(r.to)}>
            <span className={`xs-ribbon__value${r.tone === 'warn' ? ' xs-ribbon__value--warn' : ''}`}>{r.value}</span>
            <span className="xs-ribbon__label">{r.label}</span>
          </button>
        ))}
      </div>

      {/* ----------------------------------------- Working area (2-col) */}
      <div className="xs-homegrid">
        <div>
          {/* Needs a decision */}
          <div className="xs-sectlabel">
            <span className="xs-sectlabel__title">Needs a decision today</span>
            <button type="button" className="xs-card__link" onClick={() => navigate('/today')}>Open work queue</button>
          </div>

          <button type="button" className="xs-signal xs-signal--danger" onClick={openResolve}>
            <span className="xs-signal__icon xs-signal__icon--danger"><Coins size={20} /></span>
            <span className="xs-signal__body">
              <span className="xs-signal__title">Revenue blocker — RHA Pine Barrel Prospect</span>
              <span className="xs-signal__meta">Health certificate expiration missing · {usd(commandMetrics.revenueBlocked)} target · offer {usd(20000)}</span>
            </span>
            <span className="xs-signal__cta"><StatusChip tone="danger">Blocked</StatusChip></span>
          </button>

          {medicalHold ? (
            <button type="button" className="xs-signal xs-signal--warning" onClick={() => { track(events.animalProfileOpened, { id: medicalHold.id, source: 'home_signal' }); setAnimal(medicalHold); }}>
              <span className="xs-signal__icon xs-signal__icon--warning"><Stethoscope size={20} /></span>
              <span className="xs-signal__body">
                <span className="xs-signal__title">Medical hold — {medicalHold.name}</span>
                <span className="xs-signal__meta">{medicalHold.next} · {medicalHold.location}</span>
              </span>
              <span className="xs-signal__cta"><StatusChip tone="warning">Hold</StatusChip></span>
            </button>
          ) : null}

          <button type="button" className="xs-signal xs-signal--warning" onClick={() => navigate('/documents-vault')}>
            <span className="xs-signal__icon xs-signal__icon--warning"><FileWarning size={20} /></span>
            <span className="xs-signal__body">
              <span className="xs-signal__title">{documentExpiry.total} documents expiring soon</span>
              <span className="xs-signal__meta">{documentExpiry.breakdown.map((b) => `${b.count} ${b.label}`).join(' · ')}</span>
            </span>
            <span className="xs-signal__cta"><StatusChip tone="warning">Review</StatusChip></span>
          </button>

          {reviewAnimal ? (
            <button type="button" className="xs-signal xs-signal--info" onClick={() => { track(events.animalProfileOpened, { id: reviewAnimal.id, source: 'home_signal' }); setAnimal(reviewAnimal); }}>
              <span className="xs-signal__icon"><HorsesIcon width={20} height={20} /></span>
              <span className="xs-signal__body">
                <span className="xs-signal__title">Packet review — {reviewAnimal.name}</span>
                <span className="xs-signal__meta">{reviewAnimal.next}</span>
              </span>
              <span className="xs-signal__cta"><StatusChip tone="info">Review</StatusChip></span>
            </button>
          ) : null}

          {/* Compact work preview */}
          <div className="xs-sectlabel" style={{ marginTop: 26 }}>
            <span className="xs-sectlabel__title">Today's work</span>
            <button type="button" className="xs-card__link" onClick={() => navigate('/today')}>{commandMetrics.tasksDueToday} due</button>
          </div>
          <div className="xs-card" style={{ padding: '6px 18px' }}>
            <div className="xs-workmini">
              {previewTasks.map((t) => (
                <div key={t.id} className="xs-workmini__row" role="button" tabIndex={0} onClick={() => { track(events.taskOpened, { id: t.id, source: 'home' }); setOpenTask(t); }} onKeyDown={(e) => e.key === 'Enter' && setOpenTask(t)}>
                  <StatusChip tone={t.priority === 'Revenue Blocker' ? 'danger' : t.priority === 'High' ? 'warning' : 'neutral'}>{t.priority}</StatusChip>
                  <span className="xs-workmini__title">{t.title}</span>
                  <span className="xs-workmini__due">{t.due}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* -------------------------------------- Intelligence panel */}
        <div className="xs-intel">
          <div className="xs-intel__head"><Sparkles size={13} /> XBAR Intelligence</div>

          <div className="xs-intel__nba">
            <div className="xs-intel__sec-label" style={{ color: 'var(--xbar-cyan-ink)' }}>Next best action</div>
            <div className="xs-intel__nba-title">{nextBestAction.title}</div>
            <div className="xs-intel__nba-reason">{nextBestAction.reason}</div>
            <ActionButton variant="primary" size="sm" icon={<ArrowRight size={14} />} onClick={openResolve}>Resolve now</ActionButton>
          </div>

          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Risk</div>
            {commandRisk.map((r) => (<div key={r} className="xs-intel__line"><AlertTriangle size={14} /><span>{r}</span></div>))}
          </div>

          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Revenue</div>
            {commandRevenue.map((r) => (<div key={r} className="xs-intel__line"><Coins size={14} /><span>{r}</span></div>))}
          </div>

          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Recent activity</div>
            {commandActivity.slice(0, 4).map((a) => (<div key={a.label} className="xs-intel__line"><CalendarClock size={14} /><span>{a.label}<span style={{ color: 'var(--xbar-text-muted)', display: 'block', fontSize: 11 }}>{a.time}</span></span></div>))}
          </div>

          <div className="xs-intel__sec">
            <div className="xs-intel__sec-label">Quick create</div>
            <div className="xs-intel__qc">
              <ActionButton size="sm" icon={<Plus size={14} />} onClick={() => navigate('/today')}>Task</ActionButton>
              <ActionButton size="sm" icon={<HorsesIcon width={14} height={14} />} onClick={() => navigate('/animals')}>Animal</ActionButton>
              <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents-vault')}>Document</ActionButton>
              <ActionButton size="sm" icon={<Users size={14} />} onClick={() => navigate('/buyer-deal-room')}>Buyer</ActionButton>
            </div>
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------- Flows */}
      <TaskDrawer task={openTask} onClose={() => setOpenTask(null)} onResolveBlocker={() => { setOpenTask(null); openResolve(); }} />
      <ResolveBlockerWizard open={resolveOpen} onClose={() => setResolveOpen(false)} />
      <AnimalProfileDrawer animal={animal} onClose={() => setAnimal(null)} onStartPacket={() => { setAnimal(null); navigate('/sale-packet-studio'); }} />
    </div>
  );
}
