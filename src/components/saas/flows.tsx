import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  CircleAlert,
  FileUp,
  ShieldCheck,
  Upload,
} from 'lucide-react';
import { ActionButton, SlideOverDrawer, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { events, track } from '@/lib/telemetry';
import type { ExpenseCategory, HorseSegment, HorseSex, HorseStatus } from '@/types/xbar';
import {
  resolvedBlockers,
  saasHorses,
  type WorkTask,
} from '@/data/xbarSaasMock';

/* ----------------------------------------------------------- Form fields */
export function Text({ label, placeholder, value, onChange, hint }: { label: string; placeholder?: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <input className="xs-input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="xs-field-hint">{hint}</span> : null}
    </label>
  );
}
export function Area({ label, placeholder, value, onChange }: { label: string; placeholder?: string; value: string; onChange: (v: string) => void }) {
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <textarea className="xs-textarea" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
export function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <select className="xs-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

/* --------------------------------------------------------------- Stepper */
export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="xs-stepper">
      {steps.map((s, i) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span className={`xs-stepper__step${i === current ? ' xs-stepper__step--active' : ''}${i < current ? ' xs-stepper__step--done' : ''}`}>
            <span className="xs-stepper__num">{i < current ? <Check size={13} /> : i + 1}</span>
            {s}
          </span>
          {i < steps.length - 1 ? <span className="xs-stepper__bar" /> : null}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------- Global Create (drawer) */
export type CreateKey =
  | 'Add Animal' | 'Add Task' | 'Upload Document' | 'Add Health Record' | 'Move Animals'
  | 'Create Sale Packet' | 'Invite Buyer' | 'Add Expense' | 'Add Equipment' | 'Report Pasture Issue';

export const createActions: CreateKey[] = [
  'Add Animal', 'Add Task', 'Upload Document', 'Add Health Record', 'Move Animals',
  'Create Sale Packet', 'Invite Buyer', 'Add Expense', 'Add Equipment', 'Report Pasture Issue',
];

const locationNames = ['Main Barn', 'North Pasture', 'South Pasture', 'Foaling Pen', 'Quarantine Pen', 'Round Pen'];

const SEGMENT_OPTIONS: HorseSegment[] = ['Sale Prospect', 'Broodmare', 'Stud', 'Show String', 'Young Stock', 'Retired'];
const SEX_OPTIONS: HorseSex[] = ['Mare', 'Stud', 'Gelding', 'Filly', 'Colt'];
const SEGMENT_STATUS: Record<HorseSegment, HorseStatus> = {
  'Sale Prospect': 'Sale Prep',
  Broodmare: 'Broodmare Program',
  Stud: 'In Training',
  'Show String': 'In Training',
  'Young Stock': 'Pasture',
  Retired: 'Retired',
};
const EXPENSE_CATEGORIES: ExpenseCategory[] = ['Feed', 'Vet Care', 'Farrier', 'Wormer', 'Dental Float', 'Supplements', 'Bedding', 'Travel'];

export function GlobalCreateDrawer({ action, onClose }: { action: CreateKey | null; onClose: () => void }) {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const workspaceProfile = useXbarStore((s) => s.workspaceProfile);
  const addHorse = useXbarStore((s) => s.addHorse);
  const addExpenseReceipt = useXbarStore((s) => s.addExpenseReceipt);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));

  const animalNames = horses.length ? horses.map((h) => h.name) : saasHorses.map((h) => h.name);

  if (!action) return null;

  const submit = (msg: string, go?: string) => {
    track(events.createSubmitted, { action });
    pushToast({ title: action, message: msg, tone: 'success' });
    setF({});
    onClose();
    if (go) navigate(go);
  };

  const submitAnimal = () => {
    const name = (f.name ?? '').trim();
    if (name.length < 2) {
      pushToast({ title: 'Add Animal', message: 'Enter a name to add the animal.', tone: 'warning' });
      return;
    }
    const segment = (f.segment as HorseSegment) ?? 'Sale Prospect';
    const owner = (f.owner ?? '').trim() || workspaceProfile.defaultOwnerName || workspaceProfile.businessName || 'Ranch owner';
    const ownerEntity = workspaceProfile.defaultOwnerEntity || workspaceProfile.businessName || owner;
    const result = addHorse({
      name,
      barnName: (f.barnName ?? '').trim() || name,
      segment,
      status: SEGMENT_STATUS[segment] ?? 'In Training',
      sex: (f.sex as HorseSex) ?? 'Mare',
      owner,
      ownerEntity,
      barn: f.loc ?? workspaceProfile.defaultBarn ?? locationNames[0],
      pasture: workspaceProfile.defaultPasture ?? '',
    });
    track(events.createSubmitted, { action });
    if (result.ok) {
      pushToast({ title: 'Add Animal', message: `${name} added to the herd`, tone: 'success' });
      setF({});
      onClose();
      navigate(result.id ? `/animals/${result.id}` : '/animals');
    } else {
      pushToast({ title: 'Add Animal', message: result.message, tone: 'warning' });
    }
  };

  const submitExpense = async () => {
    const desc = (f.desc ?? '').trim();
    const amount = Number.parseFloat((f.amt ?? '').replace(/[^0-9.]/g, ''));
    if (desc.length < 2 || !Number.isFinite(amount) || amount <= 0) {
      pushToast({ title: 'Add Expense', message: 'Enter a description and a valid amount.', tone: 'warning' });
      return;
    }
    setBusy(true);
    const result = await addExpenseReceipt({
      title: desc,
      category: (f.cat as ExpenseCategory) ?? 'Feed',
      vendor: (f.vendor ?? '').trim() || 'General',
      amount,
      receiptDate: new Date().toISOString().slice(0, 10),
      uploadedBy: workspaceProfile.ranchManagerName || 'Ranch manager',
    });
    setBusy(false);
    track(events.createSubmitted, { action });
    if (result.ok) {
      pushToast({ title: 'Add Expense', message: 'Expense logged', tone: 'success' });
      setF({});
      onClose();
      navigate('/expenses');
    } else {
      pushToast({ title: 'Add Expense', message: result.message, tone: 'warning' });
    }
  };

  let body: ReactNode = null;
  let footer: ReactNode = null;

  switch (action) {
    case 'Add Animal':
      body = (
        <div className="xs-form">
          <Text label="Name" placeholder="e.g. THR Copper Canyon" value={f.name ?? ''} onChange={set('name')} />
          <Pick label="Segment" value={f.segment ?? 'Sale Prospect'} onChange={set('segment')} options={SEGMENT_OPTIONS} />
          <Pick label="Sex" value={f.sex ?? 'Mare'} onChange={set('sex')} options={SEX_OPTIONS} />
          <Text label="Owner" placeholder={workspaceProfile.defaultOwnerName || 'Legal owner'} value={f.owner ?? ''} onChange={set('owner')} hint="Defaults to the workspace owner if left blank." />
          <Pick label="Location" value={f.loc ?? workspaceProfile.defaultBarn ?? locationNames[0]} onChange={set('loc')} options={locationNames} />
        </div>
      );
      footer = <ActionButton variant="primary" onClick={submitAnimal}>Add Animal</ActionButton>;
      break;
    case 'Add Task':
      body = (
        <div className="xs-form">
          <Text label="Task" placeholder="e.g. Move mares to South Trap" value={f.title ?? ''} onChange={set('title')} />
          <Pick label="Priority" value={f.priority ?? 'High'} onChange={set('priority')} options={['Revenue Blocker', 'High', 'Medium', 'Normal']} />
          <Pick label="Assign to" value={f.assignee ?? 'Erin W.'} onChange={set('assignee')} options={['Erin W.', 'Cody R.', 'Dr. Hale']} />
          <Text label="Due" placeholder="Today 6:00 PM" value={f.due ?? ''} onChange={set('due')} />
        </div>
      );
      footer = <ActionButton variant="primary" onClick={() => submit(`Task created: ${f.title || 'New task'}`, '/today')}>Create Task</ActionButton>;
      break;
    case 'Upload Document':
      body = (
        <div className="xs-form">
          <div className="xs-drop"><FileUp size={20} style={{ display: 'block', margin: '0 auto 8px' }} />Drop a file or click to browse (PDF, JPG)</div>
          <Pick label="Document type" value={f.type ?? 'Health Certificate'} onChange={set('type')} options={['Health Certificate', 'Coggins', 'Registration', 'Bill of Sale', 'Photos', 'Contract']} />
          <Pick label="Link to animal" value={f.animal ?? animalNames[0]} onChange={set('animal')} options={animalNames} />
          <Text label="Expiration date" placeholder="YYYY-MM-DD" value={f.exp ?? ''} onChange={set('exp')} />
        </div>
      );
      footer = <ActionButton variant="primary" onClick={() => submit(`${f.type || 'Document'} uploaded`, '/documents-vault')}>Upload</ActionButton>;
      break;
    case 'Add Health Record':
      body = (
        <div className="xs-form">
          <Pick label="Animal" value={f.animal ?? animalNames[0]} onChange={set('animal')} options={animalNames} />
          <Pick label="Record type" value={f.type ?? 'Vaccine'} onChange={set('type')} options={['Vaccine', 'Deworming', 'Coggins', 'Dental', 'Farrier', 'Vet visit', 'Medication']} />
          <Text label="Date" placeholder="YYYY-MM-DD" value={f.date ?? ''} onChange={set('date')} />
          <Area label="Notes" placeholder="Withdrawal date, dosage, vet…" value={f.notes ?? ''} onChange={set('notes')} />
        </div>
      );
      footer = <ActionButton variant="primary" onClick={() => submit('Health record added')}>Add Record</ActionButton>;
      break;
    case 'Move Animals':
      body = (
        <div className="xs-form">
          <Pick label="From" value={f.from ?? locationNames[1]} onChange={set('from')} options={locationNames} />
          <Pick label="To" value={f.to ?? locationNames[2]} onChange={set('to')} options={locationNames} />
          <Text label="How many" placeholder="e.g. 14" value={f.count ?? ''} onChange={set('count')} />
        </div>
      );
      footer = <ActionButton variant="primary" onClick={() => submit(`Moved ${f.count || 'animals'} → ${f.to || 'new location'}`, '/pastures')}>Move Animals</ActionButton>;
      break;
    case 'Create Sale Packet':
      body = <div className="xs-form"><Pick label="Animal" value={f.animal ?? animalNames[0]} onChange={set('animal')} options={animalNames} /><Pick label="Packet type" value={f.type ?? 'Buyer Review Packet'} onChange={set('type')} options={['Sale Prospect Packet', 'Buyer Review Packet', 'Release Packet', 'Vet/Transport Packet']} /></div>;
      footer = <ActionButton variant="primary" onClick={() => submit('Opening Sale Packet Builder', '/sale-packet-studio')}>Open Builder</ActionButton>;
      break;
    case 'Invite Buyer':
      body = <div className="xs-form"><Text label="Buyer name" placeholder="e.g. Marlow Ranch Partners" value={f.name ?? ''} onChange={set('name')} /><Text label="Email" placeholder="buyer@email.com" value={f.email ?? ''} onChange={set('email')} /><Pick label="Animal" value={f.animal ?? animalNames[0]} onChange={set('animal')} options={animalNames} /></div>;
      footer = <ActionButton variant="primary" onClick={() => submit(`Invite sent to ${f.name || 'buyer'}`, '/buyer-deal-room')}>Send Invite</ActionButton>;
      break;
    case 'Add Expense':
      body = <div className="xs-form"><Text label="Description" placeholder="Feed, vet, farrier…" value={f.desc ?? ''} onChange={set('desc')} /><Text label="Vendor" placeholder="e.g. Tractor Supply" value={f.vendor ?? ''} onChange={set('vendor')} /><Text label="Amount" placeholder="$" value={f.amt ?? ''} onChange={set('amt')} /><Pick label="Category" value={f.cat ?? 'Feed'} onChange={set('cat')} options={EXPENSE_CATEGORIES} /></div>;
      footer = <ActionButton variant="primary" disabled={busy} onClick={submitExpense}>{busy ? 'Adding…' : 'Add Expense'}</ActionButton>;
      break;
    case 'Add Equipment':
      body = <div className="xs-form"><Text label="Equipment" placeholder="e.g. Stock trailer (24ft)" value={f.name ?? ''} onChange={set('name')} /><Pick label="Type" value={f.type ?? 'Trailer'} onChange={set('type')} options={['Truck', 'Trailer', 'Tractor', 'UTV', 'Tack', 'Feeder', 'Water trough', 'Tool']} /><Pick label="Location" value={f.loc ?? locationNames[0]} onChange={set('loc')} options={locationNames} /></div>;
      footer = <ActionButton variant="primary" onClick={() => submit(`${f.name || 'Equipment'} added`, '/assets')}>Add Equipment</ActionButton>;
      break;
    case 'Report Pasture Issue':
      body = <div className="xs-form"><Pick label="Location" value={f.loc ?? locationNames[1]} onChange={set('loc')} options={locationNames} /><Pick label="Issue" value={f.issue ?? 'Water trough'} onChange={set('issue')} options={['Water trough', 'Fence / gate', 'Grazing pressure', 'Flooding', 'Other']} /><Area label="Details" placeholder="What did you see?" value={f.notes ?? ''} onChange={set('notes')} /></div>;
      footer = <ActionButton variant="primary" onClick={() => submit(`Issue reported at ${f.loc || 'location'}`, '/pastures')}>Report Issue</ActionButton>;
      break;
  }

  return (
    <SlideOverDrawer open title={action} subtitle="Quick create" onClose={onClose} footer={<><ActionButton onClick={onClose}>Cancel</ActionButton>{footer}</>}>
      {body}
    </SlideOverDrawer>
  );
}

/* ------------------------------------------------- Resolve Blocker wizard */
const blockerSteps = ['Identify', 'Fix data', 'Validate', 'Readiness', 'Return'];

export function ResolveBlockerWizard({
  open,
  onClose,
  horse = 'RHA Pine Barrel Prospect',
  horseId = 'rha-pine-barrel-prospect',
  amount = 35000,
}: {
  open: boolean;
  onClose: () => void;
  horse?: string;
  horseId?: string;
  amount?: number;
}) {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const [step, setStep] = useState(0);
  const [exp, setExp] = useState('');

  const close = () => { setStep(0); setExp(''); onClose(); };
  const next = () => setStep((s) => Math.min(s + 1, blockerSteps.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const canAdvance = step !== 1 || exp.trim().length > 0;

  return (
    <SlideOverDrawer
      open={open}
      title="Resolve Blocker"
      subtitle={`${horse} · $${amount.toLocaleString()} target sale`}
      onClose={close}
      footer={
        step < blockerSteps.length - 1 ? (
          <>
            {step > 0 ? <ActionButton onClick={back}>Back</ActionButton> : <ActionButton onClick={close}>Cancel</ActionButton>}
            <ActionButton variant="primary" disabled={!canAdvance} onClick={next}>Continue</ActionButton>
          </>
        ) : (
          <>
            <ActionButton onClick={close}>Close</ActionButton>
            <ActionButton variant="primary" icon={<ArrowRight size={15} />} onClick={() => { resolvedBlockers.add(horseId); track(events.blockerResolved, { horse, horseId, amount }); pushToast({ title: 'Blocker resolved', message: `${horse} is now release-ready`, tone: 'success' }); close(); navigate('/sale-packet-studio'); }}>Open Sale Packet</ActionButton>
          </>
        )
      }
    >
      <Stepper steps={blockerSteps} current={step} />

      {step === 0 ? (
        <>
          <div className="xs-railcard" style={{ borderColor: 'rgba(185,71,62,0.35)', background: 'var(--xbar-danger-soft)' }}>
            <div className="xs-section-label" style={{ color: 'var(--xbar-danger)' }}>Blocker</div>
            <div style={{ fontWeight: 700 }}>Health certificate expiration date missing</div>
          </div>
          <dl className="xs-kv">
            <dt>Linked horse</dt><dd>{horse}</dd>
            <dt>Linked document</dt><dd>Health Certificate</dd>
            <dt>Affected sale</dt><dd>${amount.toLocaleString()}</dd>
            <dt>Active buyers</dt><dd>2</dd>
          </dl>
          <p className="xs-muted" style={{ fontSize: 13, margin: 0 }}>Fix this one field and the sale can move to a buyer-ready sharing state.</p>
        </>
      ) : null}

      {step === 1 ? (
        <>
          <div className="xs-section-label">Step 2 · Add the missing field</div>
          <Text label="Health certificate expiration date" placeholder="YYYY-MM-DD" value={exp} onChange={setExp} hint="Required before sharing with a buyer." />
          <div className="xs-drop"><Upload size={18} style={{ display: 'block', margin: '0 auto 6px' }} />Or re-upload the corrected certificate</div>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <div className="xs-section-label">Step 3 · Validate required data</div>
          <dl className="xs-kv">
            <dt>Expiration date</dt><dd>{exp || '—'} <StatusChip tone="success">Valid</StatusChip></dd>
            <dt>Coggins</dt><dd>Current <StatusChip tone="success">OK</StatusChip></dd>
            <dt>Registration</dt><dd>On file <StatusChip tone="success">OK</StatusChip></dd>
            <dt>Ownership chain</dt><dd>Complete <StatusChip tone="success">OK</StatusChip></dd>
          </dl>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <div className="xs-section-label">Step 4 · Sale readiness updated</div>
          <div className="xs-okbanner"><ShieldCheck size={16} /> Readiness raised to 100% - Share With Buyer verified</div>
          <dl className="xs-kv">
            <dt>Before</dt><dd>94% · Blocked</dd>
            <dt>After</dt><dd>100% · Release ready</dd>
          </dl>
        </>
      ) : null}

      {step === 4 ? (
        <div className="xs-okbanner"><Check size={16} /> Blocker cleared. {horse} can move forward to its sale packet and buyer folder.</div>
      ) : null}
    </SlideOverDrawer>
  );
}

/* --------------------------------------------------------------- Task drawer */
export function TaskDrawer({ task, onClose, onResolveBlocker }: { task: WorkTask | null; onClose: () => void; onResolveBlocker: () => void }) {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  if (!task) return null;
  const isBlocker = task.priority === 'Revenue Blocker';
  const toast = (m: string) => pushToast({ title: 'Task', message: m, tone: 'success' });

  return (
    <SlideOverDrawer
      open
      title={task.title}
      subtitle={`${task.linkedType}: ${task.linkedName}`}
      onClose={onClose}
      footer={
        isBlocker ? (
          <>
            <ActionButton onClick={onClose}>Close</ActionButton>
            <ActionButton variant="primary" icon={<CircleAlert size={15} />} onClick={onResolveBlocker}>Resolve Blocker</ActionButton>
          </>
        ) : (
          <>
            <ActionButton onClick={() => { toast('Snoozed'); onClose(); }}>Snooze</ActionButton>
            <ActionButton variant="primary" icon={<Check size={15} />} onClick={() => { track(events.taskCompleted, { id: task.id, category: task.category }); toast(`Completed: ${task.title}`); onClose(); }}>Mark Done</ActionButton>
          </>
        )
      }
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <StatusChip tone={isBlocker ? 'danger' : task.priority === 'High' ? 'warning' : 'neutral'}>{task.priority}</StatusChip>
        <span className="xs-chip xs-chip--neutral">{task.status}</span>
      </div>

      {isBlocker ? (
        <div className="xs-railcard" style={{ borderColor: 'rgba(185,71,62,0.35)', background: 'var(--xbar-danger-soft)' }}>
          <div className="xs-section-label" style={{ color: 'var(--xbar-danger)' }}>Revenue blocker</div>
          <dl className="xs-kv">
            <dt>Reason</dt><dd>Health certificate expiration date missing</dd>
            <dt>Affected sale</dt><dd>$35,000</dd>
            <dt>Linked horse</dt><dd>RHA Pine Barrel Prospect</dd>
            <dt>Linked document</dt><dd>Health Certificate</dd>
          </dl>
        </div>
      ) : null}

      <dl className="xs-kv">
        <dt>Priority</dt><dd>{task.priority}</dd>
        <dt>Due</dt><dd>{task.due}</dd>
        <dt>Assigned to</dt><dd>{task.assignee}</dd>
        <dt>Linked record</dt><dd>{task.linkedType}: {task.linkedName}</dd>
      </dl>

      <div>
        <div className="xs-section-label">Notes</div>
        <Area label="" placeholder="Add a note for the crew…" value="" onChange={(v) => v && toast('Note saved')} />
      </div>

      <div>
        <div className="xs-section-label">Activity</div>
        <div className="xs-tl">
          <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Task created</div><div className="xs-tl__time">Today · 7:02 AM · system</div></span></div>
          <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Assigned to {task.assignee}</div><div className="xs-tl__time">Today · 7:03 AM</div></span></div>
        </div>
      </div>

      <div className="xs-field">
        <button type="button" className="xs-fieldbtn" onClick={() => toast('Reassigned')}>Assign</button>
        <button type="button" className="xs-fieldbtn" onClick={() => { onClose(); navigate(task.category === 'Sales' ? '/sales-pipeline' : task.category === 'Documents' ? '/documents-vault' : '/horses'); }}>Open Linked Record</button>
      </div>
    </SlideOverDrawer>
  );
}
