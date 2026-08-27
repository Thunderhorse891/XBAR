import {
  expenseReceiptsSeed,
  ownershipSeed,
  ranchAssetsSeed,
  roleSeed,
  salesLeadsSeed,
  sharedAccessSeed,
  sharedListingsSeed,
  subscriptionSeed,
  workspaceProfileSeed,
} from '@/data/xbarPlatform';
import {
  buildSharePath,
  createId,
  createShareAccessToken,
  deriveSharedAccessSnapshot,
  nowStamp,
  todayStamp,
} from '@/lib/xbarRuntime';
import { clampSubscriptionToEntitlement, normalizeTier } from '@/lib/subscriptionDecision';
import {
  countReservedSharedAccessSeats,
  countReservedWorkspaceSeats,
  normalizeWorkspaceEmail,
} from '@/lib/workspaceAccess';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { createOwnershipRecord, normalizeOwnershipRecord } from '@/store/xbarStoreLogic';
import { getCapabilityDeniedMessage, hasRoleCapability } from '@/lib/permissions';
import type {
  AuditEvent,
  BuyerRoomEvent,
  DocumentFact,
  DocumentRecord,
  ExpenseReceipt,
  HorseRecord,
  IntakeBatch,
  OwnershipRecord,
  RanchAsset,
  RoleCapability,
  RoleWorkspace,
  SalePacketBuild,
  SalesLead,
  SharedAccessSnapshot,
  SharedListingRecord,
  SubscriptionProfile,
  UserRole,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
  WorkspaceProfile,
} from '@/types/xbar';
import type { ExpenseReceiptInput, NewHorseInput } from '@/store/xbarStoreLogic';
import type { PersistedXbarState, XbarStore } from '@/store/xbarStoreTypes';

export const WORKSPACE_SCHEMA_VERSION = 8;
const legacyDemoHorseIds = new Set([
  'horse-wiggy',
  'horse-hancock',
  'horse-bonny',
  'horse-dolly',
  'horse-thunder',
  'horse-shadow',
]);
const legacyDemoWorkspaceNames = new Set(['', 'XBAR']);
const legacyDemoRanchNames = new Set(['', 'Primary Ranch']);

export function createEmptyWorkspaceState(): PersistedXbarState {
  return {
    horses: [],
    documents: [],
    intakeBatches: [],
    ownershipRecords: ownershipSeed,
    auditEvents: [],
    salePacketBuilds: [],
    buyerRoomEvents: [],
    expenseReceipts: expenseReceiptsSeed,
    ranchAssets: ranchAssetsSeed,
    subscription: subscriptionSeed,
    roleWorkspaces: roleSeed,
    salesLeads: salesLeadsSeed,
    sharedListings: sharedListingsSeed,
    sharedAccess: deriveSharedAccessSnapshot(sharedAccessSeed, sharedListingsSeed, salesLeadsSeed),
    workspaceMembers: [],
    workspaceInvitations: [],
    workspaceProfile: workspaceProfileSeed,
  };
}

export const initialState = {
  currentRole: (isSupabaseConfigured() ? 'Owner' : 'Admin') as UserRole,
  ...createEmptyWorkspaceState(),
  // Transient (never persisted): live progress of an in-flight OCR batch.
  documentIntakeProgress: null,
};

export function syncDerivedValues(
  state: Pick<
    XbarStore,
    | 'horses'
    | 'salesLeads'
    | 'sharedListings'
    | 'sharedAccess'
    | 'workspaceMembers'
    | 'workspaceInvitations'
    | 'subscription'
  >,
) {
  const horses = state.horses.map((horse) => {
    const leadCount = state.salesLeads.filter((lead) => lead.horseId === horse.id && lead.stage !== 'Closed').length;
    return {
      ...horse,
      sale: {
        ...horse.sale,
        inquiryCount: leadCount,
      },
    };
  });

  const seatsUsed = countReservedWorkspaceSeats(state.workspaceMembers, state.workspaceInvitations);
  const sharedAccessSeatsUsed = countReservedSharedAccessSeats(state.workspaceMembers, state.workspaceInvitations);

  return {
    horses,
    sharedAccess: deriveSharedAccessSnapshot(
      state.sharedAccess,
      state.sharedListings,
      state.salesLeads,
      state.workspaceInvitations,
      state.workspaceMembers,
    ),
    subscription: {
      ...state.subscription,
      usage: {
        ...state.subscription.usage,
        horsesUsed: horses.length,
        seatsUsed,
        sharedAccessSeatsUsed,
      },
    },
  };
}

export function normalizeDocumentState(value: unknown): DocumentRecord['state'] {
  if (
    value === 'Queued' ||
    value === 'Needs Review' ||
    value === 'Matched' ||
    value === 'Ready' ||
    value === 'Archived'
  ) {
    return value;
  }
  return 'Needs Review';
}

export function normalizeBatchState(value: unknown): IntakeBatch['state'] {
  if (value === 'Completed' || value === 'Reviewing' || value === 'Queued') {
    return value;
  }
  return 'Reviewing';
}

export function normalizeBillingState(value: unknown): SubscriptionProfile['billingState'] {
  if (value === 'Active' || value === 'Past Due' || value === 'Manual Billing' || value === 'Inactive') {
    return value;
  }
  // An unreadable stored value falls to 'Inactive', not 'Manual Billing'.
  // Manual Billing is an operator's deliberate grant of a paid tier, so it must
  // never be what corrupt or unrecognized data decays into.
  return 'Inactive';
}

export function restoreWorkspaceProfile(raw: unknown): WorkspaceProfile {
  const value = raw && typeof raw === 'object' ? (raw as Partial<WorkspaceProfile>) : {};
  const workspaceShortcuts = Array.isArray(value.workspaceShortcuts)
    ? value.workspaceShortcuts
        .map((shortcut) => (typeof shortcut === 'string' ? shortcut.trim() : ''))
        .filter(Boolean)
        .filter((shortcut, index, all) => all.indexOf(shortcut) === index)
        .slice(0, 6)
    : workspaceProfileSeed.workspaceShortcuts;

  return {
    ranchName: value.ranchName?.trim() || workspaceProfileSeed.ranchName,
    businessName: value.businessName?.trim() || workspaceProfileSeed.businessName,
    defaultOwnerName: value.defaultOwnerName?.trim() || '',
    defaultOwnerEntity: value.defaultOwnerEntity?.trim() || '',
    ranchManagerName: value.ranchManagerName?.trim() || '',
    operationsEmail: value.operationsEmail?.trim() || '',
    defaultBarn: value.defaultBarn?.trim() || '',
    defaultPasture: value.defaultPasture?.trim() || '',
    workspaceShortcuts,
    setupCompleteAt: value.setupCompleteAt?.trim() || '',
  };
}

export function isWorkspaceSetup(profile: WorkspaceProfile) {
  return Boolean(profile.setupCompleteAt?.trim());
}

export function looksLikeLegacyDemoWorkspace(state: PersistedXbarState) {
  if (isWorkspaceSetup(state.workspaceProfile)) {
    return false;
  }

  return (
    legacyDemoWorkspaceNames.has(state.workspaceProfile.businessName.trim()) &&
    legacyDemoRanchNames.has(state.workspaceProfile.ranchName.trim()) &&
    state.horses.length > 0 &&
    state.horses.every((horse) => legacyDemoHorseIds.has(horse.id))
  );
}

