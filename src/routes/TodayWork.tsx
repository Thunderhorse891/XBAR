import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, ListChecks, Timer } from 'lucide-react';
import { ActionButton, Card, PageHead, PriorityChip } from '@/components/saas';
import { ResolveBlockerWizard, TaskDrawer } from '@/components/saas/flows';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { buildTodayWork, workboardTabs } from '@/lib/todayWork';
import type { WorkTask } from '@/types/saas';

export default function TodayWork() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const workDate = useMemo(() => new Date(), []);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<string>('All');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openTask, setOpenTask] = useState<WorkTask | null>(null);
  const [resolveTask, setResolveTask] = useState<WorkTask | null>(null);

  const tasks = useMemo(
    () => buildTodayWork({
      horses,
      documents,
      ownershipRecords,
      expenseReceipts,
      salesLeads,
      sharedListings,
      workspaceProfile,
      now: workDate,
    }).filter((task) => !dismissed.has(task.id) && !snoozed.has(task.id)),
    [dismissed, documents, expenseReceipts, horses, ownershipRecords, salesLeads, sharedListings, snoozed, workDate, workspaceProfile],
  );

  const filtered = useMemo(() => {
    if (tab === 'All') return tasks;
    if (tab === 'Overdue') return tasks.filter((t) => t.overdue);
    return tasks.filter((t) => t.category === tab);
  }, [tasks, tab]);

  const toast = (m: string) => pushToast({ title: 'Work Queue', message: m, tone: 'success' });
  const dismissTasks = (ids: string[]) => {
    setDismissed((current) => new Set([...current, ...ids]));
    setSel(new Set());
    toast(ids.length > 1 ? `${ids.length} items hidden for this session` : 'Item hidden for this session');
  };
  const snoozeTasks = (ids: string[]) => {
    setSnoozed((current) => new Set([...current, ...ids]));
    setSel(new Set());
    toast(ids.length > 1 ? `${ids.length} items snoozed for this session` : 'Item snoozed for this session');
  };
  const toggle = (id: string) => setSel((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = filtered.length > 0 && filtered.every((t) => sel.has(t.id));

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Today's Work"
        subtitle="A live work queue from horse records, documents, ownership gaps, sales follow-ups, and workspace setup."
        actions={<ActionButton variant="primary" icon={<ListChecks size={15} />} onClick={() => navigate('/reminders')}>Open Reminders</ActionButton>}
      />

      <div className="xs-stickybar">
        <div className="xs-fchips">
          {workboardTabs.map((t) => (
            <button key={t} type="button" className={`xs-fchip${tab === t ? ' xs-fchip--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <span className="xs-card__sub">{filtered.length} tasks</span>
      </div>

      {sel.size > 0 ? (
        <div className="xs-bulkbar">
          <span className="xs-bulkbar__count">{sel.size} selected</span>
          <ActionButton size="sm" icon={<CheckCircle2 size={14} />} onClick={() => dismissTasks([...sel])}>Dismiss</ActionButton>
          <ActionButton size="sm" icon={<Timer size={14} />} onClick={() => snoozeTasks([...sel])}>Snooze</ActionButton>
          <span className="xs-bulkbar__spacer" />
          <button type="button" className="xs-btn xs-btn--sm xs-btn--ghost" onClick={() => setSel(new Set())}>Clear</button>
        </div>
      ) : null}

      <Card>
        <div className="xs-row" style={{ paddingTop: 4, paddingBottom: 8 }}>
          <span className={`xs-checkbox${allSel ? ' xs-checkbox--on' : ''}`} onClick={() => setSel(allSel ? new Set() : new Set(filtered.map((t) => t.id)))} role="checkbox" aria-checked={allSel}>{allSel ? <Check size={12} /> : null}</span>
          <span className="xs-section-label" style={{ margin: 0 }}>Select all</span>
        </div>
        {filtered.length === 0 ? (
          <div className="xs-empty">Nothing in this lane. Clear work shows here.</div>
        ) : (
          filtered.map((t) => {
            const isSel = sel.has(t.id);
            return (
              <div key={t.id} className={`xs-task xs-task--click${t.priority === 'Revenue Blocker' ? ' xs-task--blocker' : ''}${isSel ? ' xs-tr--sel' : ''}`} style={{ gridTemplateColumns: '30px 116px 1fr auto' }} role="button" tabIndex={0} onClick={() => setOpenTask(t)} onKeyDown={(e) => e.key === 'Enter' && setOpenTask(t)}>
                <span onClick={(e) => { e.stopPropagation(); toggle(t.id); }} className={`xs-checkbox${isSel ? ' xs-checkbox--on' : ''}`}>{isSel ? <Check size={12} /> : null}</span>
                <PriorityChip priority={t.priority} />
                <div>
                  <div className="xs-task__title">{t.title}</div>
                  <div className="xs-task__meta"><span>{t.linkedType}: {t.linkedName}</span><span>· {t.assignee}</span><span>· {t.status}</span></div>
                </div>
                <div className="xs-task__right" onClick={(e) => e.stopPropagation()}>
                  <span className={`xs-task__due${t.due === 'Now' ? ' xs-task__due--now' : ''}`}>{t.due}</span>
                  <div className="xs-task__quick">
                    <button type="button" className="xs-quickbtn" title="Dismiss" onClick={() => dismissTasks([t.id])}><CheckCircle2 size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Snooze" onClick={() => snoozeTasks([t.id])}><Timer size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Open task" onClick={() => setOpenTask(t)}><ArrowRight size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <TaskDrawer
        task={openTask}
        onClose={() => setOpenTask(null)}
        onDismiss={(taskId) => dismissTasks([taskId])}
        onSnooze={(taskId) => snoozeTasks([taskId])}
        onResolveBlocker={(task) => { setOpenTask(null); setResolveTask(task); }}
      />
      <ResolveBlockerWizard open={Boolean(resolveTask)} task={resolveTask} onClose={() => setResolveTask(null)} />
    </>
  );
}
