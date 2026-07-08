import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileUp } from 'lucide-react';
import { ActionButton, SlideOverDrawer } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { events, track } from '@/lib/telemetry';
import type {
  AssetCategory,
  ExpenseCategory,
  HorseSegment,
  HorseSex,
  HorseStatus,
  MedicalEventType,
  SalesLead,
} from '@/types/xbar';

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
const MEDICAL_EVENT_TYPES: MedicalEventType[] = [
  'Vaccine',
  'Deworming',
  'Coggins',
  'Dental',
  'Vet visit',
  'Treatment',
  'Injury',
];
const ASSET_CATEGORIES: AssetCategory[] = ['Equipment', 'Transport', 'Tack', 'Medical Kit', 'Feed & Supply'];
const LEAD_CHANNELS: SalesLead['channel'][] = ['Referral', 'Site Inquiry', 'Facebook', 'Instagram'];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function GlobalCreateDrawer() {
  const navigate = useNavigate();
  const action = useUiStore((s) => s.createAction);
  const prefill = useUiStore((s) => s.createPrefill);
  const closeCreate = useUiStore((s) => s.closeCreate);
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const workspaceProfile = useXbarStore((s) => s.workspaceProfile);
  const addHorse = useXbarStore((s) => s.addHorse);
  const addExpenseReceipt = useXbarStore((s) => s.addExpenseReceipt);
  const addMedicalEvent = useXbarStore((s) => s.addMedicalEvent);
  const addBreedingEvent = useXbarStore((s) => s.addBreedingEvent);
  const updateHorseLocation = useXbarStore((s) => s.updateHorseLocation);
  const addRanchAsset = useXbarStore((s) => s.addRanchAsset);
  const createSalesLead = useXbarStore((s) => s.createSalesLead);
  const createDocumentIntake = useXbarStore((s) => s.createDocumentIntake);
  const [f, setF] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));

  // Re-seed the form whenever a flow opens so route-level prefills
  // (horse name, expense category, record title) land in the fields.
  useEffect(() => {
    setF(prefill);
    setFiles([]);
    setBusy(false);
  }, [action, prefill]);

  const horseNames = horses.length ? horses.map((h) => h.name) : ['(add a horse first)'];
  const author =
    workspaceProfile.ranchManagerName ||
    workspaceProfile.defaultOwnerName ||
    workspaceProfile.businessName ||
    'Ranch manager';

  if (!action) return null;

  const onClose = closeCreate;
  const pickedHorse = () => horses.find((h) => h.name === (f.animal ?? horseNames[0])) ?? null;

  const warn = (message: string) => pushToast({ title: action, message, tone: 'warning' });

  const finish = (message: string, go?: string) => {
    track(events.createSubmitted, { action });
    pushToast({ title: action, message, tone: 'success' });
    setF({});
    setFiles([]);
    onClose();
    if (go) navigate(go);
  };

  const readDate = () => {
    const value = (f.date ?? '').trim();
    if (!value) return today();
    return ISO_DATE.test(value) ? value : null;
  };

  const submitAnimal = () => {
    const name = (f.name ?? '').trim();
    if (name.length < 2) {
      warn('Enter a name to add the horse.');
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
    if (result.ok) {
      finish(`${name} added to the herd`, result.id ? `/horses/${result.id}` : '/horses');
    } else {
      warn(result.message);
    }
  };

  const submitExpense = async () => {
    const desc = (f.desc ?? '').trim();
    const amount = Number.parseFloat((f.amt ?? '').replace(/[^0-9.]/g, ''));
    if (desc.length < 2 || !Number.isFinite(amount) || amount <= 0) {
      warn('Enter a description and a valid amount.');
      return;
    }
    setBusy(true);
    const result = await addExpenseReceipt({
      title: desc,
      category: (f.cat as ExpenseCategory) ?? 'Feed',
      vendor: (f.vendor ?? '').trim() || 'General',
      amount,
      receiptDate: today(),
      uploadedBy: author,
    });
    setBusy(false);
    if (result.ok) {
      finish('Expense logged', '/expenses');
    } else {
      warn(result.message);
    }
  };

  const submitHealthRecord = () => {
    const horse = pickedHorse();
    if (!horse) {
      warn('Add a horse first, then log health records against it.');
      return;
    }
    const date = readDate();
    if (!date) {
      warn('Enter the date as YYYY-MM-DD, or leave it blank for today.');
      return;
    }
    const type = (f.type as MedicalEventType) ?? 'Vaccine';
    const result = addMedicalEvent(horse.id, {
      title: (f.title ?? '').trim() || type,
      body: (f.notes ?? '').trim() || type,
      author,
      date,
      type,
    });
    if (result.ok) {
      finish(`${type} recorded for ${horse.name}`, `/horses/${horse.id}`);
    } else {
      warn(result.message);
    }
  };

  const submitBreedingRecord = () => {
    const horse = pickedHorse();
    if (!horse) {
      warn('Add a horse first, then log breeding records against it.');
      return;
    }
    const date = readDate();
    if (!date) {
      warn('Enter the date as YYYY-MM-DD, or leave it blank for today.');
      return;
    }
    const title = (f.title ?? '').trim();
    if (title.length < 2) {
      warn('Describe the milestone — e.g. Preg check, Cover date, Foaling watch.');
      return;
    }
    const result = addBreedingEvent(horse.id, {
      title,
      body: (f.notes ?? '').trim() || title,
      author,
      date,
    });
    if (result.ok) {
      finish(`${title} recorded for ${horse.name}`, '/breeding-foaling');
    } else {
      warn(result.message);
    }
  };

  const submitMoveHorse = () => {
    const horse = pickedHorse();
    if (!horse) {
      warn('Add a horse first, then move it between locations.');
      return;
    }
    const barn = (f.barn ?? '').trim();
    const pasture = (f.pasture ?? '').trim();
    if (!barn && !pasture) {
      warn('Enter the new barn, the new pasture, or both.');
      return;
    }
    const result = updateHorseLocation(horse.id, {
      ...(barn ? { barn } : {}),
      ...(pasture ? { pasture } : {}),
    });
    if (result.ok) {
      finish(`${horse.name} moved to ${[barn, pasture].filter(Boolean).join(' / ')}`, '/pastures');
    } else {
      warn(result.message);
    }
  };

  const submitEquipment = () => {
    const name = (f.name ?? '').trim();
    if (name.length < 2) {
      warn('Name the equipment to add it.');
      return;
    }
    const result = addRanchAsset({
      name,
      category: (f.cat as AssetCategory) ?? 'Equipment',
      location: f.loc ?? locationNames[0],
    });
    if (result.ok) {
      finish(`${name} added`, '/assets');
    } else {
      warn(result.message);
    }
  };

  const submitBuyerFollowUp = () => {
    const horse = pickedHorse();
    const name = (f.name ?? '').trim();
    if (name.length < 2) {
      warn('Enter the buyer name to save the follow-up.');
      return;
    }
    if (!horse) {
      warn('Add a horse first, then link buyer follow-ups to it.');
      return;
    }
    const result = createSalesLead({
      name,
      channel: (f.channel as SalesLead['channel']) ?? 'Referral',
      horseId: horse.id,
    });
    if (result.ok) {
      finish(`Follow-up saved for ${name}`, '/sales');
    } else {
      warn(result.message);
    }
  };

  const submitDocuments = async () => {
    if (!files.length) {
      warn('Choose at least one PDF or image to upload.');
      return;
    }
    const horse = pickedHorse();
    setBusy(true);
    const result = await createDocumentIntake({
      files,
      horseId: horse?.id,
      source: 'Manual Upload',
      uploadedBy: author,
    });
    setBusy(false);
    if (result.ok) {
      finish(`${files.length} file${files.length === 1 ? '' : 's'} queued for review`, '/documents');
    } else {
      warn(result.message);
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
    case 'Upload Document':
      body = (
        <div className="xs-form">
          <label>
            <span className="xs-field-label">Files</span>
            <input
              className="xs-input"
              type="file"
              multiple
              accept="application/pdf,image/*"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <span className="xs-field-hint">
              <FileUp size={12} style={{ display: 'inline', verticalAlign: '-2px' }} /> PDF or JPG — XBAR reads each
              file and queues it for review.
            </span>
          </label>
          <Pick label="Link to horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" disabled={busy} onClick={submitDocuments}>
          {busy ? 'Uploading…' : 'Upload'}
        </ActionButton>
      );
      break;
    case 'Add Health Record':
      body = (
        <div className="xs-form">
          <Pick label="Horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
          <Pick label="Record type" value={f.type ?? 'Vaccine'} onChange={set('type')} options={MEDICAL_EVENT_TYPES} />
          <Text
            label="Date"
            placeholder={today()}
            value={f.date ?? ''}
            onChange={set('date')}
            hint="Leave blank for today."
          />
          <Area
            label="Notes"
            placeholder="Withdrawal date, dosage, vet…"
            value={f.notes ?? ''}
            onChange={set('notes')}
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitHealthRecord}>
          Add Record
        </ActionButton>
      );
      break;
    case 'Add Breeding Record':
      body = (
        <div className="xs-form">
          <Pick label="Horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
          <Text
            label="Milestone"
            placeholder="e.g. Preg check, Cover date, Foaling watch"
            value={f.title ?? ''}
            onChange={set('title')}
          />
          <Text
            label="Date"
            placeholder={today()}
            value={f.date ?? ''}
            onChange={set('date')}
            hint="Leave blank for today."
          />
          <Area label="Notes" placeholder="Stallion, vet, result…" value={f.notes ?? ''} onChange={set('notes')} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitBreedingRecord}>
          Add Record
        </ActionButton>
      );
      break;
    case 'Move Horse':
      body = (
        <div className="xs-form">
          <Pick label="Horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
          <Text label="New barn" placeholder="e.g. Main Barn" value={f.barn ?? ''} onChange={set('barn')} />
          <Text
            label="New pasture"
            placeholder="e.g. South Pasture"
            value={f.pasture ?? ''}
            onChange={set('pasture')}
            hint="Fill in either field — only the ones you set are changed."
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitMoveHorse}>
          Move Horse
        </ActionButton>
      );
      break;
    case 'Prepare Sale Packet':
      body = (
        <div className="xs-form">
          <p className="xs-field-hint" style={{ margin: 0 }}>
            Sale packets are built in the Sale Packet Studio, where you pick the horse, the packet type, and the
            watermark before generating.
          </p>
        </div>
      );
      footer = (
        <ActionButton
          variant="primary"
          onClick={() => {
            onClose();
            navigate('/sale-packets');
          }}
        >
          Open Sale Packet Studio
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
          <Pick label="Channel" value={f.channel ?? 'Referral'} onChange={set('channel')} options={LEAD_CHANNELS} />
          <Pick label="Horse" value={f.animal ?? horseNames[0]} onChange={set('animal')} options={horseNames} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitBuyerFollowUp}>
          Save Follow-up
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
          <Pick label="Category" value={f.cat ?? 'Equipment'} onChange={set('cat')} options={ASSET_CATEGORIES} />
          <Pick label="Location" value={f.loc ?? locationNames[0]} onChange={set('loc')} options={locationNames} />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitEquipment}>
          Add Equipment
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