export function createSharedListingRecord(horseId: string, patch?: Partial<SharedListingRecord>): SharedListingRecord {
  const timestamp = todayStamp();
  return {
    id: patch?.id ?? createId('share'),
    horseId,
    sharePath: patch?.sharePath ?? buildSharePath(horseId),
    accessMode: patch?.accessMode ?? 'Private Token',
    shareToken: patch?.shareToken?.trim() || createShareAccessToken(),
    tokenIssuedAt: patch?.tokenIssuedAt ?? timestamp,
    state: patch?.state ?? 'Draft',
    channels: patch?.channels?.length ? patch.channels : ['Direct Link'],
    createdAt: patch?.createdAt ?? timestamp,
    updatedAt: patch?.updatedAt ?? timestamp,
    lastSharedAt: patch?.lastSharedAt,
    releaseConfirmedAt: patch?.releaseConfirmedAt,
    releaseConfirmedBy: patch?.releaseConfirmedBy,
    releaseConfirmationVersion: patch?.releaseConfirmationVersion,
  };
}

export function createInitialWorkspaceMember(profile: WorkspaceProfile): WorkspaceMemberRecord {
  return {
    id: createId('member'),
    email: normalizeWorkspaceEmail(profile.operationsEmail) || 'workspace-admin@xbar.local',
    role: 'Admin',
    status: 'Active',
    invitedAt: profile.setupCompleteAt,
    joinedAt: profile.setupCompleteAt || todayStamp(),
    source: 'Owner',
  };
}

export function restoreWorkspaceMembers(raw: unknown): WorkspaceMemberRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((member) => (member && typeof member === 'object' ? (member as Partial<WorkspaceMemberRecord>) : null))
    .filter(Boolean)
    .map((member) => {
      const status: WorkspaceMemberRecord['status'] = member?.status === 'Inactive' ? 'Inactive' : 'Active';
      const source: WorkspaceMemberRecord['source'] = member?.source === 'Invite' ? 'Invite' : 'Owner';

      return {
        id: member?.id?.trim() || createId('member'),
        email: normalizeWorkspaceEmail(member?.email ?? ''),
        role: member?.role ?? 'Owner',
        status,
        invitedAt: member?.invitedAt?.trim() || undefined,
        joinedAt: member?.joinedAt?.trim() || todayStamp(),
        source,
      };
    })
    .filter((member) => Boolean(member.email));
}

export function restoreWorkspaceInvitations(raw: unknown): WorkspaceInvitationRecord[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((invite) => (invite && typeof invite === 'object' ? (invite as Partial<WorkspaceInvitationRecord>) : null))
    .filter(Boolean)
    .map((invite) => {
      const status: WorkspaceInvitationRecord['status'] =
        invite?.status === 'Accepted' || invite?.status === 'Revoked' ? invite.status : 'Pending';

      return {
        id: invite?.id?.trim() || createId('invite'),
        email: normalizeWorkspaceEmail(invite?.email ?? ''),
        role: invite?.role ?? 'Owner',
        status,
        invitedBy: invite?.invitedBy?.trim() || 'Workspace Admin',
        invitedAt: invite?.invitedAt?.trim() || todayStamp(),
        acceptedAt: invite?.acceptedAt?.trim() || undefined,
        revokedAt: invite?.revokedAt?.trim() || undefined,
      };
    })
    .filter((invite) => Boolean(invite.email));
}

export function createExpenseReceiptRecord(
  input: ExpenseReceiptInput,
  patch?: Partial<
    Pick<ExpenseReceipt, 'fileUrl' | 'storagePath' | 'localFileKey' | 'fileName' | 'mimeType' | 'fileSizeBytes'>
  >,
): ExpenseReceipt {
  const file = input.file ?? undefined;
  return {
    id: createId('receipt'),
    horseId: input.horseId?.trim() || undefined,
    title: input.title.trim(),
    category: input.category,
    vendor: input.vendor.trim(),
    amount: Number(input.amount),
    receiptDate: input.receiptDate,
    notes: input.notes?.trim() || '',
    uploadedAt: nowStamp(),
    uploadedBy: input.uploadedBy.trim(),
    fileUrl: patch?.fileUrl,
    localFileKey: patch?.localFileKey,
    storagePath: patch?.storagePath,
    fileName: patch?.fileName ?? file?.name,
    mimeType: patch?.mimeType ?? file?.type ?? undefined,
    fileSizeBytes: patch?.fileSizeBytes ?? file?.size,
  };
}

export function selectPersistedState(state: PersistedXbarState): PersistedXbarState {
  return {
    horses: state.horses,
    documents: state.documents,
    intakeBatches: state.intakeBatches,
    ownershipRecords: state.ownershipRecords,
    auditEvents: state.auditEvents,
    salePacketBuilds: state.salePacketBuilds,
    buyerRoomEvents: state.buyerRoomEvents,
    expenseReceipts: state.expenseReceipts,
    ranchAssets: state.ranchAssets,
    subscription: state.subscription,
    roleWorkspaces: state.roleWorkspaces,
    salesLeads: state.salesLeads,
    sharedListings: state.sharedListings,
    sharedAccess: state.sharedAccess,
    workspaceMembers: state.workspaceMembers,
    workspaceInvitations: state.workspaceInvitations,
    workspaceProfile: state.workspaceProfile,
  };
}

/**
 * Would this backup restore, in full?
 *
 * The shape check `workspaceBackupPayload` performs is a *precondition*, not a
 * guarantee: `{ workspace: { horses: [null] } }` has a `horses` key and passes
 * it, then `restorePersistedState` dereferences the null and throws. That
 * mattered once restoring also wrote file bytes into the vault under keys the
 * backup carries — the blobs of the workspace currently loaded were replaced
 * before anything discovered the payload was unusable, and the UI then reported
 * the import as blocked.
 *
 * Runs the real normalization rather than a deeper set of shape assertions, so
 * this cannot drift from what the import actually does. It is pure, so running
 * it twice costs only the work.
 */
/**
 * Record collections whose entries the app looks up, keys and cascades by id.
 *
 * `workspaceProfile` and `subscription` are deliberately absent — they are
 * single objects with defaults, not identified collections.
 */
const IDENTIFIED_COLLECTIONS = [
  'horses',
  'documents',
  'intakeBatches',
  'ownershipRecords',
  'auditEvents',
  'salePacketBuilds',
  'buyerRoomEvents',
  'expenseReceipts',
  'ranchAssets',
  'salesLeads',
  'sharedListings',
  'workspaceMembers',
  'workspaceInvitations',
] as const;

