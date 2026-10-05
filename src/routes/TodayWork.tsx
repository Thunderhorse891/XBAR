import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, EyeOff, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { useCloudStore } from '@/store/useCloudStore';
import { buildCareTasks, type CareTask, type CareTaskCategory } from '@/lib/careTasks';
import { formatDateLabel, localIsoDate } from '@/lib/format';
import { useDayKey } from '@/hooks/useDayKey';
import { track, events } from '@/lib/telemetry';
import {
  SNOOZE_CHOICES,
  addTaskDays,
  taskDeferralsKey,
  loadTaskDeferrals,
  taskIsDeferred,
  writeTaskDeferral,
  restoreTaskDeferrals,
  type TaskDeferrals,
} from '@/lib/taskDeferrals';
import './TodayWork.css';

const TABS: Array<'All' | CareTaskCategory> = ['All', 'Documents', 'Care', 'Sales'];
const priorityTone = { Blocker: 'danger', High: 'warning', Normal: 'neutral' } as const;

export default function TodayWork() {
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const userId = useCloudStore((state) => state.session?.user?.id ?? '');
  const localWorkspaceCreatedAt = useXbarStore((state) => state.workspaceProfile.setupCompleteAt);
  const storageKey = taskDeferralsKey(workspaceId, userId, localWorkspaceCreatedAt);
  return <TaskBoard key={storageKey} storageKey={storageKey} />;
}

