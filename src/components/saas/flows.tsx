import { ASSET_CATEGORIES, HORSE_SEGMENTS } from '@/lib/recordOptions';
import { documentIntakeDisclosure } from '@/features/documents/constants';
import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileUp } from 'lucide-react';
import { ActionButton, SlideOverDrawer } from '@/components/saas';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { localIsoDate } from '@/lib/format';
import { useUiStore, type QuickCreateRequest } from '@/store/useUiStore';
import { useCloudStore } from '@/store/useCloudStore';
import { getWorkspacePersistReceipt, type WorkspacePersistReceipt } from '@/lib/workspaceStorage';
import { useXbarStore } from '@/store/useXbarStore';
import { PRICED_BY_UNIT_CATEGORIES, parseReceiptQuantity } from '@/store/xbarStoreLogic';
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
  | 'Add Equipment'
  | 'Edit Horse';

// Actions offered in the global Create menu (create-only).
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

// Every action the drawer can render. "Edit Horse" is opened contextually from
// a horse profile, not from the Create menu.
const drawerActions: CreateKey[] = [...createActions, 'Edit Horse'];

function isCreateKey(value: string): value is CreateKey {
  return (drawerActions as string[]).includes(value);
}

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
// Receipts bought by the unit, whose price per unit Costs tracks per supplier.
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

const LEAD_CHANNELS: SalesLead['channel'][] = ['Site Inquiry', 'Referral', 'Facebook', 'Instagram'];
const DOCUMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.heic';

function todayIso() {
  return localIsoDate();
}

function captureCreateContext(request: QuickCreateRequest | null) {
  const cloud = useCloudStore.getState();
  return {
    request,
    workspace: cloud.workspaceId,
    user: cloud.session?.user.id,
    profile: useXbarStore.getState().workspaceProfile,
  };
}