export function canRestorePersistedState(raw: unknown): boolean {
  let normalized: PersistedXbarState;
  try {
    normalized = restorePersistedState(raw);
  } catch {
    return false;
  }

  /*
   * Not throwing is not the same as being usable.
   *
   * `{ horses: [{}] }` normalizes cleanly — the spread copies nothing and the
   * migration adds `documentFacts: []` — and produces a horse with no id and no
   * name. That payload passed both guards, the vault was overwritten with the
   * archive's blobs, and the broken state was installed; screens that key or
   * look up by id then crash on it.
   *
   * An id is the invariant the whole app rests on: lookups, React keys, and the
   * cascades that delete a horse's receipts all assume one. Checking it here
   * costs a pass over the records and refuses BEFORE anything is written.
   */
  const state = normalized as unknown as Record<string, unknown>;
  for (const collection of IDENTIFIED_COLLECTIONS) {
    const entries = state[collection];
    if (!Array.isArray(entries)) return false;
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') return false;
      const id = (entry as { id?: unknown }).id;
      if (typeof id !== 'string' || id.trim() === '') return false;
    }
  }

  /*
   * Horses need more than an id, and "identity is the invariant" was too narrow.
   *
   * `{ id: 'horse-1', name: 'Horse' }` has an id and normalizes cleanly, but
   * normalization does not supply the nested objects — so the state installs
   * and the first route to reach `horse.readiness.packetStatus` or
   * `horse.sale.askPrice` throws on a screen the rancher just opened.
   *
   * Only the shapes routes actually dereference are checked, and only on
   * horses, which is the record with the deep reads. A full runtime schema for
   * every collection is a second description of "valid" that would drift from
   * the types — the trade the original comment was right about, and the reason
   * this stops at the fields that actually crash.
   */
  /*
   * Horses are not the only record with deep reads, which is what the previous
   * version of this comment got wrong. `{ documents: [{ id: 'doc-1' }] }` has
   * an id, normalizes, installs — and `Documents.tsx:724` immediately reads
   * `document.entities.horseName`. A packet with only an id reaches
   * `packet.documentIds.length` on two screens.
   *
   * Still only the shapes routes actually dereference WITHOUT a guard, and
   * still not a full runtime schema: a second description of "valid" would
   * drift from the types. The list is derived by searching the routes for
   * unguarded dereferences on restored collections, which is how the receipt,
   * lead, listing and `medicalTimeline` entries were found — the first two
   * passes added only what a reviewer had named, and each time left siblings
   * behind.
   *
   * Derived state is deliberately absent, and it is the ONLY thing that is.
   * `packet.saleSlots` reads like one of these and is not:
   * `buildHorsePacketCompleteness` constructs it, so it cannot arrive missing
   * from a backup and requiring it would reject valid archives.
   *
   * "A read site normalizes it first" is NOT grounds for exclusion, though it
   * was used as such here twice. `transferStatus` and `pendingDocuments` were
   * both left out because one of their read sites guards — and both had other
   * read sites that do not. One guarded read proves nothing about the rest.
   *
   * A caveat on how this list is built, since it has now grown four times. A
   * text search finds `horse.name.toLowerCase()` but not `add(horse.owner)`,
   * where the dereference happens one call away inside the helper — which is
   * exactly how `owner` and `legalOwner` survived the previous sweep. Fields
   * passed into helpers have to be read for, not grepped for.
   */
  /*
   * `itemShapes` validates what is INSIDE an array, which `lists` cannot.
   *
   * `breedingTimeline: [null]` satisfies `Array.isArray` and then throws the
   * moment Breeding reads `event.id`. Every array here holds objects whose
   * fields are dereferenced somewhere, so each entry must at least be a plain
   * object; `strings` adds the fields a route calls a string method on.
   */
  /*
   * All three timeline collections — `activity`, `medicalTimeline` and
   * `breedingTimeline` — hold TimelineEvent, so they share one item shape
   * rather than each carrying a partial copy that drifts. Every field here is
   * read without a guard somewhere:
   *
   *   id       React key — AnimalProfile.tsx:713; `ev.id === eventId` in
   *            updateMedicalEvent — useXbarStore.ts:1858.
   *   date     `formatDateLabel(event.date)` — Medical.tsx:106,
   *            Breeding.tsx:311 — which calls `value?.trim()` (format.ts:19)
   *            and throws on anything that is not a string.
   *   title    `.toLowerCase()` — Medical.tsx:536, Breeding.tsx:293.
   *   summary  rendered straight into JSX — AnimalProfile.tsx:719.
   *   owner    drawer fact value, `{fact.value}` — InteractionSystem.tsx:452.
   *   category drawer eyebrow, `{drawer.eyebrow}` — InteractionSystem.tsx:441.
   *
   * The last three are the "Objects are not valid as a React child" shape:
   * they do not throw where they are read, they throw where React renders them.
   *
   * Requiring all six cannot turn away an older archive: TimelineEvent has
   * carried every one of them as a required field since the first commit of
   * types/xbar.ts, so no build of this app has ever written a timeline event
   * without them. Over-rejection is as much a bug as under-rejection, and this
   * is the check that rules it out.
   */
  const TIMELINE_EVENT_SHAPE = { strings: ['id', 'date', 'title', 'summary', 'owner', 'category'] };

  const NESTED_SHAPES: Record<
    string,
    {
      objects?: string[];
      lists?: string[];
      strings?: string[];
      itemShapes?: Record<
        string,
        {
          strings?: string[];
          /*
           * Numbers inside an array entry. `{o.share}%` renders exactly as a
           * string does, so an object throws — and the entry's own comment
           * named `stake.share` while nothing validated it.
           */
          numbers?: string[];
          /*
           * Fields that must be a string WHEN PRESENT.
           *
           * `strings` cannot express this: it demands presence, and demanding
           * an optional field turns away every archive that legitimately omits
           * it — over-rejection, which loses a valid backup rather than a
           * broken one.
           */
          optionalStrings?: string[];
        }
      >;
      /*
       * Arrays whose entries are strings. `itemShapes` cannot express this —
       * it requires every entry to be a plain object — and `lists` stops at
       * the container, so a string array whose ENTRIES reach JSX had no way to
       * be validated at all. Naming a list here also asserts it is an array,
       * so it does not need repeating under `lists`.
       */
      stringItems?: string[];
      /*
       * Scalars that must be a string WHEN PRESENT, named by path.
       *
       * `strings` demands presence, and demanding an optional field turns away
       * every archive that legitimately omits it — over-rejection, which loses
       * a good backup rather than a broken one. Every DocumentEntities field is
       * optional and almost all of them are read with `?.trim()`, which guards
       * null and undefined and nothing else.
       */
      optionalStrings?: string[];
      /*
       * Fields that must be a finite number.
       *
       * `{batch.fileCount} files` renders the value as a React child exactly
       * the way a string does, so an object throws "Objects are not valid as a
       * React child" — a shape `strings` cannot describe and `objects` would
       * accept. NaN and Infinity are refused too: they reach the same JSX and
       * render as "NaN".
       */
      numbers?: string[];
    }
  > = {
    horses: {
      // `horse.location.barn` / `.pasture` — Horses.tsx:121, Breeding.tsx:268.
      objects: ['bloodline', 'assignments', 'sale', 'readiness', 'location'],
      // `horse.medicalTimeline.map` — Medical.tsx:39.
      // `horse.ownership.reduce` — features/ownership/selectors.ts:13.
      // `horse.documents.includes` — this file, line ~883.
      // `animal.activity.length` — AnimalProfile.tsx:710.
      lists: [
        'gallery',
        'breedingTimeline',
        'medicalTimeline',
        'documentFacts',
        'alerts',
        'ownership',
        'documents',
        'activity',
        /*
         * `[nextNote, ...horse.notes]` — useXbarStore.ts:1591. Spreading
         * `undefined` throws, and normalization backfills only
         * `documentFacts`, so a backup that simply omits `notes` restores
         * cleanly and then fails the first time someone adds a note.
         *
         * The CONTAINER only, deliberately: no `itemShapes` entry, because
         * nothing ever reads an existing note. That spread is the single read
         * of this array in the codebase — no route renders a note, nothing
         * iterates them — so validating the entries would guard a crash that
         * cannot happen and could only turn away a valid archive.
         */
        'notes',
      ],
      /*
       * `horse.name.toLowerCase` — Breeding.tsx:292.
       * `horse.owner` → `rawName.trim()` — commandPalette.ts:121.
       * `h.segment.toLowerCase()` — Sales.tsx:320.
       * `{horse.sex}` — Breeding.tsx:261, beside the bloodline.
       *
       * The dotted paths are the INSIDES of the objects listed above. Naming a
       * field under `objects` proves only that the container is an object; the
       * scalars in it went unchecked, so `bloodline: { sire: '', dam: '',
       * family: {} }` restored and then crashed Breeding at :261, which renders
       * `{horse.bloodline.family}` directly.
       *
       * Every one of these is read across the app rather than at a single site
       * — `location.barn` alone appears at fifteen — and all have been required
       * by their interfaces since the first commit of types/xbar.ts.
       */
      strings: [
        'name',
        'owner',
        'segment',
        'sex',
        'bloodline.sire',
        'bloodline.dam',
        'bloodline.family',
        'assignments.trainer',
        'assignments.ranchManager',
        'assignments.veterinarian',
        'assignments.farrier',
        'location.ranch',
        'location.barn',
        'location.pasture',
        'location.stall',
        // `{horse.sale.listingState}` — Sales.tsx:380, SharedAccess.tsx:269.
        'sale.listingState',
      ],
      /*
       * `sale.askPrice` feeds `listedValue` and every margin figure, and
       * `readiness.score` is rendered as a readiness percentage. Neither
       * throws on an object — they yield NaN, which propagates silently into
       * the screen, the CSV and the banker-facing PDF. `readiness.packetStatus`
       * is not here: every read of it is a comparison or a template string.
       */
      numbers: ['sale.askPrice', 'readiness.score'],
      /*
       * `horse.readiness.blockers.filter()` — useXbarStore.ts:1205, on the
       * first qualifying photo upload, after the media file is stored — needs
       * the container, and `{animal.readiness?.blockers?.[0] ?? …}` at
       * AnimalProfile.tsx:353 needs the ENTRIES. `?.[0]` indexes safely and
       * then renders whatever it found; `??` does not catch an object.
       *
       * `stringItems` asserts the array as well as its contents, so this is
       * not repeated under `lists`.
       */
      stringItems: ['readiness.blockers'],
      itemShapes: {
        breedingTimeline: TIMELINE_EVENT_SHAPE,
        medicalTimeline: TIMELINE_EVENT_SHAPE,
        /*
         * `activity` was added to `lists` without an entry here, which left
         * `activity: [null]` passing validation and then throwing at
         * AnimalProfile.tsx:713 — the container was checked, its contents were
         * not. It is the same TimelineEvent as the two above.
         */
        activity: TIMELINE_EVENT_SHAPE,
        /*
         * `asset.status` / `asset.kind` — xbarPhaseTwo.ts:241,
         * publicShare.ts:109 — plus `{asset.label}` and `src={asset.url}` at
         * BuyerProfile.tsx:644-646, which the approved-photo path puts in front
         * of a buyer. `id` is the React key.
         */
        gallery: { strings: ['id', 'label', 'kind', 'url', 'status'] },
        /*
         * `stake.share` / `stake.role` / `stake.name` — ownership/selectors.ts:13-14.
         *
         * `share` was named in this comment and validated by nothing: it is a
         * number, and the table had no vocabulary for one inside an array
         * entry. `{o.role} · {o.share}%` renders both at AnimalProfile.tsx:556.
         */
        ownership: { strings: ['id', 'name', 'role'], numbers: ['share'] },
        /*
         * `fact.id === factId` — useXbarStore.ts:2513 — and `{f.label}` /
         * `{f.value}` rendered straight into JSX at AnimalProfile.tsx:528-529.
         * Checking only `id` let `{ id: 'fact-1', label: {}, value: 'x' }`
         * install and then throw "Objects are not valid as a React child" on
         * the Documents tab of the restored horse.
         *
         * Both have been required by DocumentFact since the first commit of
         * types/xbar.ts, so requiring them cannot turn away a real archive.
         */
        documentFacts: {
          strings: ['id', 'label', 'value'],
          /*
           * `{f.decision ?? 'Review'}` — AnimalProfile.tsx:534. `??` catches
           * null and undefined, not an object, so a non-string `decision`
           * renders and crashes exactly like `label` does. It is optional in
           * the type and genuinely absent on most facts, so it can only be
           * checked when present.
           */
          optionalStrings: ['decision'],
        },
        /*
         * `{a.title}` and `{a.summary} · {a.module}` are rendered on the Tasks
         * tab — AnimalProfile.tsx:631-634 — and `a.id` is the React key. An
         * entry that was merely a plain object satisfied this before, so
         * `alerts: [{ title: {}, summary: '', module: '', severity: 'low' }]`
         * installed and then crashed the tab. All five have been required by
         * HorseAlert since the first commit of types/xbar.ts.
         */
        alerts: { strings: ['id', 'title', 'summary', 'severity', 'module'] },
      },
    },
    // `document.entities.horseName` and four siblings — Documents.tsx:724.
    // `document.title.trim()` — useXbarStore.ts:842, beside optional-chained
    // siblings, which is what makes it easy to miss.
    documents: {
      objects: ['entities'],
      /*
       * `document.title.trim()` — useXbarStore.ts:842, beside optional-chained
       * siblings, which is what makes it easy to miss — plus the five scalars
       * the Documents queue renders directly: `{document.type} ·
       * {document.source}` at :737, `{document.duplicateRisk}` at :1002,
       * `formatDateTimeLabel(document.uploadedAt)` at :1042 (which throws
       * before React is reached), and `{document.summary}` at
       * BuyerProfile.tsx:625.
       *
       * `state` is excluded: `restorePersistedState` runs
       * `normalizeDocumentState` over every document, so it cannot arrive
       * malformed — the same ground as the intake batch's own `state`.
       */
      strings: ['id', 'title', 'type', 'source', 'duplicateRisk', 'uploadedAt', 'summary', 'uploadedBy'],
      // `Math.round(document.confidence * 100)` — Documents.tsx:838. An object
      // yields NaN and renders as "NaN% OCR confidence".
      numbers: ['confidence'],
      /*
       * Every field of DocumentEntities, because every one of them is read
       * without a type check and all of them are optional.
       *
       * Two shapes of crash, both after the archive and its files are
       * installed. Documents.tsx:723-729 builds `entityRows` and filters on
       * `Boolean(row.value)` — `{}` is truthy — then renders `{row.value}`:
       * "Objects are not valid as a React child". And `entities.registry
       * ?.trim()` in xbarStoreLogic.ts:319-354 and its ten siblings throw a
       * TypeError, because optional chaining stops at null and undefined and
       * says nothing about an object.
       *
       * The whole interface rather than only the five Documents.tsx displays:
       * `sex`, `breed`, `color`, `foaledOn`, `sire`, `dam` and their
       * registrations all reach `.trim()` through the enrichment path, which a
       * grep for "rendered" would have walked straight past.
       */
      optionalStrings: [
        'entities.horseName',
        'entities.registrationNumber',
        'entities.registry',
        'entities.sex',
        'entities.color',
        'entities.breed',
        'entities.foaledOn',
        'entities.sire',
        'entities.sireRegistration',
        'entities.dam',
        'entities.damRegistration',
        'entities.ownerName',
        'entities.examDate',
        'entities.veterinarian',
        'entities.transferStatus',
      ],
    },
    /*
     * `record.legalOwner` → `rawName.trim()` — commandPalette.ts:134.
     * `selectedRecord.auditTrail.length` — Ownership.tsx:787.
     * `o.pendingDocuments.length` — OwnershipChain.tsx:127.
     * `ownershipRecord.transferStatus.toLowerCase()` — xbarPhaseTwo.ts:290.
     *
     * The last two were excluded here once, on the grounds that their reads are
     * guarded — `record?.pendingDocuments ?? []` in the ownership selectors, and
     * `normalizeOwnershipRecord` mapped over the records in Ownership.tsx. Both
     * are true and neither generalises. OwnershipChain maps the RAW store
     * records, and Horses.tsx hands a raw record to
     * `buildHorsePacketCompleteness`, whose guard tests the record for
     * truthiness and then reads the field.
     *
     * One guarded read site says nothing about the others. Nothing belongs in
     * the excluded set unless EVERY read of it is guarded or the field cannot
     * arrive from a backup at all.
     */
    ownershipRecords: {
      /*
       * `proofRequirements` is optional on the record, so it is NOT in `lists`
       * — requiring it would turn away every record that has none, which is
       * most of them. `itemShapes` skips an absent array and checks the entries
       * of a present one, which is exactly the shape needed here.
       *
       * `{requirement.label}` renders at Ownership.tsx:410.
       * `normalizeOwnershipRecord` does not catch it either: its confidence
       * calculation reads only `status`.
       */
      itemShapes: {
        proofRequirements: { strings: ['id', 'kind', 'label', 'status'] },
        /*
         * `auditEvents` is optional too, and `auditEvents: [null]` threw on
         * `event.id` at Ownership.tsx:749. `normalizeOwnershipRecord` does not
         * help: it preserves the array untouched.
         *
         * `formatDateTimeLabel(event.at)` throws before React is reached;
         * `{event.actor}` and `{event.summary}` render directly. `action`,
         * `entityType` and `entityId` are not here — nothing in this view
         * reads them.
         */
        auditEvents: { strings: ['id', 'at', 'actor', 'summary'] },
      },
      strings: ['legalOwner', 'transferStatus'],
      lists: ['pendingDocuments'],
      // `auditTrail.map((entry) => <li key={entry}>{entry}</li>)` —
      // Ownership.tsx:791-792. The entries are rendered, so checking only the
      // container leaves `auditTrail: [{}]` crashing the record drawer.
      stringItems: ['auditTrail'],
    },
    /*
     * `packet.documentIds.length` — SalePacketStudio.tsx:174, Documents.tsx:1210
     * — was the only thing checked, and the line that renders that count also
     * renders three more fields beside it: `{packet.watermark}`,
     * `formatDateTimeLabel(packet.createdAt)` — which reaches `value?.trim()`
     * and throws before React is involved — and `{packet.createdBy}`.
     *
     * `fileName` is optional and rendered as `{packet.fileName ?? 'Sale
     * packet'}`; `??` catches null and undefined, never an object.
     *
     * `status` stays out: every read of it is an equality comparison in a
     * ternary, so an object falls to the else branch and crashes nothing.
     */
    salePacketBuilds: {
      lists: ['documentIds'],
      strings: ['id', 'watermark', 'createdAt', 'createdBy'],
      optionalStrings: ['fileName', 'downloadUrl'],
    },
    /*
     * `receipt.vendor.trim()` — Expenses.tsx:114 — was the only field checked,
     * and it is not the only one dereferenced:
     *
     *   receiptDate  `(receipt.receiptDate ?? '').slice(0, 7)` — Expenses.tsx:101,
     *                building the spend summary, and `??` does not catch an
     *                object. `b.receiptDate.localeCompare(...)` —
     *                FeedInventory.tsx:27 — has no guard at all.
     *   category     `receipt.category.toLowerCase()` — useXbarStore.ts:1326.
     *   title        rendered — Expenses.tsx:714.
     *   amount       summed into every money total. It does not throw; it
     *                yields NaN, which propagates silently into the invested
     *                figures, the CSV and the banker-facing PDF. A number that
     *                quietly corrupts the accounts is worse than one that
     *                crashes.
     */
    expenseReceipts: {
      strings: ['id', 'vendor', 'receiptDate', 'title', 'category'],
      numbers: ['amount'],
    },
    /*
     * Intake batches had no entry at all — only the shared id check — so
     * `{ id: 'batch-1', label: {}, state: 'Queued' }` restored and then crashed
     * the Documents route, which renders `{batch.label}`, `{batch.source}` and
     * four counters straight into JSX (Documents.tsx:670-682) and passes
     * `receivedAt` to `formatDateTimeLabel`, whose `value?.trim()` throws on an
     * object.
     *
     * `state` is deliberately absent: `restorePersistedState` runs
     * `normalizeBatchState` over every batch, so it cannot arrive malformed —
     * the one ground for exclusion besides "nothing reads it".
     *
     * Every field here has been required by IntakeBatch since the first commit
     * of types/xbar.ts, so requiring them cannot turn away a real archive.
     */
    intakeBatches: {
      strings: ['id', 'label', 'source', 'receivedAt'],
      numbers: ['fileCount', 'processedCount', 'matchedCount', 'needsReviewCount'],
    },
    /*
     * `event.actor.trim()` — BuyerResponseQueue.tsx:142 — was the only field
     * checked, and it is not the one that crashes first.
     * `formatDateLabel(event.at)` at :163 reaches `value?.trim()` and throws a
     * TypeError on an object before React is involved at all, and `{event.note
     * || ...}` at :169 renders a truthy object straight into JSX.
     *
     * `note` is optional and genuinely absent on most events, so it is checked
     * only when present.
     *
     * `horseId` is deliberately absent: it is compared, never dereferenced, so
     * an object there matches nothing and crashes nothing. `amount` likewise —
     * `formatCompactCurrency` renders it as "NaN" rather than throwing, which
     * is wrong on screen but not a crash, and the table has no vocabulary for
     * an optional number.
     */
    buyerRoomEvents: { strings: ['id', 'kind', 'at', 'actor'], optionalStrings: ['note'] },
    /*
     * `a.name/.category/.assignedTo.toLowerCase()` — RanchAssets.tsx:176-178,
     * evaluated only once someone types in the inventory search, so the route
     * renders first and crashes on the keystroke.
     */
    ranchAssets: {
      /*
       * The three searchable strings were the whole entry, and Equipment
       * renders five more: `{e.category} · {e.location}` at :111,
       * `{e.notes || `${e.status}${…e.nextService…}`}` at :114 — a `||` that
       * passes any truthy object — and `{e.condition}` at :117, which also
       * indexes CONDITION_TONE.
       */
      strings: ['id', 'name', 'category', 'assignedTo', 'location', 'status', 'condition', 'nextService', 'notes'],
    },
    /*
     * `lead.name.trim()` — BuyerResponseQueue.tsx:142 — plus `{lead.channel}`
     * and `{lead.stage}` rendered straight into JSX at Sales.tsx:498 and :502.
     * Validating only `name` let `{ id: 'lead-1', name: 'Buyer', channel: {} }`
     * install and then crash the Sales route.
     *
     * `lastTouch` is deliberately absent: it is sorted and passed around as a
     * due date, never given a string method, so requiring it would guard
     * nothing and could only turn away a valid archive.
     */
    salesLeads: { strings: ['id', 'name', 'channel', 'stage'] },
    /*
     * `listing.channels.includes()` — SharedAccess.tsx:33 — was the container
     * check, and the two fields rendered beside it went unchecked:
     * `{sharedListing?.state ?? horse.sale.listingState}` and
     * `{sharedListing?.accessMode ?? 'Private Token'}` — SharedAccess.tsx:269
     * and :272. `??` catches null and undefined; an object is truthy and
     * renders.
     *
     * `sharePath`, `shareToken` and the timestamps stay out: every read of them
     * is a comparison or a pass-through into a payload, never a dereference.
     */
    sharedListings: { lists: ['channels'], strings: ['id', 'state', 'accessMode'] },
    /*
     * `workspace.primaryModules.length` and `workspace.permissions.map()` —
     * Settings.tsx:1015 and :1019. This collection is covered by neither the id
     * loop nor normalization, and Settings is already MOUNTED when an import
     * lands, so the rerender crashes the screen the rancher is standing on.
     *
     * `role` and `label` are the same collection's scalar half, and validating
     * only the two arrays left them open: `{ role: {}, primaryModules: [],
     * permissions: [] }` passed, and `role` is rendered directly as a React
     * child at Settings.tsx:1014 — "Objects are not valid as a React child",
     * on the panel right beside the arrays this entry already protected.
     * `label` is read unguarded off the current role workspace at
     * Expenses.tsx:71 and seeds the receipt intake form.
     *
     * `summary` is deliberately absent: nothing reads it. The rule for leaving
     * a field out is that NO site reads it, never that one read happens to be
     * guarded.
     */
    /*
     * `roleLabel(member.role)` returns the role itself for anything but Owner,
     * straight into JSX — Settings.tsx:869. `{member.email}` renders at :867,
     * and `formatDateLabel(member.joinedAt)` at :870 throws on an object.
     *
     * Settings is MOUNTED while an import lands, so this crashes the screen the
     * rancher is standing on rather than one they might navigate to.
     *
     * `status` and `source` stay out: both are only ever compared.
     */
    workspaceMembers: { strings: ['id', 'email', 'role', 'joinedAt'] },
    /*
     * The same three, one panel down: `{invite.email}` at Settings.tsx:920,
     * `roleLabel(invite.role)` and `formatDateLabel(invite.invitedAt)` at :922.
     * `invitedBy` is stored and never read, so it is not required.
     */
    workspaceInvitations: { strings: ['id', 'email', 'role', 'invitedAt'] },
    roleWorkspaces: {
      strings: ['role', 'label'],
      lists: ['primaryModules'],
      // `permissions.map((permission) => <Pill key={permission}>{permission}</Pill>)`
      // — Settings.tsx:1019-1021. Same shape as `auditTrail` above: the
      // container was checked, the entries were not.
      stringItems: ['permissions'],
    },
  };

  /*
   * Entries may name a nested path. `readiness` being an object does not make
   * `readiness.blockers` an array, and `horse.readiness.blockers.filter(...)`
   * runs when the first qualifying photo is uploaded — after the media file is
   * already stored.
   *
   * Every path used here passes through a field this table also requires as an
   * object, so an absent parent is refused before the child is ever read.
   */
  const valueAtPath = (record: Record<string, unknown>, path: string): unknown =>
    path.split('.').reduce<unknown>((value, key) => {
      if (!value || typeof value !== 'object') return undefined;
      return (value as Record<string, unknown>)[key];
    }, record);

  for (const [collection, shape] of Object.entries(NESTED_SHAPES)) {
    const entries = state[collection];
    if (!Array.isArray(entries)) continue;

    for (const entry of entries as unknown[]) {
      const record = entry as Record<string, unknown>;
      for (const nested of shape.objects ?? []) {
        const value = valueAtPath(record, nested);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      }
      for (const list of shape.lists ?? []) {
        if (!Array.isArray(valueAtPath(record, list))) return false;
      }
      /*
       * A missing PRIMITIVE crashes the same way a missing object does — the
       * route calls a string method on `undefined`. The empty string is a valid
       * value (`receipt.vendor.trim() || 'Unspecified vendor'` is written to
       * expect it), so this checks the type, not the content.
       */
      for (const field of shape.strings ?? []) {
        if (typeof valueAtPath(record, field) !== 'string') return false;
      }
      /*
       * The entries, not just the container. A `null` in one of these arrays
       * throws on the first property access, and the routes reach for these
       * fields without checking.
       */
      for (const [list, itemShape] of Object.entries(shape.itemShapes ?? {})) {
        const entries = valueAtPath(record, list);
        /*
         * Absent is allowed HERE; requiring the array is `lists`' job.
         *
         * That split is what lets an optional collection be validated at all:
         * `ownershipRecords.proofRequirements` is optional and absent on most
         * records, so putting it in `lists` would refuse them. Every array that
         * must exist is named in `lists` as well, so nothing is weakened by
         * this — a missing `activity` still fails there.
         */
        if (entries === undefined || entries === null) continue;
        if (!Array.isArray(entries)) return false;
        for (const item of entries as unknown[]) {
          if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
          for (const field of itemShape.strings ?? []) {
            if (typeof (item as Record<string, unknown>)[field] !== 'string') return false;
          }
          /*
           * Absent is fine, wrong-typed is not. An optional field a backup
           * DOES supply still reaches the same render as a required one.
           */
          for (const field of itemShape.numbers ?? []) {
            if (!Number.isFinite((item as Record<string, unknown>)[field])) return false;
          }
          for (const field of itemShape.optionalStrings ?? []) {
            const value = (item as Record<string, unknown>)[field];
            if (value !== undefined && value !== null && typeof value !== 'string') return false;
          }
        }
      }
      /*
       * The string arrays. These entries are rendered directly — as a React
       * child and as that child's own key — so a non-string throws "Objects
       * are not valid as a React child" during the rerender, not at the read.
       */
      /*
       * Optional scalars on the record itself, resolved by path so a field
       * nested inside a validated object can be named.
       */
      for (const field of shape.optionalStrings ?? []) {
        const value = valueAtPath(record, field);
        if (value !== undefined && value !== null && typeof value !== 'string') return false;
      }
      /*
       * Numbers reach JSX the same way strings do. NaN is refused with them:
       * it is a number by `typeof` and renders as "NaN" on the screen.
       */
      for (const field of shape.numbers ?? []) {
        if (!Number.isFinite(valueAtPath(record, field))) return false;
      }
      for (const list of shape.stringItems ?? []) {
        const items = valueAtPath(record, list);
        if (!Array.isArray(items)) return false;
        for (const item of items as unknown[]) {
          if (typeof item !== 'string') return false;
        }
      }
    }
  }

  return true;
}

