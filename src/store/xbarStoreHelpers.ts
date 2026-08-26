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
  const NESTED_SHAPES: Record<string, { objects?: string[]; lists?: string[]; strings?: string[] }> = {
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
        // `horse.readiness.blockers.filter()` — useXbarStore.ts:1205, on the
        // first qualifying photo upload, after the media file is stored.
        'readiness.blockers',
      ],
      // `horse.name.toLowerCase` — Breeding.tsx:292.
      // `horse.owner` → `rawName.trim()` — commandPalette.ts:121.
      // `h.segment.toLowerCase()` — Sales.tsx:320.
      strings: ['name', 'owner', 'segment'],
    },
    // `document.entities.horseName` and four siblings — Documents.tsx:724.
    // `document.title.trim()` — useXbarStore.ts:842, beside optional-chained
    // siblings, which is what makes it easy to miss.
    documents: { objects: ['entities'], strings: ['title'] },
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
      strings: ['legalOwner', 'transferStatus'],
      lists: ['auditTrail', 'pendingDocuments'],
    },
    // `packet.documentIds.length` — SalePacketStudio.tsx:174, Documents.tsx:1210.
    salePacketBuilds: { lists: ['documentIds'] },
    // `receipt.vendor.trim()` — Expenses.tsx:114.
    expenseReceipts: { strings: ['vendor'] },
    // `event.actor.trim()` — BuyerResponseQueue.tsx:142.
    buyerRoomEvents: { strings: ['actor'] },
    /*
     * `a.name/.category/.assignedTo.toLowerCase()` — RanchAssets.tsx:176-178,
     * evaluated only once someone types in the inventory search, so the route
     * renders first and crashes on the keystroke.
     */
    ranchAssets: { strings: ['name', 'category', 'assignedTo'] },
    // `lead.name.trim()` — BuyerResponseQueue.tsx:142.
    salesLeads: { strings: ['name'] },
    // `listing.channels.includes()` — SharedAccess.tsx:33.
    sharedListings: { lists: ['channels'] },
    /*
     * `workspace.primaryModules.length` and `workspace.permissions.map()` —
     * Settings.tsx:1015 and :1019. This collection is covered by neither the id
     * loop nor normalization, and Settings is already MOUNTED when an import
     * lands, so the rerender crashes the screen the rancher is standing on.
     */
    roleWorkspaces: { lists: ['primaryModules', 'permissions'] },
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
