import { useMemo, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, Plus, StickyNote, Timer, UserPlus } from 'lucide-react';
import { ActionButton, Card, PageHead, PriorityChip } from '@/components/saas';
import { ResolveBlockerWizard, TaskDrawer } from '@/components/saas/flows';
import { useUiStore } from '@/store/useUiStore';
import { todayTasks, workboardTabs, type WorkTask } from '@/data/xbarSaasMock';

export default function TodayWork() {
  const pushToast = useUiStore((state) => state.pushToast);
  const [tasks, setTasks] = useState<WorkTask[]>(todayTasks);
  const [tab, setTab] = useState<string>('All');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openTask, setOpenTask] = useState<WorkTask | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  const filtered = useMemo(() => {
    if (tab === 'All') return tasks;
    if (tab === 'Overdue') return tasks.filter((t) => t.overdue);
    return tasks.filter((t) => t.category === tab);
  }, [tasks, tab]);

  const toast = (m: string) => pushToast({ title: 'Work Queue', message: m, tone: 'success' });
  const markDone = (ids: string[]) => { setTasks((cur) => cur.filter((t) => !ids.includes(t.id))); setSel(new Set()); toast(ids.length > 1 ? `${ids.length} tasks completed` : 'Task completed'); };
  const toggle = (id: string) => setSel((c) => { const n = new Set(c); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSel = filtered.length > 0 && filtered.every((t) => sel.has(t.id));

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Today's Work"
        subtitle="The work queue across animal care, pasture, feed, documents, sales, and equipment."
        actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('Use Create to add a task')}>Add Task</ActionButton>}
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
          <ActionButton size="sm" icon={<CheckCircle2 size={14} />} onClick={() => markDone([...sel])}>Mark Done</ActionButton>
          <ActionButton size="sm" icon={<UserPlus size={14} />} onClick={() => { toast(`${sel.size} reassigned`); setSel(new Set()); }}>Assign</ActionButton>
          <ActionButton size="sm" icon={<Timer size={14} />} onClick={() => { toast(`${sel.size} snoozed`); setSel(new Set()); }}>Snooze</ActionButton>
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
                    <button type="button" className="xs-quickbtn" title="Mark done" onClick={() => markDone([t.id])}><CheckCircle2 size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Add note" onClick={() => toast(`Note added to "${t.title}"`)}><StickyNote size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Snooze" onClick={() => toast(`Snoozed "${t.title}"`)}><Timer size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Open task" onClick={() => setOpenTask(t)}><ArrowRight size={15} /></button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </Card>

      <TaskDrawer task={openTask} onClose={() => setOpenTask(null)} onResolveBlocker={() => { setOpenTask(null); setResolveOpen(true); }} />
      <ResolveBlockerWizard open={resolveOpen} onClose={() => setResolveOpen(false)} />
    </>
  );
}