export function restorePersistedState(raw: unknown): PersistedXbarState {
  const state = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const horses = Array.isArray(state.horses)
    ? (state.horses as HorseRecord[]).map((horse) => ({
        ...horse,
        documentFacts: Array.isArray((horse as HorseRecord & { documentFacts?: DocumentFact[] }).documentFacts)
          ? ((horse as HorseRecord & { documentFacts?: DocumentFact[] }).documentFacts ?? [])
          : Array.isArray((horse as HorseRecord & { ocrFacts?: DocumentFact[] }).ocrFacts)
            ? ((horse as HorseRecord & { ocrFacts?: DocumentFact[] }).ocrFacts ?? [])
            : [],
      }))
    : initialState.horses;
  const documents = Array.isArray(state.documents)
    ? (state.documents as DocumentRecord[]).map((document) => ({
        ...document,
        state: normalizeDocumentState(document.state),
      }))
    : initialState.documents;
  const intakeBatchesSource = Array.isArray(state.intakeBatches)
    ? (state.intakeBatches as IntakeBatch[])
    : Array.isArray(state.ocrBatches)
      ? (state.ocrBatches as IntakeBatch[])
      : initialState.intakeBatches;
  const intakeBatches = intakeBatchesSource.map((batch) => ({
    ...batch,
    state: normalizeBatchState(batch.state),
  }));
  const salePacketBuilds = Array.isArray(state.salePacketBuilds) ? (state.salePacketBuilds as SalePacketBuild[]) : [];
  const usage = ((state.subscription as SubscriptionProfile | undefined)?.usage ?? {}) as Partial<
    SubscriptionProfile['usage']
  > & {
    ocrProcessed?: number;
    ocrLimit?: number;
    portalSeatsUsed?: number;
    portalSeatLimit?: number;
  };
  const subscription =
    state.subscription && typeof state.subscription === 'object'
      ? {
          ...(state.subscription as SubscriptionProfile),
          billingState: normalizeBillingState((state.subscription as SubscriptionProfile).billingState),
          // Both tier fields, not just the entitled one. `purchasedTier` is
          // what the billing screen indexes the plan tables with when a
          // subscription has lapsed, so an unknown value there is as fatal as
          // one in `tier` — and it is the field an old backup is most likely to
          // carry, since it holds whatever was bought however long ago.
          tier: normalizeTier((state.subscription as SubscriptionProfile).tier),
          purchasedTier: normalizeTier(
            (state.subscription as SubscriptionProfile).purchasedTier ??
              (state.subscription as SubscriptionProfile).tier,
          ),
          sharedAccessEnabled:
            (state.subscription as SubscriptionProfile).sharedAccessEnabled ??
            (state.subscription as SubscriptionProfile & { ownerPortalEnabled?: boolean }).ownerPortalEnabled ??
            initialState.subscription.sharedAccessEnabled,
          usage: {
            ...(state.subscription as SubscriptionProfile).usage,
            horsesUsed: usage.horsesUsed ?? horses.length,
            horseLimit: usage.horseLimit ?? initialState.subscription.usage.horseLimit,
            documentsProcessed: documents.filter((document) => document.state !== 'Archived').length,
            documentLimit: usage.documentLimit ?? usage.ocrLimit ?? initialState.subscription.usage.documentLimit,
            salePacketsGenerated: salePacketBuilds.length,
            salePacketLimit: usage.salePacketLimit ?? initialState.subscription.usage.salePacketLimit,
            sharedAccessSeatsUsed:
              usage.sharedAccessSeatsUsed ??
              usage.portalSeatsUsed ??
              initialState.subscription.usage.sharedAccessSeatsUsed,
            sharedAccessSeatLimit:
              usage.sharedAccessSeatLimit ??
              usage.portalSeatLimit ??
              initialState.subscription.usage.sharedAccessSeatLimit,
          },
        }
      : initialState.subscription;

  // Policy lives in subscriptionDecision; this is the ingest point that applies
  // it to the cloud import, the local rehydrate, and a hand-imported backup.
  const entitledSubscription = clampSubscriptionToEntitlement(subscription);
  const legacySavedHorseIds = Array.isArray(state.savedHorseIds) ? (state.savedHorseIds as string[]) : [];
  const sharedListings = Array.isArray(state.sharedListings)
    ? (state.sharedListings as SharedListingRecord[]).map((listing) =>
        createSharedListingRecord(listing.horseId, listing),
      )
    : legacySavedHorseIds.length
      ? legacySavedHorseIds.map((horseId) => createSharedListingRecord(horseId, { state: 'Draft' }))
      : initialState.sharedListings;
  const workspaceMembers = restoreWorkspaceMembers(state.workspaceMembers);
  const workspaceInvitations = restoreWorkspaceInvitations(state.workspaceInvitations);
  const workspaceProfile = restoreWorkspaceProfile(state.workspaceProfile);
  const normalizedWorkspaceMembers =
    workspaceMembers.length || !workspaceProfile.setupCompleteAt
      ? workspaceMembers
      : [createInitialWorkspaceMember(workspaceProfile)];
  const baseState: PersistedXbarState = {
    horses,
    documents,
    intakeBatches,
    ownershipRecords: Array.isArray(state.ownershipRecords)
      ? (state.ownershipRecords as OwnershipRecord[]).map((record) => normalizeOwnershipRecord(record))
      : initialState.ownershipRecords,
    auditEvents: Array.isArray(state.auditEvents) ? (state.auditEvents as AuditEvent[]) : [],
    salePacketBuilds,
    buyerRoomEvents: Array.isArray(state.buyerRoomEvents) ? (state.buyerRoomEvents as BuyerRoomEvent[]) : [],
    expenseReceipts: Array.isArray(state.expenseReceipts)
      ? (state.expenseReceipts as ExpenseReceipt[])
      : initialState.expenseReceipts,
    ranchAssets: Array.isArray(state.ranchAssets) ? (state.ranchAssets as RanchAsset[]) : initialState.ranchAssets,
    subscription: entitledSubscription,
    roleWorkspaces: Array.isArray(state.roleWorkspaces)
      ? (state.roleWorkspaces as RoleWorkspace[])
      : initialState.roleWorkspaces,
    salesLeads: Array.isArray(state.salesLeads)
      ? (state.salesLeads as SalesLead[]).map((lead) => ({
          ...lead,
          offerStatus: lead.offerStatus ?? (lead.offerAmount ? 'Submitted' : 'Draft'),
          depositStatus: lead.depositStatus ?? 'Not Requested',
          shareReady: lead.shareReady ?? (lead as SalesLead & { ownerPortalReady?: boolean }).ownerPortalReady ?? false,
        }))
      : initialState.salesLeads,
    sharedListings,
    sharedAccess:
      state.sharedAccess && typeof state.sharedAccess === 'object'
        ? (state.sharedAccess as SharedAccessSnapshot)
        : state.portal && typeof state.portal === 'object'
          ? (state.portal as SharedAccessSnapshot)
          : initialState.sharedAccess,
    workspaceMembers: normalizedWorkspaceMembers,
    workspaceInvitations,
    workspaceProfile,
  };
  const derived = syncDerivedValues({
    horses: baseState.horses,
    salesLeads: baseState.salesLeads,
    sharedListings: baseState.sharedListings,
    sharedAccess: baseState.sharedAccess,
    workspaceMembers: normalizedWorkspaceMembers,
    workspaceInvitations: baseState.workspaceInvitations,
    subscription: baseState.subscription,
  });

  return {
    ...baseState,
    horses: derived.horses,
    sharedAccess: derived.sharedAccess,
    subscription: derived.subscription,
  };
}

