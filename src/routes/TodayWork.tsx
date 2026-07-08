import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, Plus, Timer } from 'lucide-react';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { track, events } from '@/lib/telemetry';

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

// Done and snoozed task ids persist per calendar day so the list stays quiet
// after a refresh but resurfaces everything the next morning.
const TASK_STATE_KEY = 'xbar-care-tasks-state-v1';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function readTaskState(): { day: string; done: string[]; snoozed: string[] } {
  const empty = { day: todayKey(), done: [], snoozed: [] };
  if (typeof window === 'undefined') return empty;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(TASK_STATE_KEY) ?? '');
    if (parsed?.day !== todayKey()) return empty;
    return {
      day: parsed.day,
      done: Array.isArray(parsed.done) ? parsed.done.filter((v: unknown) => typeof v === 'string') : [],
      snoozed: Array.isArray(parsed.snoozed) ? parsed.snoozed.filter((v: unknown) => typeof v === 'string') : [],
    };
  } catch {
    return empty;
  }
}

function writeTaskState(done: Set<string>, snoozed: Set<string>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(
    TASK_STATE_KEY,
    JSON.stringify({ day: todayKey(), done: [...done], snoozed: [...snoozed] }),
  );
}

export default function TodayWork() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const ownershipRecords = useXbarStore((s) => s.ownershipRecords);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const salesLeads = useXbarStore((s) => s.salesLeads);
  const [tab, setTab] = useState<'All' | TaskCategory>('All');
  const [done, setDone] = useState<Set<string>>(() => new Set(readTaskState().done));
  const [snoozed, setSnoozed] = useState<Set<string>>(() => new Set(readTaskState().snoozed));
  const [open, setOpen] = useState<Task | null>(null);
  const toast = (m: string) => pushToast({ title: 'Care Tasks', message: m, tone: 'success' });

  const tasks = useMemo<Task[]>(() => {
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
    return out.filter((t) => !done.has(t.id) && !snoozed.has(t.id));
  }, [horses, documents, ownershipRecords, expenseReceipts, salesLeads, done, snoozed]);

  const filtered = tab === 'All' ? tasks : tasks.filter((t) => t.category === tab);
  const markDone = (id: string) => {
    setDone((cur) => {
      const next = new Set(cur).add(id);
      writeTaskState(next, snoozed);
      return next;
    });
    setOpen(null);
    toast('Task marked done');
  };

  const snooze = (task: Task) => {
    setSnoozed((cur) => {
      const next = new Set(cur).add(task.id);
      writeTaskState(done, next);
      return next;
    });
    setOpen(null);
    toast(`Snoozed "${task.title}" until tomorrow`);
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
                  onKeyDown={(e) => e.key === 'Enter' && setOpen(t)}
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
                      <button type="button" className="xs-quickbtn" title="Mark done" onClick={() => markDone(t.id)}>
                        <CheckCircle2 size={15} />
                      </button>
                      <button
                        type="button"
                        className="xs-quickbtn"
                        title="Snooze until tomorrow"
                        onClick={() => snooze(t)}
                      >
                        <Timer size={15} />
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
              <ActionButton onClick={() => snooze(open)}>Snooze</ActionButton>
              <ActionButton
                variant="primary"
                icon={<Check size={15} />}
                onClick={() => {
                  track(events.taskCompleted, { id: open.id, category: open.category });
                  markDone(open.id);
                }}
              >
                Mark Done
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
            <div className="xs-field">
              <button
                type="button"
                className="xs-fieldbtn"
                onClick={() => {
                  const to = open.to;
                  setOpen(null);
                  navigate(to);
                }}
              >
                Open linked record
              </button>
            </div>
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}