function TaskBoard({ storageKey }: { storageKey: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const segment = searchParams.get('segment') || undefined;
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const [tab, setTab] = useState<'All' | CareTaskCategory>('All');
  const today = useDayKey();
  const allTasks = useMemo(
    () =>
      buildCareTasks(
        { horses, documents, ownershipRecords, expenseReceipts, salesLeads, segment },
        new Date(`${today}T12:00:00`),
      ),
    [horses, documents, ownershipRecords, expenseReceipts, salesLeads, segment, today],
  );
  const [deferrals, setDeferrals] = useState<TaskDeferrals>({});
  const [deferralError, setDeferralError] = useState(false);
  const observedTasks = useRef<{ segment: string | undefined; tasks: CareTask[] }>({ segment, tasks: [] });
  useEffect(() => {
    const previous = observedTasks.current;
    // Changing the group is navigation, not evidence that the other group's work ended.
    const previouslyObserved = previous.segment === segment ? previous.tasks : [];
    observedTasks.current = { segment, tasks: allTasks };
    const refresh = () => {
      try {
        setDeferrals(loadTaskDeferrals(window.localStorage, storageKey, allTasks, localIsoDate(), previouslyObserved));
      } catch {
        setDeferrals({});
        setDeferralError(true);
      }
    };
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(`${storageKey}:`)) refresh();
    };
    refresh();
    window.addEventListener('storage', changed);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('storage', changed);
      window.removeEventListener('focus', refresh);
    };
  }, [storageKey, allTasks, segment]);
  const [openTask, setOpenTask] = useState<CareTask | null>(null);
  // Never keep an obsolete action open after the source record changes.
  const open = allTasks.find((task) => task.id === openTask?.id && task.revision === openTask.revision) ?? null;
  useEffect(() => {
    if (openTask && !open) setOpenTask(null);
  }, [openTask, open]);
  const categoryTasks = allTasks.filter((task) => tab === 'All' || task.category === tab);
  const activeDeferrals = deferralError ? {} : deferrals;
  const hiddenTasks = categoryTasks.filter((task) => taskIsDeferred(activeDeferrals, task, today));
  const filtered = categoryTasks.filter((task) => !taskIsDeferred(activeDeferrals, task, today));
  const failure = () =>
    pushToast({
      title: 'Task not deferred',
      message:
        'Could not confirm saving the deferral in browser storage. The task remains visible here. Check site storage and try again.',
      tone: 'error',
    });
  const defer = (task: CareTask, days: number, kind: 'dismiss' | 'snooze') => {
    if (deferralError) {
      failure();
      return;
    }
    const currentDay = localIsoDate();
    const until = addTaskDays(currentDay, days);
    let result;
    try {
      result = writeTaskDeferral(window.localStorage, storageKey, task, until, currentDay);
    } catch {
      failure();
      return;
    }
    if (!result.ok) {
      failure();
      return;
    }
    setDeferrals((previous) => ({ ...previous, ...result.deferrals }));
    setOpenTask(null);
    track(kind === 'dismiss' ? events.taskDismissed : events.taskSnoozed, {
      id: task.id,
      category: task.category,
      until,
      scope: 'browser',
    });
    pushToast({
      title: kind === 'dismiss' ? 'Dismissed today' : 'Task snoozed',
      message: `Hidden on this browser until ${formatDateLabel(`${until}T12:00:00`)}. The linked work is still due.`,
      tone: 'success',
    });
  };
  const showDeferred = () => {
    let result;
    try {
      result = restoreTaskDeferrals(window.localStorage, storageKey, hiddenTasks, localIsoDate());
    } catch {
      result = { ok: false, restoredIds: [] as string[] };
    }
    setDeferrals((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([id]) => !result.restoredIds.includes(id))),
    );
    if (!result.ok)
      pushToast({
        title: 'Could not restore all tasks',
        message: `${result.restoredIds.length} restored. Could not confirm the remaining tasks in browser storage. Reload to check their status, then retry if needed.`,
        tone: 'error',
      });
  };

  return (
    <>
      <PageHead
        eyebrow="Daily work"
        title="Care Tasks"
        subtitle="Documents to finish, care that's due, and buyer follow-ups due today or earlier. Deferrals are saved on this browser only."
        actions={
          <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
            Add Horse
          </ActionButton>
        }
      />
      {deferralError ? (
        <Card>
          <p role="status">
            Task preferences could not be verified. Due tasks are shown without deferrals in this tab. Check site
            storage before reloading; older saved deferrals may return if cleanup was not saved.
          </p>
        </Card>
      ) : null}
      {horses.length === 0 && allTasks.length === 0 ? (
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <CheckCircle2 size={26} />
            </span>
            <div className="xs-empty__title">Nothing to do yet</div>
            <div className="xs-empty__sub">
              Add your horses and their documents. XBAR will show you what care is due and what needs finishing before a
              sale.
            </div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>
              Add first horse
            </ActionButton>
          </div>
        </Card>
      ) : (
        <>
          <div className="xs-stickybar" role="group" aria-label="Task filters">
            {segment ? (
              <div className="care-task-group-filter">
                <span>Group: {segment}</span>
                <button
                  type="button"
                  className="xs-fchip"
                  aria-label="Clear group filter"
                  onClick={() => {
                    const next = new URLSearchParams(searchParams);
                    next.delete('segment');
                    setSearchParams(next);
                  }}
                >
                  All groups
                </button>
              </div>
            ) : null}
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
            {hiddenTasks.length ? (
              <button type="button" className="xs-fchip" onClick={showDeferred}>
                {hiddenTasks.length} deferred · Show
              </button>
            ) : null}
            <span className="xs-card__sub">
              {filtered.length} task{filtered.length === 1 ? '' : 's'}
            </span>
          </div>
          <Card>
            {filtered.length === 0 ? (
              <div className="xs-empty">
                {hiddenTasks.length
                  ? 'All remaining tasks in this view are deferred on this browser.'
                  : 'No tasks due in this view.'}
              </div>
            ) : (
              filtered.map((t) => (
                <div
                  key={t.id}
                  className={`xs-task care-task-row${t.priority === 'Blocker' ? ' xs-task--blocker' : ''}`}
                >
                  <StatusChip tone={priorityTone[t.priority]}>
                    {t.priority === 'Blocker' ? 'Cannot sell yet' : t.priority}
                  </StatusChip>
                  <button
                    type="button"
                    className="xs-fieldbtn care-task-opener"
                    aria-label={`Open task: ${t.title}`}
                    onClick={() => setOpenTask(t)}
                  >
                    <span className="xs-task__title">{t.title}</span>
                    <span className="xs-task__meta">{t.detail}</span>
                  </button>
                  <div className="xs-task__right">
                    <span className="xs-task__due">{t.due}</span>
                    <button
                      type="button"
                      className="xs-quickbtn"
                      title="Dismiss today on this browser"
                      aria-label={`Dismiss today: ${t.title}`}
                      disabled={deferralError}
                      onClick={() => defer(t, 1, 'dismiss')}
                    >
                      <EyeOff size={15} />
                    </button>
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
        onClose={() => setOpenTask(null)}
        footer={
          open ? (
            <>
              <ActionButton disabled={deferralError} onClick={() => defer(open, 1, 'dismiss')}>
                Dismiss today
              </ActionButton>
              <ActionButton
                variant="primary"
                icon={<ArrowRight size={15} />}
                onClick={() => {
                  setOpenTask(null);
                  navigate(open.to);
                }}
              >
                {open.actionLabel}
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
            <p className="xs-muted">{open.detail}</p>
            <p className="xs-muted">
              Complete the work in its linked record to clear this task. Dismissing or snoozing only hides it on this
              browser. A changed task returns for review.
            </p>
            <div className="xs-field">
              <span className="xs-section-label">Snooze until</span>
              <div className="xs-fchips">
                {SNOOZE_CHOICES.map((choice) => (
                  <button
                    key={choice.days}
                    type="button"
                    className="xs-fchip"
                    disabled={deferralError}
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