export function createHorseRecord(input: NewHorseInput, workspaceProfile: WorkspaceProfile): HorseRecord {
  const id = createId('horse');
  const name = input.name.trim().toUpperCase();
  const barnName = input.barnName.trim();
  const ranchName = workspaceProfile.ranchName.trim() || 'Primary Ranch';
  const ranchManagerName = workspaceProfile.ranchManagerName.trim() || 'Unassigned';
  const operationsEmail = workspaceProfile.operationsEmail.trim();
  // Combine a parent's name with its registration number for the bloodline
  // text field, e.g. "SHINING SPARK (AQHA 3038883)".
  const withRegistration = (parentName?: string, registration?: string) => {
    const trimmedName = parentName?.trim() ?? '';
    if (!trimmedName) return '';
    const trimmedReg = registration?.trim();
    return trimmedReg ? `${trimmedName} (${trimmedReg})` : trimmedName;
  };
  return {
    id,
    name,
    barnName,
    summary: '',
    segment: input.segment,
    status: input.status,
    breed: input.breed?.trim() || '',
    registry: input.registry?.trim() || (input.aqhaNumber?.trim() ? 'AQHA' : ''),
    aqhaNumber: input.aqhaNumber?.trim() || '',
    registrationNumber: input.registrationNumber?.trim() || '',
    registered: Boolean(input.aqhaNumber || input.registrationNumber),
    age: 0,
    foaledOn: input.foaledOn?.trim() || '',
    sex: input.sex,
    color: input.color?.trim() || '',
    markings: '',
    microchipId: '',
    owner: input.owner.trim(),
    ownerEntity: input.ownerEntity.trim(),
    insuredValue: 0,
    profileImage: '',
    tags: ['intake-pending'],
    bloodline: {
      sire: withRegistration(input.sire, input.sireRegistration),
      dam: withRegistration(input.dam, input.damRegistration),
      family: '',
    },
    location: {
      ranch: ranchName,
      barn: input.barn.trim(),
      pasture: input.pasture.trim(),
      stall: 'Unassigned',
    },
    assignments: {
      trainer: 'Unassigned',
      ranchManager: ranchManagerName,
      veterinarian: 'Pending',
      farrier: 'Pending',
    },
    ownership: [
      {
        id: createId('stake'),
        name: input.owner.trim(),
        share: 100,
        role: 'Legal Owner',
        contact: operationsEmail,
      },
    ],
    gallery: [],
    sale: {
      listingState: 'Hold',
      askPrice: 0,
      buyerConfidence: 0,
      inquiryCount: 0,
      watchlistCount: 0,
      socialReady: false,
    },
    readiness: {
      score: 0,
      blockers: [
        'Registration not verified',
        'Ownership packet not uploaded',
        'Medical summary not reviewed',
        'Sale photos missing',
      ],
      packetStatus: 'Needs Transfer Docs',
    },
    medicalNotes: '',
    lastVetVisit: '',
    documents: [],
    medicalTimeline: [],
    breedingTimeline: [],
    activity: [
      {
        id: createId('activity'),
        date: todayStamp(),
        title: 'Horse record created',
        summary: 'Initial horse profile created inside the live XBAR workspace.',
        owner: 'Ranch Staff',
        category: 'Operations',
      },
    ],
    documentFacts: [],
    alerts: [
      {
        id: createId('alert'),
        title: 'Complete horse record',
        summary:
          'Registration, media, medical, and ownership details must be verified before this record is ready to share.',
        severity: 'medium',
        module: 'Documents',
      },
    ],
    notes: [],
  };
}

