import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ClipboardList,
  Coins,
  Droplets,
  FileWarning,
  ListChecks,
  MapPin,
  Move,
  Plus,
  Sparkles,
  StickyNote,
  Timer,
  Tractor,
  TrendingUp,
  Upload,
  Wheat,
} from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton, Card, FilterTabs, PriorityChip, StatusChip } from '@/components/saas';
import { AnimalProfileDrawer, ResolveBlockerWizard, TaskDrawer } from '@/components/saas/flows';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import {
  commandActivity,
  commandMetrics,
  commandRevenue,
  commandRisk,
  equipment,
  feedInventory,
  financialSnapshot,
  healthCompliance,
  nextBestAction,
  pastures,
  todayTasks,
  watchAnimals,
  workboardTabs,
  xbarRanch,
  type WatchAnimal,
  type WorkTask,
} from '@/data/xbarSaasMock';

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
const usdK = (n: number) => `$${(n / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k`;
const groupOrder: WatchAnimal['group'][] = ['Medical Hold', 'Sale Prospect', 'Breeding Window', 'Missing Records', 'Due for Care'];

export default function Dashboard() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const ranchName = workspaceProfile.ranchName || workspaceProfile.businessName || xbarRanch.name;

  const [tasks, setTasks] = useState<WorkTask[]>(todayTasks);
  const [tab, setTab] = useState<string>('All');
  const [openTask, setOpenTask] = useState<WorkTask | null>(null);
  const [animal, setAnimal] = useState<WatchAnimal | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  const filteredTasks = useMemo(() => {
    if (tab === 'All') return tasks;
    if (tab === 'Overdue') return tasks.filter((t) => t.overdue);
    return tasks.filter((t) => t.category === tab);
  }, [tasks, tab]);

  const toast = (m: string) => pushToast({ title: 'XBAR', message: m, tone: 'success' });
  const markDone = (id: string) => {
    const done = tasks.find((t) => t.id === id);
    setTasks((cur) => cur.filter((t) => t.id !== id));
    toast(done ? `Completed: ${done.title}` : 'Task completed');
  };

  return (
    <>
      <div className="xs-page__head">
        <div>
          <div className="xs-eyebrow">{ranchName}</div>
          <h1 className="xs-title">XBAR Operations Console</h1>
          <p className="xs-subtitle">What needs done now, what's blocking money, and what needs proof — one operational surface.</p>
        </div>
        <div className="xs-field">
          <button type="button" className="xs-fieldbtn" onClick={() => toast('Note captured to the ranch log')}><StickyNote size={15} /> Add Note</button>
          <button type="button" className="xs-fieldbtn" onClick={() => toast('Photo queued for upload')}><Camera size={15} /> Add Photo</button>
          <button type="button" className="xs-fieldbtn" onClick={() => toast('Pasture issue reported')}><AlertTriangle size={15} /> Report Issue</button>
        </div>
      </div>

      {/* ----------------------------------------------------- Priority strip */}
      <div className="xs-strip">
        <article className="xs-prio xs-prio--brass">
          <div className="xs-prio__head"><span className="xs-prio__icon"><ClipboardList size={20} /></span><span className="xs-prio__label">Today's Work</span></div>
          <div className="xs-prio__big"><span className="xs-prio__num">{commandMetrics.tasksDueToday}</span><span className="xs-prio__unit">tasks due</span></div>
          <div className="xs-prio__sub"><span><strong>{commandMetrics.overdueTasks}</strong> overdue</span></div>
          <ActionButton variant="primary" block onClick={() => document.getElementById('xs-workboard')?.scrollIntoView({ behavior: 'smooth' })}>Open Work Queue</ActionButton>
        </article>
        <article className="xs-prio xs-prio--warning">
          <div className="xs-prio__head"><span className="xs-prio__icon"><HorsesIcon width={20} height={20} /></span><span className="xs-prio__label">Animal Watchlist</span></div>
          <div className="xs-prio__big"><span className="xs-prio__num">{commandMetrics.animalsNeedAttention}</span><span className="xs-prio__unit">need attention</span></div>
          <div className="xs-prio__sub"><span><strong>{commandMetrics.medicalHolds}</strong> medical hold</span></div>
          <ActionButton variant="primary" block onClick={() => document.getElementById('xs-watchlist')?.scrollIntoView({ behavior: 'smooth' })}>Review Animals</ActionButton>
        </article>
        <article className="xs-prio xs-prio--danger">
          <div className="xs-prio__head"><span className="xs-prio__icon"><Coins size={20} /></span><span className="xs-prio__label">Revenue Blockers</span></div>
          <div className="xs-prio__big"><span className="xs-prio__num">1</span><span className="xs-prio__unit">sale blocked</span></div>
          <div className="xs-prio__sub"><span><strong>{usd(commandMetrics.revenueBlocked)}</strong> target affected</span></div>
          <ActionButton variant="primary" block onClick={() => setResolveOpen(true)}>Clear Blocker</ActionButton>
        </article>
        <article className="xs-prio xs-prio--olive">
          <div className="xs-prio__head"><span className="xs-prio__icon"><FileWarning size={20} /></span><span className="xs-prio__label">Documents Expiring</span></div>
          <div className="xs-prio__big"><span className="xs-prio__num">{commandMetrics.documentsExpiring}</span><span className="xs-prio__unit">expiring soon</span></div>
          <div className="xs-prio__sub"><span><strong>{commandMetrics.healthCerts}</strong> certs</span><span><strong>{commandMetrics.coggins}</strong> Coggins</span><span><strong>{commandMetrics.foalRegs}</strong> foal regs</span></div>
          <ActionButton variant="primary" block onClick={() => navigate('/documents-vault')}>Open Vault</ActionButton>
        </article>
      </div>

      <div className="xs-cc-rows">
        {/* --------------------------------------- Row 1: work queue + rail */}
        <div className="xs-r-8-4">
          <Card>
            <div id="xs-workboard" />
            <div className="xs-work__bar">
              <div>
                <h2 className="xs-card__title">Today's Work — Work Queue</h2>
                <div className="xs-card__sub">Click a task to open it. {filteredTasks.length} of {tasks.length} shown.</div>
              </div>
              <div className="xs-work__actions">
                <ActionButton size="sm" onClick={() => toast('Bulk update applied')}>Bulk Update</ActionButton>
                <ActionButton size="sm" variant="primary" icon={<Plus size={15} />} onClick={() => toast('Use the Create button to add a task')}>Add Task</ActionButton>
              </div>
            </div>
            <FilterTabs tabs={workboardTabs} active={tab} onChange={setTab} />
            <div style={{ marginTop: 8 }}>
              {filteredTasks.length === 0 ? (
                <div className="xs-empty">Nothing in this lane.</div>
              ) : (
                filteredTasks.map((t) => (
                  <div key={t.id} className={`xs-task xs-task--click${t.priority === 'Revenue Blocker' ? ' xs-task--blocker' : ''}`} role="button" tabIndex={0} onClick={() => setOpenTask(t)} onKeyDown={(e) => e.key === 'Enter' && setOpenTask(t)}>
                    <PriorityChip priority={t.priority} />
                    <div>
                      <div className="xs-task__title">{t.title}</div>
                      <div className="xs-task__meta"><span>{t.linkedType}: {t.linkedName}</span><span>· {t.assignee}</span><span>· {t.status}</span></div>
                    </div>
                    <div className="xs-task__right" onClick={(e) => e.stopPropagation()}>
                      <span className={`xs-task__due${t.due === 'Now' ? ' xs-task__due--now' : ''}`}>{t.due}</span>
                      <div className="xs-task__quick">
                        <button type="button" className="xs-quickbtn" title="Mark done" onClick={() => markDone(t.id)}><CheckCircle2 size={15} /></button>
                        <button type="button" className="xs-quickbtn" title="Add note" onClick={() => toast(`Note added to "${t.title}"`)}><StickyNote size={15} /></button>
                        <button type="button" className="xs-quickbtn" title="Snooze" onClick={() => toast(`Snoozed "${t.title}"`)}><Timer size={15} /></button>
                        <button type="button" className="xs-quickbtn" title="Open task" onClick={() => setOpenTask(t)}><ArrowRight size={15} /></button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <IntelligenceRail navigate={navigate} onQuick={toast} onResolve={() => setResolveOpen(true)} />
        </div>

        {/* --------------------------- Row 2: watchlist + pasture + health */}
        <div className="xs-r-5-4-3">
          <Card link="All animals" onLink={() => navigate('/horses')}>
            <div id="xs-watchlist" />
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Animal Watchlist</h2>
            <div className="xs-card__sub" style={{ marginBottom: 10 }}>Click any animal to open its profile</div>
            {groupOrder.filter((g) => watchAnimals.some((a) => a.group === g)).map((g) => (
              <div key={g}>
                <div className="xs-watch__group">{g}</div>
                {watchAnimals.filter((a) => a.group === g).map((a) => (
                  <button key={a.id} type="button" className="xs-animal" onClick={() => setAnimal(a)}>
                    <span className="xs-animal__avatar"><HorsesIcon width={20} height={20} /></span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="xs-animal__name">{a.name}</span>
                      <span className="xs-animal__meta">{a.species} · {a.sex} · {a.age} · {a.location}</span>
                      <span className="xs-animal__next">Next: <b>{a.next}</b></span>
                    </span>
                    <StatusChip tone={a.tone}>{a.status}</StatusChip>
                  </button>
                ))}
              </div>
            ))}
          </Card>

          <Card link="Open locations" onLink={() => navigate('/pastures')}>
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Pastures & Locations</h2>
            <div className="xs-card__sub" style={{ marginBottom: 12 }}>{pastures.length} locations · {pastures.reduce((s, p) => s + p.animals, 0)} animals placed</div>
            <div className="xs-pgrid">
              {pastures.map((p) => (
                <button key={p.id} type="button" className="xs-pcard" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => navigate('/pastures')}>
                  <div className="xs-pcard__name">{p.name}</div>
                  <div className="xs-pcard__count">{p.animals} animals · {p.openTasks} tasks</div>
                  <div className="xs-pcard__tags">
                    <span className={`xs-ptag xs-ptag--${p.water === 'OK' ? 'ok' : p.water === 'Check' ? 'check' : 'issue'}`}>Water {p.water}</span>
                    <span className={`xs-ptag xs-ptag--${p.fence === 'OK' ? 'ok' : p.fence === 'Check' ? 'check' : 'issue'}`}>Fence {p.fence}</span>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <ActionButton size="sm" icon={<Move size={14} />} onClick={() => navigate('/pastures')}>Move Animals</ActionButton>
              <ActionButton size="sm" icon={<AlertTriangle size={14} />} onClick={() => toast('Pasture issue reported')}>Report Issue</ActionButton>
            </div>
          </Card>

          <Card link="Health" onLink={() => navigate('/medical')}>
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Health & Compliance</h2>
            <div className="xs-card__sub" style={{ marginBottom: 12 }}>Records that gate care and release</div>
            <div className="xs-statgrid">
              <div className="xs-stattile"><div className="xs-stattile__num xs-stattile__num--danger">{healthCompliance.overdue}</div><div className="xs-stattile__label">Overdue care</div></div>
              <div className="xs-stattile"><div className="xs-stattile__num xs-stattile__num--warning">{healthCompliance.expiringDocs}</div><div className="xs-stattile__label">Expiring docs</div></div>
              <div className="xs-stattile"><div className="xs-stattile__num xs-stattile__num--danger">{healthCompliance.medicalHolds}</div><div className="xs-stattile__label">Medical holds</div></div>
              <div className="xs-stattile"><div className="xs-stattile__num">{healthCompliance.upcoming}</div><div className="xs-stattile__label">Upcoming</div></div>
            </div>
            <div className="xs-mlist">
              {healthCompliance.items.map((it) => (
                <div key={it.label} className="xs-mrow">
                  <span className="xs-mrow__main"><span className="xs-mrow__title">{it.label}</span><span className="xs-mrow__detail">{it.detail}</span></span>
                  <StatusChip tone={it.tone}>{it.tone === 'danger' ? 'Blocker' : 'Due'}</StatusChip>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ----------------------------- Row 3: pipeline + proof engine */}
        <div className="xs-r-6-6">
          <Card link="Open pipeline" onLink={() => navigate('/sales-pipeline')}>
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Sales Pipeline</h2>
            <div className="xs-card__sub" style={{ marginBottom: 12 }}>{commandMetrics.activeSaleProspects} prospects · {usd(financialSnapshot.openSaleValue)} open value</div>
            <div className="xs-task xs-task--blocker">
              <PriorityChip priority="Revenue Blocker" />
              <div><div className="xs-task__title">RHA Pine Barrel Prospect</div><div className="xs-task__meta"><span>Target {usd(35000)}</span><span>· Offer {usd(20000)}</span><span>· Release blocked</span></div></div>
              <div className="xs-task__right"><ActionButton size="sm" variant="primary" onClick={() => setResolveOpen(true)}>Clear blocker</ActionButton></div>
            </div>
            <div className="xs-mlist" style={{ marginTop: 4 }}>
              <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">THR Copper Canyon</span><span className="xs-mrow__detail">Offer {usd(28000)} · Release ready</span></span><StatusChip tone="success">Ready</StatusChip></div>
              <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">THR Juniper Ledge</span><span className="xs-mrow__detail">Packet ready · buyer invited</span></span><StatusChip tone="warning">Review</StatusChip></div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <ActionButton size="sm" onClick={() => navigate('/sale-packet-studio')}>Create Packet</ActionButton>
              <ActionButton size="sm" onClick={() => navigate('/buyer-deal-room')}>Open Deal Room</ActionButton>
            </div>
          </Card>

          <Card link="Open vault" onLink={() => navigate('/documents-vault')}>
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Documents & Proof Engine</h2>
            <div className="xs-card__sub" style={{ marginBottom: 12 }}>Buyer-safe proof, expirations, and review queue</div>
            <div className="xs-statgrid">
              <div className="xs-stattile"><div className="xs-stattile__num xs-stattile__num--warning">{commandMetrics.documentsExpiring}</div><div className="xs-stattile__label">Expiring soon</div></div>
              <div className="xs-stattile"><div className="xs-stattile__num xs-stattile__num--danger">2</div><div className="xs-stattile__label">Missing data</div></div>
              <div className="xs-stattile"><div className="xs-stattile__num">24</div><div className="xs-stattile__label">Buyer-safe</div></div>
              <div className="xs-stattile"><div className="xs-stattile__num">3</div><div className="xs-stattile__label">In review</div></div>
            </div>
            <ActionButton size="sm" block icon={<Upload size={14} />} onClick={() => navigate('/documents-vault')}>Open Documents Vault</ActionButton>
          </Card>
        </div>

        {/* ------------------------ Row 4: feed + equipment + financial */}
        <div className="xs-r-4-4-4">
          <Card link="Inventory" onLink={() => navigate('/feed')}>
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Feed & Inventory</h2>
            <div className="xs-card__sub" style={{ marginBottom: 12 }}>{usd(feedInventory.feedCostMonth)}/mo · {usd(feedInventory.costPerAnimalDay)}/animal-day</div>
            <div className="xs-mlist">
              {feedInventory.lowStock.map((f) => (
                <div key={f.name} className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">{f.name}</span><span className="xs-mrow__detail">{f.detail}</span></span><StatusChip tone={f.tone}>{f.level}</StatusChip></div>
              ))}
            </div>
            <ActionButton size="sm" block icon={<Wheat size={14} />} onClick={() => navigate('/feed')}>Open Feed & Inventory</ActionButton>
          </Card>

          <Card link="Equipment" onLink={() => navigate('/assets')}>
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Equipment & Maintenance</h2>
            <div className="xs-card__sub" style={{ marginBottom: 12 }}>{equipment.serviceDue} service due · {equipment.broken} broken · {equipment.workOrders} work orders</div>
            <div className="xs-mlist">
              {equipment.items.map((e) => (
                <div key={e.name} className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">{e.name}</span><span className="xs-mrow__detail">{e.detail}</span></span><StatusChip tone={e.tone}>{e.status}</StatusChip></div>
              ))}
            </div>
            <ActionButton size="sm" block icon={<Tractor size={14} />} onClick={() => toast('Work order created')}>Create Work Order</ActionButton>
          </Card>

          <Card link="Reports" onLink={() => navigate('/reports')}>
            <h2 className="xs-card__title" style={{ marginBottom: 2 }}>Financial Snapshot</h2>
            <div className="xs-card__sub" style={{ marginBottom: 12 }}>{usd(financialSnapshot.monthExpenses)} this month · {financialSnapshot.projectedMargin}% margin</div>
            {financialSnapshot.rows.map((r) => {
              const max = Math.max(...financialSnapshot.rows.map((x) => x.value));
              return (
                <div key={r.label} className="xs-finbar">
                  <span className="xs-finbar__label">{r.label}</span>
                  <span className="xs-finbar__track"><span className="xs-finbar__fill" style={{ width: `${(r.value / max) * 100}%` }} /></span>
                  <span className="xs-finbar__val">{usdK(r.value)}</span>
                </div>
              );
            })}
            <ActionButton size="sm" block icon={<TrendingUp size={14} />} onClick={() => navigate('/expenses')}>Add Expense</ActionButton>
          </Card>
        </div>
      </div>

      {/* --------------------------------------------------------- Flows */}
      <TaskDrawer task={openTask} onClose={() => setOpenTask(null)} onResolveBlocker={() => { setOpenTask(null); setResolveOpen(true); }} />
      <ResolveBlockerWizard open={resolveOpen} onClose={() => setResolveOpen(false)} />
      <AnimalProfileDrawer animal={animal} onClose={() => setAnimal(null)} onStartPacket={() => { setAnimal(null); navigate('/sale-packet-studio'); }} />
    </>
  );
}

/* --------------------------------------------------------- Intelligence rail */
function IntelligenceRail({ navigate, onQuick, onResolve }: { navigate: ReturnType<typeof useNavigate>; onQuick: (m: string) => void; onResolve: () => void }) {
  const quickCreate = [
    { label: 'Add Task', icon: <Plus size={15} />, run: () => onQuick('Use Create to add a task') },
    { label: 'Add Animal', icon: <HorsesIcon width={15} height={15} />, run: () => navigate('/horses?new=1') },
    { label: 'Upload Doc', icon: <Upload size={15} />, run: () => navigate('/documents-vault') },
    { label: 'Move Animals', icon: <Move size={15} />, run: () => navigate('/pastures') },
    { label: 'Sale Packet', icon: <ListChecks size={15} />, run: () => navigate('/sale-packet-studio') },
    { label: 'Invite Buyer', icon: <MapPin size={15} />, run: () => navigate('/buyer-deal-room') },
  ];

  return (
    <div className="xs-rail">
      <div className="xs-rail__title"><Sparkles size={13} /> XBAR Intelligence</div>

      <div className="xs-nba">
        <div className="xs-nba__label"><Sparkles size={13} /> Next best action</div>
        <div className="xs-nba__title">{nextBestAction.title}</div>
        <div className="xs-nba__reason">{nextBestAction.reason}</div>
        <ActionButton variant="primary" size="sm" icon={<ArrowRight size={14} />} onClick={onResolve}>Resolve Now</ActionButton>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Risk</div>
        <div className="xs-feed">{commandRisk.map((r) => (<div key={r} className="xs-feed__row"><AlertTriangle size={14} className="xs-muted" /><span style={{ flex: 1 }}>{r}</span></div>))}</div>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Revenue</div>
        <div className="xs-feed">{commandRevenue.map((r) => (<div key={r} className="xs-feed__row"><Coins size={14} className="xs-muted" /><span style={{ flex: 1 }}>{r}</span></div>))}</div>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Recent activity</div>
        <div className="xs-feed">{commandActivity.map((a) => (<div key={a.label} className="xs-feed__row"><span className="xs-feed__dot" /><span style={{ flex: 1 }}>{a.label}<div className="xs-feed__time">{a.time}</div></span></div>))}</div>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Quick create</div>
        <div className="xs-qc-grid">{quickCreate.map((q) => (<button key={q.label} type="button" className="xs-btn xs-btn--sm" onClick={q.run} style={{ justifyContent: 'flex-start' }}>{q.icon}{q.label}</button>))}</div>
      </div>

      <div className="xs-railcard">
        <div className="xs-railcard__label">Field capture</div>
        <div className="xs-field">
          <button type="button" className="xs-fieldbtn" onClick={() => onQuick('Note captured')}><StickyNote size={15} /> Note</button>
          <button type="button" className="xs-fieldbtn" onClick={() => onQuick('Photo queued')}><Camera size={15} /> Photo</button>
          <button type="button" className="xs-fieldbtn" onClick={() => onQuick('Water issue reported')}><Droplets size={15} /> Issue</button>
        </div>
      </div>
    </div>
  );
}
