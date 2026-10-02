import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, EyeOff, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { track, events } from '@/lib/telemetry';
import { formatDateLabel, localIsoDate } from '@/lib/format';
import {
  LEGACY_DISMISS_PREFIX,
  SNOOZE_CHOICES,
  TASK_DEFERRALS_KEY,
  addLocalDays,
  deferTask,
  isDeferred,
  readDeferrals,
  type TaskDeferrals,
} from '@/lib/taskDeferrals';

type TaskCategory = 'Documents' | 'Care' | 'Sales';
type Task = {
  id: string;
  title: string;
  detail: string;
  category: TaskCategory;
  priority: 'Blocker' | 'High' | 'Normal';
  linkedName: string;
  to: string;
  due: string;
};

const TABS: Array<'All' | TaskCategory> = ['All', 'Documents', 'Care', 'Sales'];
const priorityTone = { Blocker: 'danger', High: 'warning', Normal: 'neutral' } as const;

export default function TodayWork() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const ownershipRecords = useXbarStore((s) => s.ownershipRecords);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const salesLeads = useXbarStore((s) => s.salesLeads);
  const [tab, setTab] = useState<'All' | TaskCategory>('All');
  // A task is completed by fixing its record, which clears it for everyone.
  // Hiding or snoozing one only defers it on this device, until a chosen local
  // day, and says so (audit F09).
  const today = localIsoDate();
  const [deferrals, setDeferrals] = useState<TaskDeferrals>(() => {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith(LEGACY_DISMISS_PREFIX)) localStorage.removeItem(key);
      }
      return readDeferrals(localStorage.getItem(TASK_DEFERRALS_KEY), localIsoDate());
    } catch {
      return {};
    }
  });
  const [open, setOpen] = useState<Task | null>(null);
  const toast = (m: string) => pushToast({ title: 'Care Tasks', message: m, tone: 'success' });

  const allTasks = useMemo<Task[]>(() => {
    const out: Task[] = [];
    buildTransferGapRows(horses, ownershipRecords, documents).forEach((g) =>
      out.push({
        id: `gap-${g.horseId}`,
        title: `Finish ownership documents — ${g.horseName}`,
        detail: g.reasons.slice(0, 2).join(' · ') || 'Missing transfer documents',
        category: 'Documents',
        priority: 'Blocker',
        linkedName: g.horseName,
        to: `/horses/${g.horseId}`,
        due: g.dueDate || 'Now',
      }),
    );
    buildCareBoardRows(horses, documents, expenseReceipts).forEach((row) => {
      const due = row.signals.filter((s) => s.status === 'due');
      if (due.length) {
        out.push({
          id: `care-${row.horseId}`,
          title: `Care due — ${row.horseName}`,
          detail: due.map((s) => s.label).join(' · '),
          category: 'Care',
          priority: 'High',
          linkedName: row.horseName,
          to: `/horses/${row.horseId}`,
          due: due[0].dueDate ?? 'Today',
        });
      }
    });
    documents
      .filter((d) => d.state === 'Needs Review' || d.state === 'Queued' || d.state === 'Matched')
      .forEach((d) =>
        out.push({
          id: `doc-${d.id}`,
          title: `Review document — ${d.title}`,
          detail: `${d.type} waiting to be checked`,
          category: 'Documents',
          priority: 'Normal',
          linkedName: d.title,
          to: '/documents',
          due: 'Today',
        }),
      );
    salesLeads
      .filter((l) => l.stage !== 'Closed' && l.nextFollowUp)
      .forEach((l) =>
        out.push({
          id: `lead-${l.id}`,
          title: `Follow up with ${l.name}`,
          detail: l.notes ?? 'Buyer follow-up',
          category: 'Sales',
          priority: 'Normal',
          linkedName: l.name,
          to: buyerFollowUpPath(l.id),
          due: l.nextFollowUp ?? 'Soon',
        }),
      );
    return out;
  }, [horses, documents, ownershipRecords, expenseReceipts, salesLeads]);
  const tasks = allTasks.filter((t) => !isDeferred(deferrals, t.id, today));
  const hiddenCount = allTasks.length - tasks.length;

  const filtered = tab === 'All' ? tasks : tasks.filter((t) => t.category === tab);
  const writeDeferrals = (next: TaskDeferrals) => {
    try {
      if (Object.keys(next).length) localStorage.setItem(TASK_DEFERRALS_KEY, JSON.stringify(next));
      else localStorage.removeItem(TASK_DEFERRALS_KEY);
    } catch {
      // Storage unavailable (private mode): the deferral holds for this visit only.
    }
  };
  const defer = (task: Task, days: number, kind: 'hide' | 'snooze') => {
    const until = addLocalDays(today, days);
    setDeferrals((cur) => {
      const next = deferTask(cur, task.id, until);
      writeDeferrals(next);
      return next;
    });
    track(kind === 'hide' ? events.taskDismissed : events.taskSnoozed, {
      id: task.id,
      category: task.category,
      until,
    });
    setOpen(null);
    toast(
      kind === 'hide'
        ? 'Hidden on this device until tomorrow. It clears for everyone once the record is fixed.'
        : `Snoozed on this device until ${formatDateLabel(until)}. It clears for everyone once the record is fixed.`,
    );
  };
  const showHidden = () => {
    setDeferrals({});
    writeDeferrals({});
  };

  return (
    <>
      <PageHead
        eyebrow="Daily work"
        title="Care Tasks"
        subtitle="Everything that needs doing today — documents to finish, care that's due, and buyers to follow up with."
        actions={
          <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
            Add Horse
          </ActionButton>
        }
      />

      {horses.length === 0 ? (
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <CheckCircle2 size={26} />
            </span>
            <div className="xs-empty__title">Nothing to do yet</div>
            <div className="xs-empty__sub">
              Add your horses and their documents — XBAR will show you what care is due and what needs finishing before
              a sale.
            </div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
              Add first horse
            </ActionButton>
          </div>
        </Card>
      ) : (
        <>
          <div className="xs-stickybar">
            <div className="xs-fchips">
              {TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`xs-fchip${tab === t ? ' xs-fchip--active' : ''}`}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            {hiddenCount > 0 ? (
              <button type="button" className="xs-fchip" onClick={showHidden}>
                {hiddenCount} hidden · Show
              </button>
            ) : null}
            <span className="xs-card__sub">
              {filtered.length} task{filtered.length === 1 ? '' : 's'}
            </span>
          </div>

          <Card>
            {filtered.length === 0 ? (
              <div className="xs-empty">You're all caught up here. Nice work.</div>
            ) : (
              filtered.map((t) => (
                <div
                  key={t.id}
                  className={`xs-task xs-task--click${t.priority === 'Blocker' ? ' xs-task--blocker' : ''}`}
                  style={{ gridTemplateColumns: '116px 1fr auto' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpen(t)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpen(t);
                    }
                  }}
                >
                  <StatusChip tone={priorityTone[t.priority]}>
                    {t.priority === 'Blocker' ? 'Cannot sell yet' : t.priority}
                  </StatusChip>
                  <div>
                    <div className="xs-task__title">{t.title}</div>
                    <div className="xs-task__meta">
                      <span>{t.detail}</span>
                    </div>
                  </div>
                  <div className="xs-task__right" onClick={(e) => e.stopPropagation()}>
                    <span className="xs-task__due">{t.due}</span>
                    <div className="xs-task__quick">
                      <button
                        type="button"
                        className="xs-quickbtn"
                        title="Hide for today on this device"
                        aria-label="Hide for today on this device"
                        onClick={() => defer(t, 1, 'hide')}
                      >
                        <EyeOff size={15} />
                      </button>
                      <button type="button" className="xs-quickbtn" title="Open" onClick={() => setOpen(t)}>
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </>
      )}

      <SlideOverDrawer
        open={Boolean(open)}
        title={open?.title ?? ''}
        subtitle={open ? `${open.category} · ${open.linkedName}` : ''}
        onClose={() => setOpen(null)}
        footer={
          open ? (
            <>
              <ActionButton onClick={() => defer(open, 1, 'hide')}>Hide for today</ActionButton>
              <ActionButton
                variant="primary"
                icon={<ArrowRight size={15} />}
                onClick={() => {
                  const to = open.to;
                  setOpen(null);
                  navigate(to);
                }}
              >
                Fix it now
              </ActionButton>
            </>
          ) : null
        }
      >
        {open ? (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <StatusChip tone={priorityTone[open.priority]}>
                {open.priority === 'Blocker' ? 'Cannot sell yet' : open.priority}
              </StatusChip>
              <span className="xs-chip xs-chip--neutral">Due {open.due}</span>
            </div>
            {open.priority === 'Blocker' ? (
              <div
                className="xs-railcard"
                style={{ borderColor: 'rgba(185,71,62,0.35)', background: 'var(--xbar-danger-soft)' }}
              >
                <div className="xs-section-label" style={{ color: 'var(--xbar-danger)' }}>
                  Holds up a sale
                </div>
                <div style={{ fontWeight: 700 }}>{open.detail}</div>
              </div>
            ) : (
              <p className="xs-muted" style={{ fontSize: 13 }}>
                {open.detail}
              </p>
            )}
            <p className="xs-muted" style={{ fontSize: 13 }}>
              This task clears for everyone once its record is fixed. Snoozing only hides it on this device.
            </p>
            <div className="xs-field">
              <span className="xs-section-label">Snooze until</span>
              <div className="xs-fchips">
                {SNOOZE_CHOICES.map((choice) => (
                  <button
                    key={choice.days}
                    type="button"
                    className="xs-fchip"
                    onClick={() => defer(open, choice.days, 'snooze')}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}