export function guessHorseSexFromDocuments(documents: DocumentRecord[]): NewHorseInput['sex'] {
  // Prefer a sex that the registration extractor already resolved per document.
  const extracted = documents
    .map((document) => document.entities.sex?.trim())
    .find((value): value is NewHorseInput['sex'] =>
      Boolean(value && ['Mare', 'Stud', 'Gelding', 'Filly', 'Colt'].includes(value)),
    );
  if (extracted) return extracted;

  const haystack =
    `${documents.map((document) => `${document.title} ${document.extractedTextPreview}`).join(' ')}`.toLowerCase();
  if (haystack.includes('gelding')) return 'Gelding';
  if (haystack.includes('stud') || haystack.includes('stallion')) return 'Stud';
  if (haystack.includes('colt')) return 'Colt';
  if (haystack.includes('filly')) return 'Filly';
  return 'Mare';
}

export function inferHorseNameFromDocumentTitle(title: string) {
  const normalized = title
    .replace(/[-_]/g, ' ')
    .replace(
      /\b(registration|certificate|papers?|coggins|health|bill\s+of\s+sale|transfer|packet|vet|record|scan|copy|document|doc|pdf|jpg|jpeg|png)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[A-Za-z]/.test(normalized) || normalized.length < 3) {
    return '';
  }

  return normalized;
}