export function GlobalCreateDrawer() {
  const navigate = useNavigate();
  const location = useLocation();
  const latestLocationKey = useRef(location.key);
  useLayoutEffect(() => {
    latestLocationKey.current = location.key;
  }, [location.key]);
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
  const updateHorse = useXbarStore((s) => s.updateHorse);
  const createDocumentIntake = useXbarStore((s) => s.createDocumentIntake);
  const intakeProgress = useXbarStore((s) => s.documentIntakeProgress);
  const [f, setF] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [context, setContext] = useState(() => captureCreateContext(request));
  const submitting = useRef(false);
  const beforeSave = useRef<WorkspacePersistReceipt | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Every new opener starts a fresh draft. A completed older request must not
  // close or clear a newer drawer, even if both have the same action label.
  useEffect(() => {
    setContext(captureCreateContext(request));
    setF({});
    setFiles([]);
    setFormError('');
    setBusy(false);
    submitting.current = false;
  }, [request]);
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
  // The horse being edited (Edit Horse is opened from a profile with its id).
  const editHorse = action === 'Edit Horse' ? horses.find((h) => h.id === (request.horseId ?? '')) : undefined;
  // Upload Document and Edit Horse are excluded from the "add a horse first"
  // gate: Upload creates the first horse, and Edit already targets one.
  const needsHorse =
    action !== 'Add Horse' &&
    action !== 'Add Expense' &&
    action !== 'Add Equipment' &&
    action !== 'Upload Document' &&
    action !== 'Edit Horse';

  const close = () => {
    setF({});
    setFiles([]);
    closeQuickCreate();
  };

  const current = () => {
    const now = useCloudStore.getState();
    return (
      mounted.current &&
      context.request === request &&
      useUiStore.getState().quickCreate === request &&
      now.workspaceId === context.workspace &&
      now.session?.user.id === context.user &&
      useXbarStore.getState().workspaceProfile === context.profile
    );
  };
  const reportError = (message: string) => {
    if (!current()) return;
    setFormError(message);
    pushToast({ id: 'quick-create-feedback', title: `${action} not completed`, message, tone: 'error' });
  };
  const runSubmit = async (submit: () => void | Promise<void>) => {
    if (submitting.current) return;
    if (!current()) {
      setFormError('The ranch or account changed. Close this form and reopen it before continuing.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setFormError('');
    beforeSave.current = getWorkspacePersistReceipt();
    try {
      await submit();
    } catch {
      reportError(
        'The action could not be confirmed. Your draft is still here. Check the records before trying again.',
      );
    } finally {
      if (mounted.current && useUiStore.getState().quickCreate === request) {
        submitting.current = false;
        setBusy(false);
        if (!current()) setFormError('The ranch or account changed. Close this form and reopen it before continuing.');
      }
    }
  };
  const finish = async (result: { ok: boolean; message: string }, go?: string) => {
    if (!current()) return;
    track(events.createSubmitted, { action, ok: result.ok });
    if (!result.ok) {
      reportError(result.message);
      return;
    }
    // A store mutation is not proof that the device saved it. Capture the
    // resulting write now, before awaiting it; later writes cannot replace it.
    const receipt = getWorkspacePersistReceipt();
    let persisted = false;
    try {
      persisted = Boolean(
        receipt &&
        receipt !== beforeSave.current &&
        receipt.name === 'xbar-live-workspace' &&
        (await receipt.completed),
      );
    } catch {
      /* Report an unconfirmed device save below, never success. */
    }
    if (!current()) return;
    const message = result.message.trim().replace(/\.$/, '');
    pushToast({
      id: 'quick-create-feedback',
      title: persisted ? action : 'Device save not confirmed',
      message: persisted
        ? `${message}. ${action === 'Upload Document' ? 'Queue state saved' : 'Saved'} on this device.${context.user ? ' Cloud sync runs separately; check Cloud status.' : ''}`
        : `${message}. This change may exist only in this session. Keep XBAR open and free up device storage before reloading.`,
      tone: persisted ? (action === 'Upload Document' ? 'info' : 'success') : 'warning',
      ...(persisted ? {} : { duration: Infinity }),
    });
    // The mutation already happened, even when durable storage failed. Do not
    // leave a create button that would duplicate the record on a retry.
    close();
    if (go && latestLocationKey.current === location.key) navigate(go);
  };

  const submitAnimal = () => {
    const name = (f.name ?? '').trim();
    if (name.length < 2) {
      reportError('Enter a name to add the horse.');
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
    return finish(
      result.ok ? { ok: true, message: `${name} added to the herd` } : result,
      result.ok && result.id ? `/horses/${result.id}` : '/horses',
    );
  };

  const submitEditHorse = () => {
    if (!editHorse) return;
    const name = (f.name ?? editHorse.name).trim();
    if (name.length < 2) {
      reportError('A registered name is required.');
      return;
    }
    // Send only the identity fields the edit form controls. Empty strings are
    // allowed so a user can clear an incorrect value.
    const result = updateHorse(editHorse.id, {
      name,
      barnName: f.barnName ?? editHorse.barnName,
      breed: f.breed ?? editHorse.breed,
      color: f.color ?? editHorse.color,
      sex: (f.sex as HorseSex) ?? editHorse.sex,
      foaledOn: f.foaledOn ?? editHorse.foaledOn,
      registry: f.registry ?? editHorse.registry,
      registrationNumber: f.registrationNumber ?? editHorse.registrationNumber,
      owner: f.owner ?? editHorse.owner,
      ownerEntity: f.ownerEntity ?? editHorse.ownerEntity,
      microchipId: f.microchipId ?? editHorse.microchipId,
      markings: f.markings ?? editHorse.markings,
      sire: f.sire ?? editHorse.bloodline.sire,
      dam: f.dam ?? editHorse.bloodline.dam,
    });
    return finish(result, result.ok ? `/horses/${editHorse.id}` : undefined);
  };

  const submitExpense = async () => {
    const desc = (f.desc ?? '').trim();
    const amount = Number.parseFloat((f.amt ?? '').replace(/[^0-9.]/g, ''));
    if (desc.length < 2 || !Number.isFinite(amount) || amount <= 0) {
      reportError('Enter a description and a valid amount.');
      return;
    }
    const category = (f.cat as ExpenseCategory) ?? 'Feed';
    // Only feed-type receipts carry a quantity; the store refuses half a pair.
    const qtyText = PRICED_BY_UNIT_CATEGORIES.has(category) ? (f.qty ?? '').trim() : '';
    const unit = PRICED_BY_UNIT_CATEGORIES.has(category) ? (f.unit ?? '').trim() : '';
    const result = await addExpenseReceipt({
      title: desc,
      category,
      vendor: (f.vendor ?? '').trim() || 'General',
      amount,
      receiptDate: (f.date ?? '').trim() || todayIso(),
      quantity: parseReceiptQuantity(qtyText),
      unit: unit || undefined,
      uploadedBy: actor,
    });
    return finish(result.ok ? { ok: true, message: 'Expense added to the ledger' } : result, '/expenses');
  };

  const submitDocuments = async () => {
    if (!files.length) {
      reportError('Choose at least one file to upload.');
      return;
    }
    const result = await createDocumentIntake({
      files,
      horseId: documentHorseId || undefined,
      source: 'Manual Upload',
      uploadedBy: actor,
      label: (f.label ?? '').trim() || undefined,
      createHorseFromBatch: !documentHorseId && createProfiles,
    });
    // When exactly one horse was created, land on its new profile so the
    // extracted registration facts are immediately visible.
    const createdHorseIds = result.createdHorseIds ?? [];
    const destination =
      result.duplicateCount || result.heldForReviewCount
        ? '/documents?stage=Review'
        : createdHorseIds.length === 1
          ? `/horses/${createdHorseIds[0]}`
          : '/documents';
    return finish(result, destination);
  };

  // A preset from the opener (e.g. "Log a deworming") counts only if it is a
  // real record type; the person's own choice in the form always wins.
  const presetMedicalType = MEDICAL_EVENT_TYPES.find((type) => type === request.medicalType);
  const healthRecordType = ((f.type as MedicalEventType | undefined) ??
    presetMedicalType ??
    'Vet visit') as MedicalEventType;

  const submitHealthRecord = () => {
    const title = (f.title ?? '').trim();
    const notes = (f.notes ?? '').trim();
    if (!selectedHorseId || title.length < 2 || notes.length < 4) {
      reportError('Pick a horse, then enter a title and a short note.');
      return;
    }
    const result = addMedicalEvent(selectedHorseId, {
      title,
      body: notes,
      author: actor,
      date: (f.date ?? '').trim() || todayIso(),
      type: healthRecordType,
      completionState: f.completionState === 'planned' ? 'planned' : 'completed',
    });
    return finish(result.ok ? { ok: true, message: 'Health record added to the horse timeline' } : result, '/medical');
  };

  const submitBreedingRecord = () => {
    const title = (f.title ?? '').trim();
    const notes = (f.notes ?? '').trim();
    if (!selectedHorseId || title.length < 2 || notes.length < 2) {
      reportError('Pick a horse, then enter a title and a short note.');
      return;
    }
    const result = addBreedingEvent(selectedHorseId, {
      title,
      body: notes,
      author: actor,
      date: (f.date ?? '').trim() || todayIso(),
    });
    return finish(
      result.ok ? { ok: true, message: 'Breeding record added to the horse timeline' } : result,
      '/breeding',
    );
  };

  const submitMoveHorse = () => {
    const barn = (f.barn ?? '').trim();
    const pasture = (f.pasture ?? '').trim();
    if (!selectedHorseId || (!barn && !pasture)) {
      reportError('Pick a horse and enter the new barn or pasture.');
      return;
    }
    const result = updateHorseLocation(selectedHorseId, {
      barn: barn || undefined,
      pasture: pasture || undefined,
    });
    return finish(result.ok ? { ok: true, message: 'Location updated on the horse record' } : result, '/pastures');
  };

  const submitLead = () => {
    const name = (f.name ?? '').trim();
    if (!selectedHorseId || name.length < 2) {
      reportError('Pick a horse and enter the buyer name.');
      return;
    }
    const result = createSalesLead({
      name,
      channel: (f.channel as SalesLead['channel']) ?? 'Site Inquiry',
      horseId: selectedHorseId,
    });
    return finish(result.ok ? { ok: true, message: `${name} added to buyer follow-up` } : result, buyerFollowUpPath());
  };

  const submitEquipment = () => {
    const name = (f.name ?? '').trim();
    if (name.length < 2) {
      reportError('Enter the equipment name.');
      return;
    }
    const result = addRanchAsset({
      name,
      category: (f.type as AssetCategory) ?? 'Equipment',
      location: (f.loc ?? '').trim() || defaultBarn,
    });
    return finish(
      result.ok ? { ok: true, message: `${name} added to ranch assets` } : result,
      result.ok ? `/assets?asset=${encodeURIComponent(result.id ?? '')}` : undefined,
    );
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
        onClose={() => {
          if (!submitting.current) close();
        }}
        footer={
          <>
            <ActionButton disabled={busy} onClick={close}>
              Cancel
            </ActionButton>
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
            options={HORSE_SEGMENTS}
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
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitAnimal)}>
          Add Horse
        </ActionButton>
      );
      break;
    case 'Upload Document':
      body = (
        <div className="xs-form">
          <p className="stack-item__copy">{documentIntakeDisclosure}</p>
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
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitDocuments)}>
          {busy
            ? intakeProgress && intakeProgress.total > 1
              ? `Reading ${intakeProgress.processed} of ${intakeProgress.total}…`
              : 'Reading document…'
            : 'Upload for review'}
        </ActionButton>
      );
      break;
    case 'Add Health Record':
      body = (
        <div className="xs-form">
          {horsePicker}
          <Pick label="Record type" value={healthRecordType} onChange={set('type')} options={MEDICAL_EVENT_TYPES} />
          <Pick
            label="Care status"
            value={f.completionState ?? 'completed'}
            onChange={set('completionState')}
            options={['completed', 'planned']}
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
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitHealthRecord)}>
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
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitBreedingRecord)}>
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
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitMoveHorse)}>
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
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitLead)}>
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
          <Text label="Purchase date" type="date" value={f.date ?? todayIso()} onChange={set('date')} />
          {PRICED_BY_UNIT_CATEGORIES.has((f.cat as ExpenseCategory) ?? 'Feed') ? (
            <>
              <Text label="Quantity (optional)" placeholder="e.g. 40" value={f.qty ?? ''} onChange={set('qty')} />
              <Text
                label="Unit"
                placeholder="bale, ton, 50 lb bag"
                value={f.unit ?? ''}
                onChange={set('unit')}
                hint="Add quantity and unit to see this supplier's price per unit on Costs — and get flagged when it rises."
              />
            </>
          ) : null}
        </div>
      );
      footer = (
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitExpense)}>
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
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitEquipment)}>
          Add Equipment
        </ActionButton>
      );
      break;
    case 'Edit Horse':
      if (!editHorse) {
        body = <p className="xs-field-hint">That horse record could not be found. It may have been removed.</p>;
        break;
      }
      body = (
        <div className="xs-form">
          <Text label="Registered name" value={f.name ?? editHorse.name} onChange={set('name')} />
          <Text label="Barn name" value={f.barnName ?? editHorse.barnName} onChange={set('barnName')} />
          <Pick label="Sex" value={f.sex ?? editHorse.sex} onChange={set('sex')} options={SEX_OPTIONS} />
          <Text label="Color" placeholder="e.g. Sorrel" value={f.color ?? editHorse.color} onChange={set('color')} />
          <Text
            label="Breed"
            placeholder="e.g. Quarter Horse"
            value={f.breed ?? editHorse.breed}
            onChange={set('breed')}
          />
          <Text label="Foaled on" type="date" value={f.foaledOn ?? editHorse.foaledOn} onChange={set('foaledOn')} />
          <Text
            label="Registry"
            placeholder="e.g. AQHA"
            value={f.registry ?? editHorse.registry}
            onChange={set('registry')}
          />
          <Text
            label="Registration number"
            value={f.registrationNumber ?? editHorse.registrationNumber}
            onChange={set('registrationNumber')}
          />
          <Text
            label="Sire"
            placeholder="Name (registration #)"
            value={f.sire ?? editHorse.bloodline.sire}
            onChange={set('sire')}
          />
          <Text
            label="Dam"
            placeholder="Name (registration #)"
            value={f.dam ?? editHorse.bloodline.dam}
            onChange={set('dam')}
          />
          <Text label="Owner" value={f.owner ?? editHorse.owner} onChange={set('owner')} />
          <Text label="Owner entity" value={f.ownerEntity ?? editHorse.ownerEntity} onChange={set('ownerEntity')} />
          <Text
            label="Microchip / brand ID"
            placeholder="e.g. 985141000123456"
            value={f.microchipId ?? editHorse.microchipId}
            onChange={set('microchipId')}
          />
          <Text
            label="Markings"
            placeholder="e.g. Star, left hind sock"
            value={f.markings ?? editHorse.markings}
            onChange={set('markings')}
          />
        </div>
      );
      footer = (
        <ActionButton variant="primary" disabled={busy} onClick={() => runSubmit(submitEditHorse)}>
          Save changes
        </ActionButton>
      );
      break;
  }

  return (
    <SlideOverDrawer
      open
      title={action}
      subtitle={action === 'Edit Horse' ? 'Update details' : 'Quick create'}
      onClose={() => {
        if (!submitting.current) close();
      }}
      footer={
        <>
          <ActionButton disabled={busy} onClick={close}>
            Cancel
          </ActionButton>
          {footer}
        </>
      }
    >
      {busy ? <p role="status">Saving… Keep this form open until the action finishes.</p> : null}
      {formError ? (
        <p className="xs-action-feedback-error" role="alert">
          {formError}
        </p>
      ) : null}
      <div aria-busy={busy}>{body}</div>
    </SlideOverDrawer>
  );
}
