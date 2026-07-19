import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { ActionButton, SlideOverDrawer } from '@/components/saas';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
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
  type = 'text',
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  type?: 'text' | 'date';
}) {
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <input
        className="xs-input"
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
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
  options: readonly string[] | { value: string; label: string }[];
}) {
  const normalized = options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option));
  return (
    <label>
      <span className="xs-field-label">{label}</span>
      <select className="xs-select" value={value} onChange={(e) => onChange(e.target.value)}>
        {normalized.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
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
            <span className="xs-stepper__num">{i < current ? '✓' : i + 1}</span>
            {s}
          </span>
          {i < steps.length - 1 ? <span className="xs-stepper__bar" /> : null}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------- Global Create (drawer) */
// Every action here persists through a real store mutation and reports the
// store's actual result. Anything that cannot persist does not belong in
// this menu — no button may claim success without persistent evidence.
export type CreateKey =
  | 'Add Horse'
  | 'Upload Document'
  | 'Add Health Record'
  | 'Add Breeding Record'
  | 'Move Horse'
  | 'Add Buyer Follow-up'
  | 'Add Expense'
  | 'Add Equipment';

export const createActions: CreateKey[] = [
  'Add Horse',
  'Upload Document',
  'Add Health Record',
  'Add Breeding Record',
  'Move Horse',
  'Add Buyer Follow-up',
  'Add Expense',
  'Add Equipment',
];

function isCreateKey(value: string): value is CreateKey {
  return (createActions as string[]).includes(value);
}

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
  'Vet visit',
  'Vaccine',
  'Coggins',
  'Injury',
  'Dental',
  'Deworming',
  'Treatment',
  'Historical note',
];
const ASSET_CATEGORIES: AssetCategory[] = ['Tack', 'Equipment', 'Medical Kit', 'Feed & Supply', 'Transport'];
const LEAD_CHANNELS: SalesLead['channel'][] = ['Site Inquiry', 'Referral', 'Facebook', 'Instagram'];
const DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function GlobalCreateDrawer() {
  const navigate = useNavigate();
  const request = useUiStore((s) => s.quickCreate);
  const closeQuickCreate = useUiStore((s) => s.closeQuickCreate);
  const openQuickCreate = useUiStore((s) => s.openQuickCreate);
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const workspaceProfile = useXbarStore((s) => s.workspaceProfile);
  const addHorse = useXbarStore((s) => s.addHorse);
  const addExpenseReceipt = useXbarStore((s) => s.addExpenseReceipt);
  const addMedicalEvent = useXbarStore((s) => s.addMedicalEvent);
  const addBreedingEvent = useXbarStore((s) => s.addBreedingEvent);
  const addRanchAsset = useXbarStore((s) => s.addRanchAsset);
  const createSalesLead = useXbarStore((s) => s.createSalesLead);
  const updateHorseLocation = useXbarStore((s) => s.updateHorseLocation);
  const createDocumentIntake = useXbarStore((s) => s.createDocumentIntake);
  const [f, setF] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  // Registration papers can create the horse records they describe. On by
  // default so a brand-new workspace bootstraps its herd from its documents.
  const [createProfiles, setCreateProfiles] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (v: string) => setF((cur) => ({ ...cur, [k]: v }));

  const action = request && isCreateKey(request.action) ? request.action : null;
  if (!action || !request) return null;

  const actor = workspaceProfile.ranchManagerName || workspaceProfile.defaultOwnerName || 'Ranch manager';
  const defaultBarn = workspaceProfile.defaultBarn || 'Main Barn';
  const horseOptions = horses.map((horse) => ({ value: horse.id, label: horse.name }));
  const selectedHorseId = f.horseId ?? request.horseId ?? horses[0]?.id ?? '';
  // Document upload never defaults to a horse: the batch either matches an
  // existing record or creates a new one, so leave it explicitly unlinked.
  const documentHorseId = f.horseId ?? request.horseId ?? '';
  // Upload Document is excluded: it is the flow that *creates* the first horse
  // from registration papers, so it must work on an empty workspace.
  const needsHorse =
    action !== 'Add Horse' && action !== 'Add Expense' && action !== 'Add Equipment' && action !== 'Upload Document';

  const close = () => {
    setF({});
    setFiles([]);
    closeQuickCreate();
  };

  const finish = (result: { ok: boolean; message: string }, go?: string) => {
    track(events.createSubmitted, { action, ok: result.ok });
    pushToast({ title: action, message: result.message, tone: result.ok ? 'success' : 'warning' });
    if (result.ok) {
      close();
      if (go) navigate(go);
    }
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
      barn: (f.loc ?? '').trim() || defaultBarn,
      pasture: workspaceProfile.defaultPasture ?? '',
    });
    finish(
      result.ok ? { ok: true, message: `${name} added to the herd` } : result,
      result.ok && result.id ? `/horses/${result.id}` : '/horses',
    );
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
      receiptDate: todayIso(),
      uploadedBy: actor,
    });
    setBusy(false);
    finish(result.ok ? { ok: true, message: 'Expense saved to the ledger' } : result, '/expenses');
  };

  const submitDocuments = async () => {
    if (!files.length) {
      pushToast({ title: 'Upload Document', message: 'Choose at least one file to upload.', tone: 'warning' });
      return;
    }
    setBusy(true);
    const result = await createDocumentIntake({
      files,
      horseId: documentHorseId || undefined,
      source: 'Manual Upload',
      uploadedBy: actor,
      label: (f.label ?? '').trim() || undefined,
      createHorseFromBatch: !documentHorseId && createProfiles,
    });
    setBusy(false);
    // When exactly one horse was created, land on its new profile so the
    // extracted registration facts are immediately visible.
    const createdHorseIds = (result as { createdHorseIds?: string[] }).createdHorseIds ?? [];
    const destination = createdHorseIds.length === 1 ? `/horses/${createdHorseIds[0]}` : '/documents';
    finish(result, destination);
  };

  const submitHealthRecord = () => {
    const title = (f.title ?? '').trim();
    const notes = (f.notes ?? '').trim();
    if (!selectedHorseId || title.length < 2 || notes.length < 4) {
      pushToast({
        title: 'Add Health Record',
        message: 'Pick a horse, then enter a title and a short note.',
        tone: 'warning',
      });
      return;
    }
    const result = addMedicalEvent(selectedHorseId, {
      title,
      body: notes,
      author: actor,
      date: (f.date ?? '').trim() || todayIso(),
      type: (f.type as MedicalEventType) ?? 'Vet visit',
    });
    finish(result.ok ? { ok: true, message: 'Health record saved to the horse timeline' } : result, '/medical');
  };

  const submitBreedingRecord = () => {
    const title = (f.title ?? '').trim();
    const notes = (f.notes ?? '').trim();
    if (!selectedHorseId || title.length < 2 || notes.length < 2) {
      pushToast({
        title: 'Add Breeding Record',
        message: 'Pick a horse, then enter a title and a short note.',
        tone: 'warning',
      });
      return;
    }
    const result = addBreedingEvent(selectedHorseId, {
      title,
      body: notes,
      author: actor,
      date: (f.date ?? '').trim() || todayIso(),
    });
    finish(result.ok ? { ok: true, message: 'Breeding record saved to the horse timeline' } : result, '/breeding');
  };

  const submitMoveHorse = () => {
    const barn = (f.barn ?? '').trim();
    const pasture = (f.pasture ?? '').trim();
    if (!selectedHorseId || (!barn && !pasture)) {
      pushToast({
        title: 'Move Horse',
        message: 'Pick a horse and enter the new barn or pasture.',
        tone: 'warning',
      });
      return;
    }
    const result = updateHorseLocation(selectedHorseId, {
      barn: barn || undefined,
      pasture: pasture || undefined,
    });
    finish(result.ok ? { ok: true, message: 'Location updated on the horse record' } : result, '/pastures');
  };

  const submitLead = () => {
    const name = (f.name ?? '').trim();
    if (!selectedHorseId || name.length < 2) {
      pushToast({ title: 'Add Buyer Follow-up', message: 'Pick a horse and enter the buyer name.', tone: 'warning' });
      return;
    }
    const result = createSalesLead({
      name,
      channel: (f.channel as SalesLead['channel']) ?? 'Site Inquiry',
      horseId: selectedHorseId,
    });
    finish(result.ok ? { ok: true, message: `${name} added to buyer follow-up` } : result, buyerFollowUpPath());
  };

  const submitEquipment = () => {
    const name = (f.name ?? '').trim();
    if (name.length < 2) {
      pushToast({ title: 'Add Equipment', message: 'Enter the equipment name.', tone: 'warning' });
      return;
    }
    const result = addRanchAsset({
      name,
      category: (f.type as AssetCategory) ?? 'Equipment',
      location: (f.loc ?? '').trim() || defaultBarn,
    });
    finish(result.ok ? { ok: true, message: `${name} added to ranch assets` } : result, '/assets');
  };

  const horsePicker = <Pick label="Horse" value={selectedHorseId} onChange={set('horseId')} options={horseOptions} />;

  // Horse-scoped actions need a horse on record first — offer the real next
  // step instead of a dead form.
  if (needsHorse && horses.length === 0) {
    return (
      <SlideOverDrawer
        open
        title={action}
        subtitle="Quick create"
        onClose={close}
        footer={
          <>
            <ActionButton onClick={close}>Cancel</ActionButton>
            <ActionButton variant="primary" onClick={() => openQuickCreate({ action: 'Add Horse' })}>
              Add a horse first
            </ActionButton>
          </>
        }
      >
        <p className="xs-field-hint">
          {action} attaches to a horse record, and this workspace doesn’t have any horses yet.
        </p>
      </SlideOverDrawer>
    );
  }

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
          <Text label="Location" placeholder={defaultBarn} value={f.loc ?? ''} onChange={set('loc')} />
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
          <button type="button" className="xs-drop" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={20} style={{ display: 'block', margin: '0 auto 8px' }} />
            {files.length
              ? `${files.length} file${files.length === 1 ? '' : 's'} selected — click to change`
              : 'Click to choose files (PDF, JPG, PNG)'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={DOCUMENT_ACCEPT}
            multiple
            hidden
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {horses.length > 0 ? (
            <Pick
              label="Link to horse (optional)"
              value={documentHorseId}
              onChange={set('horseId')}
              options={[{ value: '', label: 'Decide during review' }, ...horseOptions]}
            />
          ) : null}
          {!documentHorseId ? (
            <label className="xs-optin">
              <input type="checkbox" checked={createProfiles} onChange={(e) => setCreateProfiles(e.target.checked)} />
              <span>
                Create horse profiles from registration papers
                <small className="xs-field-hint">
                  We read the name, registration number, sex, color, and sire &amp; dam, then build a record for each
                  horse. Turn off to only queue the files for review.
                </small>
              </span>
            </label>
          ) : null}
          <Text
            label="Batch label (optional)"
            placeholder="e.g. 2026 Coggins renewals"
            value={f.label ?? ''}
            onChange={set('label')}
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" disabled={busy} onClick={() => void submitDocuments()}>
          {busy ? 'Uploading…' : 'Upload for review'}
        </ActionButton>
      );
      break;
    case 'Add Health Record':
      body = (
        <div className="xs-form">
          {horsePicker}
          <Pick
            label="Record type"
            value={f.type ?? 'Vet visit'}
            onChange={set('type')}
            options={MEDICAL_EVENT_TYPES}
          />
          <Text label="Title" placeholder="e.g. Spring vaccines" value={f.title ?? ''} onChange={set('title')} />
          <Text label="Date" type="date" value={f.date ?? todayIso()} onChange={set('date')} />
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
          Save Health Record
        </ActionButton>
      );
      break;
    case 'Add Breeding Record':
      body = (
        <div className="xs-form">
          {horsePicker}
          <Text label="Title" placeholder="e.g. Preg check — 45 days" value={f.title ?? ''} onChange={set('title')} />
          <Text label="Date" type="date" value={f.date ?? todayIso()} onChange={set('date')} />
          <Area
            label="Notes"
            placeholder="Stallion, result, vet, next step…"
            value={f.notes ?? ''}
            onChange={set('notes')}
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitBreedingRecord}>
          Save Breeding Record
        </ActionButton>
      );
      break;
    case 'Move Horse':
      body = (
        <div className="xs-form">
          {horsePicker}
          <Text label="New barn" placeholder={defaultBarn} value={f.barn ?? ''} onChange={set('barn')} />
          <Text
            label="New pasture"
            placeholder={workspaceProfile.defaultPasture || 'North Pasture'}
            value={f.pasture ?? ''}
            onChange={set('pasture')}
            hint="Fill in either field — the move is written to the horse record."
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitMoveHorse}>
          Save Move
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
          <Pick label="Channel" value={f.channel ?? 'Site Inquiry'} onChange={set('channel')} options={LEAD_CHANNELS} />
          {horsePicker}
        </div>
      );
      footer = (
        <ActionButton variant="primary" onClick={submitLead}>
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
        <ActionButton variant="primary" disabled={busy} onClick={() => void submitExpense()}>
          {busy ? 'Adding…' : 'Add Expense'}
        </ActionButton>
      );
      break;
    case 'Add Equipment':
      body = (
        <div className="xs-form">
          <Text label="Equipment" placeholder="e.g. Stock trailer (24ft)" value={f.name ?? ''} onChange={set('name')} />
          <Pick label="Category" value={f.type ?? 'Equipment'} onChange={set('type')} options={ASSET_CATEGORIES} />
          <Text label="Location" placeholder={defaultBarn} value={f.loc ?? ''} onChange={set('loc')} />
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
      onClose={close}
      footer={
        <>
          <ActionButton onClick={close}>Cancel</ActionButton>
          {footer}
        </>
      }
    >
      {body}
    </SlideOverDrawer>
  );
}