export function buildHorseInputFromDocuments(
  documents: DocumentRecord[],
  workspaceProfile: WorkspaceProfile,
): NewHorseInput | null {
  const horseName =
    documents.map((document) => document.entities.horseName?.trim()).find(Boolean) ??
    documents.map((document) => inferHorseNameFromDocumentTitle(document.title)).find((title) => title.length >= 3) ??
    '';
  const registrationNumber =
    documents.map((document) => document.entities.registrationNumber?.trim()).find(Boolean) ?? '';
  const ownerName =
    documents.map((document) => document.entities.ownerName?.trim()).find(Boolean) ??
    workspaceProfile.defaultOwnerName.trim() ??
    '';
  const ownerEntity =
    workspaceProfile.defaultOwnerEntity.trim() || workspaceProfile.businessName.trim() || ownerName || '';

  if (!horseName && !registrationNumber) {
    return null;
  }

  // First non-empty value for a given entity field across all grouped documents.
  const firstEntity = (key: keyof DocumentRecord['entities']) =>
    documents.map((document) => document.entities[key]?.trim()).find(Boolean) ?? '';

  const registry = firstEntity('registry');
  const normalizedHorseName = (horseName || registrationNumber).trim().toUpperCase();
  const normalizedBarnName = normalizedHorseName.split(/\s+/).slice(0, 2).join(' ') || normalizedHorseName;
  const isAqha = registry.toUpperCase() === 'AQHA' || registrationNumber.toUpperCase().startsWith('AQHA');

  return {
    name: normalizedHorseName,
    barnName: normalizedBarnName,
    segment: 'Sale Prospect',
    status: 'Sale Prep',
    sex: guessHorseSexFromDocuments(documents),
    owner: ownerName || 'Pending Owner',
    ownerEntity: ownerEntity || 'Pending Entity',
    aqhaNumber: isAqha ? registrationNumber : '',
    registrationNumber,
    registry,
    color: firstEntity('color'),
    breed: firstEntity('breed'),
    foaledOn: firstEntity('foaledOn'),
    sire: firstEntity('sire'),
    sireRegistration: firstEntity('sireRegistration'),
    dam: firstEntity('dam'),
    damRegistration: firstEntity('damRegistration'),
    barn: workspaceProfile.defaultBarn.trim() || 'Main Barn',
    pasture: workspaceProfile.defaultPasture.trim() || 'Pending Pasture',
  };
}

