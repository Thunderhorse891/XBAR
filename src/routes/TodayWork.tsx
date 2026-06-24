import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Plus, StickyNote, Timer } from 'lucide-react';
import { ActionButton, Card, FilterTabs, PageHead, PriorityChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { todayTasks, workboardTabs, type WorkTask } from '@/data/xbarSaasMock';

export default function TodayWork() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const [tasks, setTasks] = useState<WorkTask[]>(todayTasks);
  const [tab, setTab] = useState<string>('All');

  const filtered = useMemo(() => {
    if (tab === 'All') return tasks;
    if (tab === 'Overdue') return tasks.filter((t) => t.overdue);
    return tasks.filter((t) => t.category === tab);
  }, [tasks, tab]);

  const toast = (m: string, tone: 'success' = 'success') => pushToast({ title: 'Work board', message: m, tone });
  const markDone = (id: string) => {
    const t = tasks.find((x) => x.id === id);
    setTasks((cur) => cur.filter((x) => x.id !== id));
    toast(t ? `Completed: ${t.title}` : 'Task completed');
  };

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Today's Work"
        subtitle="Everything due across animal care, pasture, feed, documents, sales, and equipment."
        actions={
          <>
            <ActionButton onClick={() => toast('Bulk update applied')}>Bulk Update</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('New task added')}>Add Task</ActionButton>
          </>
        }
      />

      <Card>
        <FilterTabs tabs={workboardTabs} active={tab} onChange={setTab} />
        <div style={{ marginTop: 10 }}>
          {filtered.length === 0 ? (
            <div className="xs-empty">Nothing in this lane.</div>
          ) : (
            filtered.map((t) => (
              <div key={t.id} className={`xs-task${t.priority === 'Revenue Blocker' ? ' xs-task--blocker' : ''}`}>
                <PriorityChip priority={t.priority} />
                <div>
                  <div className="xs-task__title">{t.title}</div>
                  <div className="xs-task__meta">
                    <span>{t.linkedType}: {t.linkedName}</span>
                    <span>· {t.assignee}</span>
                    <span>· {t.status}</span>
                  </div>
                </div>
                <div className="xs-task__right">
                  <span className={`xs-task__due${t.due === 'Now' ? ' xs-task__due--now' : ''}`}>{t.due}</span>
                  <div className="xs-task__quick">
                    <button type="button" className="xs-quickbtn" title="Mark done" onClick={() => markDone(t.id)}><CheckCircle2 size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Add note" onClick={() => toast(`Note added to "${t.title}"`)}><StickyNote size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Snooze" onClick={() => toast(`Snoozed "${t.title}"`)}><Timer size={15} /></button>
                    <button type="button" className="xs-quickbtn" title="Open linked" onClick={() => navigate(t.category === 'Sales' ? '/sales-pipeline' : t.category === 'Documents' ? '/documents' : '/horses')}><ArrowRight size={15} /></button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </>
  );
}
