import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileUp } from 'lucide-react';
import { ActionButton, SlideOverDrawer } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { events, track } from '@/lib/telemetry';
import type { ExpenseCategory, HorseSegment, HorseSex, HorseStatus } from '@/types/xbar';

/* ----------------------------------------------------------- Form fields */
export function Text({
  label,
  placeholder,
  value,
  onChange,
  hint,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <input className="xs-input" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="xs-field-hint">{hint}</span> : null}
    </label>
  );
}
export function Area({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <textarea
        className="xs-textarea"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
export function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <select className="xs-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
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
          <span
            className={`xs-stepper__step${i === current ? ' xs-stepper__step--active' : ''}${i < current ? ' xs-stepper__step--done' : ''}`}
          >
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
  | 'Add Horse'
  | 'Add Task'
  | 'Upload Document'
  | 'Add Health Record'
  | 'Move Horses'
  | 'Prepare Sale Packet'
  | 'Add Buyer Follow-up'
  | 'Add Expense'
  | 'Add Equipment'
  | 'Report Pasture Issue';

export const createActions: CreateKey[] = [
  'Add Horse',
  'Add Task',
  'Upload Document',
  'Add Health Record',
  'Move Horses',
  'Prepare Sale Packet',
  'Add Buyer Follow-up',
  'Add Expense',
  'Add Equipment',
  'Report Pasture Issue',
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
const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Feed',
  'Vet Care',
  'Farrier',
  'Wormer',
  'Dental Float',
  'Supplements',
  'Bedding',
  'Travel',
];

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

  const horseNames = horses.length ? horses.map((h) => h.name) : ['(add a horse first)'];

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
      pushToast({ title: 'Add Horse', message: 'Enter a name to add the horse.', tone: 'warning' });
      return;
    }
    const segment = (f.segment as HorseSegment) ?? 'Sale Prospect';
    const owner =
      (f.owner ?? '').trim() || workspaceProfile.defaultOwnerName || workspaceProfile.businessName || 'Ranch owner';
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
      pushToast({ title: 'Add Horse', message: `${name} added to the herd`, tone: 'success' });
      setF({});
      onClose();
      navigate(result.id ? `/horses/${result.id}` : '/horses');
    } else {
      pushToast({ title: 'Add Horse', message: result.message, tone: 'warning' });
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
    case 'Add Horse':
      body = (
        <div className="xs-form">
          <Text label="Name" placeholder="e.g. THR Copper Canyon" value={f.name ?? ''} onChange={set('name')} />
          <Pick
            label="Segment"
            value={f.segment ?? 'Sale Prospect'}
            onChange={set('segment')}
            options={SEGMENT_OPTIONS}
          />
          <Pick label="Sex" value={f.sex ?? 'Mare'} onChange={set('sex')} options={SEX_OPTIONS} />
          <Text
            label="Owner"
            placeholder={workspaceProfile.defaultOwnerName || 'Legal owner'}
            value={f.owner ?? ''}
            onChange={set('owner')}
            hint="Defaults to the workspace owner if left blank."
          />
          <Pick
            label="Location"
            value={f.loc ?? workspaceProfile.defaultBarn ?? locationNames[0]}
            onChange={set('loc')}
            options={locationNames}
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitAnimal}>
          Add Horse
        </ActionButton>
      );
      break;
    case 'Add Task':
      body = (
        <div className="xs-form">
          <Text
            label="Task"
            placeholder="e.g. Move mares to South Trap"
            value={f.title ?? ''}
            onChange={set('title')}
          />
          <Pick
            label="Priority"
            value={f.priority ?? 'High'}
            onChange={set('priority')}
            options={['Revenue Blocker', 'High', 'Medium', 'Normal']}
          />
          <Pick
            label="Assign to"
            value={f.assignee ?? 'Erin W.'}
            onChange={set('assignee')}
            options={['Erin W.', 'Cody R.', 'Dr. Hale']}
          />
          <Text label="Due" placeholder="Today 6:00 PM" value={f.due ?? ''} onChange={set('due')} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={() => submit(`Task created: ${f.title || 'New task'}`, '/today')}>
          Create Task
        </ActionButton>
      );
      break;
    case 'Upload Document':
      body = (
        <div className="xs-form">
          <div className="xs-drop">
            <FileUp size={20} style={{ display: 'block', margin: '0 auto 8px' }} />
            Drop a file or click to browse (PDF, JPG)
          </div>
          <Pick
            label="Document type"
            value={f.type ?? 'Health Certificate'}
            onChange={set('type')}
            options={['Health Certificate', 'Coggins', 'Registration', 'Bill of Sale', 'Photos', 'Contract']}
          />
          <Pick label="Link to horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
          <Text label="Expiration date" placeholder="YYYY-MM-DD" value={f.exp ?? ''} onChange={set('exp')} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={() => submit(`${f.type || 'Document'} uploaded`, '/documents')}>
          Upload
        </ActionButton>
      );
      break;
    case 'Add Health Record':
      body = (
        <div className="xs-form">
          <Pick label="Horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
          <Pick
            label="Record type"
            value={f.type ?? 'Vaccine'}
            onChange={set('type')}
            options={['Vaccine', 'Deworming', 'Coggins', 'Dental', 'Farrier', 'Vet visit', 'Medication']}
          />
          <Text label="Date" placeholder="YYYY-MM-DD" value={f.date ?? ''} onChange={set('date')} />
          <Area
            label="Notes"
            placeholder="Withdrawal date, dosage, vet…"
            value={f.notes ?? ''}
            onChange={set('notes')}
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={() => submit('Health record added')}>
          Add Record
        </ActionButton>
      );
      break;
    case 'Move Horses':
      body = (
        <div className="xs-form">
          <Pick label="From" value={f.from ?? locationNames[1]} onChange={set('from')} options={locationNames} />
          <Pick label="To" value={f.to ?? locationNames[2]} onChange={set('to')} options={locationNames} />
          <Text label="How many" placeholder="e.g. 14" value={f.count ?? ''} onChange={set('count')} />
        </div>
      );
      footer = (
        <ActionButton
          variant="primary"
          onClick={() => submit(`Moved ${f.count || 'horses'} → ${f.to || 'new location'}`, '/pastures')}
        >
          Move Horses
        </ActionButton>
      );
      break;
    case 'Prepare Sale Packet':
      body = (
        <div className="xs-form">
          <Pick label="Horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
          <Pick
            label="Packet type"
            value={f.type ?? 'Buyer review packet'}
            onChange={set('type')}
            options={['Sale packet', 'Buyer review packet', 'Release packet', 'Vet and travel packet']}
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={() => submit('Opening sale packets', '/sale-packets')}>
          Open Sale Packets
        </ActionButton>
      );
      break;
    case 'Add Buyer Follow-up':
      body = (
        <div className="xs-form">
          <Text
            label="Buyer name"
            placeholder="e.g. Marlow Ranch Partners"
            value={f.name ?? ''}
            onChange={set('name')}
          />
          <Text label="Email" placeholder="buyer@email.com" value={f.email ?? ''} onChange={set('email')} />
          <Pick label="Horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
        </div>
      );
      footer = (
        <ActionButton
          variant="primary"
          onClick={() => submit(`Open sales to save follow-up for ${f.name || 'buyer'}`, '/sales')}
        >
          Open sales
        </ActionButton>
      );
      break;
    case 'Add Expense':
      body = (
        <div className="xs-form">
          <Text label="Description" placeholder="Feed, vet, farrier…" value={f.desc ?? ''} onChange={set('desc')} />
          <Text label="Vendor" placeholder="e.g. Tractor Supply" value={f.vendor ?? ''} onChange={set('vendor')} />
          <Text label="Amount" placeholder="$" value={f.amt ?? ''} onChange={set('amt')} />
          <Pick label="Category" value={f.cat ?? 'Feed'} onChange={set('cat')} options={EXPENSE_CATEGORIES} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" disabled={busy} onClick={submitExpense}>
          {busy ? 'Adding…' : 'Add Expense'}
        </ActionButton>
      );
      break;
    case 'Add Equipment':
      body = (
        <div className="xs-form">
          <Text label="Equipment" placeholder="e.g. Stock trailer (24ft)" value={f.name ?? ''} onChange={set('name')} />
          <Pick
            label="Type"
            value={f.type ?? 'Trailer'}
            onChange={set('type')}
            options={['Truck', 'Trailer', 'Tractor', 'UTV', 'Tack', 'Feeder', 'Water trough', 'Tool']}
          />
          <Pick label="Location" value={f.loc ?? locationNames[0]} onChange={set('loc')} options={locationNames} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={() => submit(`${f.name || 'Equipment'} added`, '/assets')}>
          Add Equipment
        </ActionButton>
      );
      break;
    case 'Report Pasture Issue':
      body = (
        <div className="xs-form">
          <Pick label="Location" value={f.loc ?? locationNames[1]} onChange={set('loc')} options={locationNames} />
          <Pick
            label="Issue"
            value={f.issue ?? 'Water trough'}
            onChange={set('issue')}
            options={['Water trough', 'Fence / gate', 'Grazing pressure', 'Flooding', 'Other']}
          />
          <Area label="Details" placeholder="What did you see?" value={f.notes ?? ''} onChange={set('notes')} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={() => submit(`Issue reported at ${f.loc || 'location'}`, '/pastures')}>
          Report Issue
        </ActionButton>
      );
      break;
  }

  return (
    <SlideOverDrawer
      open
      title={action}
      subtitle="Quick create"
      onClose={onClose}
      footer={
        <>
          <ActionButton onClick={onClose}>Cancel</ActionButton>
          {footer}
        </>
      }
    >
      {body}
    </SlideOverDrawer>
  );
}