export function createHorseFromDocuments(documents: DocumentRecord[], workspaceProfile: WorkspaceProfile) {
  const horseInput = buildHorseInputFromDocuments(documents, workspaceProfile);
  if (!horseInput) {
    return null;
  }

  const horse = createHorseRecord(horseInput, workspaceProfile);
  const readyDocuments = documents.map((document) => ({
    ...document,
    horseId: horse.id,
    state: 'Ready' as const,
    confidence: Math.max(document.confidence, 0.91),
    duplicateRisk: document.duplicateRisk === 'Possible Duplicate' ? 'Review' : document.duplicateRisk,
    entities: {
      ...document.entities,
      horseName: document.entities.horseName ?? horse.name,
      ownerName: document.entities.ownerName ?? horse.owner,
      registrationNumber: document.entities.registrationNumber ?? horse.registrationNumber,
    },
    summary: `${document.title} was used to create ${horse.name} and is now attached to the new horse profile.`,
  }));
  const promotedHorse = readyDocuments.reduce(promoteDocument, horse);
  const ownershipRecord = {
    ...createOwnershipRecord(promotedHorse),
    legalOwner: horse.owner,
    pendingDocuments: readyDocuments
      .filter((document) => document.type === 'Transfer Packet' || document.type === 'Bill of Sale')
      .map((document) => document.title),
    confidence: readyDocuments.some((document) => document.type === 'Registration') ? 78 : 52,
  };

  return {
    horse: promotedHorse,
    documents: readyDocuments,
    ownershipRecord,
  };
}

export function promoteDocument(horse: HorseRecord, document: DocumentRecord): HorseRecord {
  const nextDocumentIds = horse.documents.includes(document.id) ? horse.documents : [...horse.documents, document.id];
  const nextFacts = [...horse.documentFacts];
  Object.entries(document.entities)
    .filter(([, value]) => Boolean(value))
    .forEach(([label, value]) => {
      const factId = `${document.id}-${label}`;
      if (!nextFacts.some((fact) => fact.id === factId)) {
        nextFacts.push({
          id: factId,
          label,
          value: String(value),
          confidence: document.confidence,
          sourceDocumentId: document.id,
        });
      }
    });

  const nextReadiness = { ...horse.readiness };
  if (document.type === 'Media Kit') {
    nextReadiness.score = Math.min(100, horse.readiness.score + 6);
    nextReadiness.packetStatus = nextReadiness.packetStatus === 'Needs Photos' ? 'Ready' : nextReadiness.packetStatus;
  }
  if (document.type === 'Transfer Packet') {
    nextReadiness.score = Math.min(100, nextReadiness.score + 4);
    nextReadiness.packetStatus = 'Ready';
  }
  if (document.type === 'Vet Record' && horse.status === 'Medical Review') {
    nextReadiness.score = Math.min(100, nextReadiness.score + 3);
  }

  return {
    ...horse,
    documents: nextDocumentIds,
    documentFacts: nextFacts,
    readiness: nextReadiness,
    sale: {
      ...horse.sale,
      socialReady: horse.sale.socialReady || document.type === 'Media Kit',
    },
    activity: [
      {
        id: createId('activity'),
        date: todayStamp(),
        title: `${document.type} attached`,
        summary: `${document.title} was promoted into the horse profile.`,
        owner: document.uploadedBy,
        category:
          document.type === 'Vet Record' ? 'Medical' : document.type === 'Transfer Packet' ? 'Ownership' : 'Operations',
      },
      ...horse.activity,
    ],
  };
}

export function createTimelineEvent(params: {
  title: string;
  summary: string;
  owner: string;
  date: string;
  category: 'Medical' | 'Breeding' | 'Ownership' | 'Sales' | 'Operations';
  status?: string;
  severity?: 'low' | 'medium' | 'high';
}) {
  return {
    id: createId('event'),
    title: params.title.trim(),
    summary: params.summary.trim(),
    owner: params.owner.trim(),
    date: params.date,
    category: params.category,
    status: params.status,
    severity: params.severity,
  } as const;
}

export function requireRoleCapability(role: UserRole, capability: RoleCapability) {
  return hasRoleCapability(role, capability) ? null : getCapabilityDeniedMessage(capability);
}

export function normalizeUsage(value: number) {
  return Math.round(value * 1000) / 1000;
}
