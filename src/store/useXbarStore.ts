import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { documentsSeed, intakeBatchesSeed } from '@/data/xbarDocuments';
import { horsesSeed } from '@/data/xbarHorses';
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
  buildDocumentRecord,
  buildSharePath,
  createId,
  createNumericToken,
  deriveSharedAccessSnapshot,
  estimateStorageGb,
  guessGalleryKind,
  nowStamp,
  readFileAsDataUrl,
  todayStamp,
} from '@/lib/xbarRuntime';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { getCapabilityDeniedMessage, hasRoleCapability } from '@/lib/permissions';
import { uploadDocumentAssetToCloud, uploadMediaAssetToCloud } from '@/lib/cloudWorkspace';
import { workspaceStateStorage } from '@/lib/workspaceStorage';
import {
  createOwnershipRecord,
  validateExpenseReceiptInput,
  summarizeBatch,
  validateAssetPatch,
  validateHorseNoteInput,
  validateLeadInput,
  validateLocationPatch,
  validateNewHorseInput,
} from '@/store/xbarStoreLogic';
import type {
  DocumentFact,
  ExpenseReceipt,
  HorseNote,
  HorseRecord,
  IntakeBatch,
  OwnershipStake,
  RoleCapability,
  SalesLead,
  SharedListingRecord,
  SharedAccessSnapshot,
  SharedChannel,
  UserRole,
  WorkspaceProfile,
} from '@/types/xbar';
import type {
  DocumentRecord,
  OwnershipRecord,
  RanchAsset,
  RoleWorkspace,
  SubscriptionProfile,
} from '@/types/xbar';
import type { AssetPatch, DocumentIntakeInput, ExpenseReceiptInput, LeadInput, LocationPatch, MediaUploadInput, NewHorseInput } from '@/store/xbarStoreLogic';

type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
};

type XbarStore = {
  currentRole: UserRole;
  horses: HorseRecord[];
  documents: DocumentRecord[];
  intakeBatches: IntakeBatch[];
  ownershipRecords: OwnershipRecord[];
  expenseReceipts: ExpenseReceipt[];
  ranchAssets: RanchAsset[];
  subscription: SubscriptionProfile;
  roleWorkspaces: RoleWorkspace[];
  salesLeads: SalesLead[];
  sharedListings: SharedListingRecord[];
  sharedAccess: SharedAccessSnapshot;
  workspaceProfile: WorkspaceProfile;
  setCurrentRole: (role: UserRole) => void;
  updateWorkspaceProfile: (patch: Partial<WorkspaceProfile>) => ActionResult;
  toggleSharedListing: (horseId: string) => ActionResult;
  recordSharedChannel: (horseId: string, channel: SharedChannel) => void;
  addHorse: (input: NewHorseInput) => ActionResult;
  createDocumentIntake: (input: DocumentIntakeInput) => Promise<ActionResult>;
  reviewDocument: (documentId: string, horseId?: string) => ActionResult;
  discardDocument: (documentId: string) => ActionResult;
  uploadHorseMedia: (input: MediaUploadInput) => Promise<ActionResult>;
  addExpenseReceipt: (input: ExpenseReceiptInput) => Promise<ActionResult>;
  createSalesLead: (input: LeadInput) => ActionResult;
  updateSalesLead: (
    leadId: string,
    patch: Partial<Pick<SalesLead, 'stage' | 'lastTouch' | 'nextFollowUp' | 'notes' | 'offerAmount' | 'savedListing' | 'shareReady' | 'outcome'>>,
  ) => ActionResult;
  updateAsset: (assetId: string, patch: AssetPatch) => ActionResult;
  addHorseNote: (horseId: string, note: Pick<HorseNote, 'title' | 'body' | 'author' | 'tone'>) => ActionResult;
  addMedicalEvent: (horseId: string, event: Pick<HorseNote, 'title' | 'body' | 'author'> & { date: string }) => ActionResult;
  addBreedingEvent: (horseId: string, event: Pick<HorseNote, 'title' | 'body' | 'author'> & { date: string }) => ActionResult;
  updateHorseLocation: (horseId: string, patch: LocationPatch) => ActionResult;
  updateOwnershipRecord: (
    recordId: string,
    patch: Partial<Pick<OwnershipRecord, 'legalOwner' | 'transferStatus' | 'complianceDeadline' | 'pendingDocuments'>>,
  ) => ActionResult;
  addOwnershipAuditEntry: (recordId: string, entry: string) => ActionResult;
  addOwnershipStake: (horseId: string, stake: Omit<OwnershipStake, 'id'>) => ActionResult;
  exportWorkspaceBackup: () => WorkspaceBackup;
  importWorkspaceBackup: (backup: unknown) => ActionResult;
};

type PersistedXbarState = Pick<
  XbarStore,
  | 'horses'
  | 'documents'
  | 'intakeBatches'
  | 'ownershipRecords'
  | 'expenseReceipts'
  | 'ranchAssets'
  | 'subscription'
  | 'roleWorkspaces'
  | 'salesLeads'
  | 'sharedListings'
  | 'sharedAccess'
  | 'workspaceProfile'
>;

type WorkspaceBackup = {
  app: 'XBAR';
  version: number;
  exportedAt: string;
  workspace: PersistedXbarState;
};

const WORKSPACE_SCHEMA_VERSION = 6;

const initialState = {
  currentRole: (isSupabaseConfigured() ? 'Owner' : 'Admin') as UserRole,
  horses: horsesSeed,
  documents: documentsSeed,
  intakeBatches: intakeBatchesSeed,
  ownershipRecords: ownershipSeed,
  expenseReceipts: expenseReceiptsSeed,
  ranchAssets: ranchAssetsSeed,
  subscription: subscriptionSeed,
  roleWorkspaces: roleSeed,
  salesLeads: salesLeadsSeed,
  sharedListings: sharedListingsSeed,
  sharedAccess: deriveSharedAccessSnapshot(sharedAccessSeed, sharedListingsSeed, salesLeadsSeed),
  workspaceProfile: workspaceProfileSeed,
};

function syncDerivedValues(state: Pick<XbarStore, 'horses' | 'salesLeads' | 'sharedListings' | 'sharedAccess'>) {
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

  return {
    horses,
    sharedAccess: deriveSharedAccessSnapshot(state.sharedAccess, state.sharedListings, state.salesLeads),
  };
}

function normalizeDocumentState(value: unknown): DocumentRecord['state'] {
  if (value === 'Queued' || value === 'Needs Review' || value === 'Matched' || value === 'Ready' || value === 'Archived') {
    return value;
  }
  return 'Needs Review';
}

function normalizeBatchState(value: unknown): IntakeBatch['state'] {
  if (value === 'Completed' || value === 'Reviewing' || value === 'Queued') {
    return value;
  }
  return 'Reviewing';
}

function normalizeBillingState(value: unknown): SubscriptionProfile['billingState'] {
  if (value === 'Active' || value === 'Past Due' || value === 'Manual Billing') {
    return value;
  }
  return 'Manual Billing';
}

function restoreWorkspaceProfile(raw: unknown): WorkspaceProfile {
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
  };
}

function createSharedListingRecord(horseId: string, patch?: Partial<SharedListingRecord>): SharedListingRecord {
  const timestamp = todayStamp();
  return {
    id: patch?.id ?? createId('share'),
    horseId,
    sharePath: patch?.sharePath ?? buildSharePath(horseId),
    state: patch?.state ?? 'Draft',
    channels: patch?.channels?.length ? patch.channels : ['Direct Link'],
    createdAt: patch?.createdAt ?? timestamp,
    updatedAt: patch?.updatedAt ?? timestamp,
    lastSharedAt: patch?.lastSharedAt,
  };
}

function createExpenseReceiptRecord(
  input: ExpenseReceiptInput,
  patch?: Partial<Pick<ExpenseReceipt, 'fileUrl' | 'storagePath' | 'fileName' | 'mimeType' | 'fileSizeBytes'>>,
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
    storagePath: patch?.storagePath,
    fileName: patch?.fileName ?? file?.name,
    mimeType: patch?.mimeType ?? file?.type ?? undefined,
    fileSizeBytes: patch?.fileSizeBytes ?? file?.size,
  };
}

function selectPersistedState(state: PersistedXbarState): PersistedXbarState {
  return {
    horses: state.horses,
    documents: state.documents,
    intakeBatches: state.intakeBatches,
    ownershipRecords: state.ownershipRecords,
    expenseReceipts: state.expenseReceipts,
    ranchAssets: state.ranchAssets,
    subscription: state.subscription,
    roleWorkspaces: state.roleWorkspaces,
    salesLeads: state.salesLeads,
    sharedListings: state.sharedListings,
    sharedAccess: state.sharedAccess,
    workspaceProfile: state.workspaceProfile,
  };
}

function restorePersistedState(raw: unknown): PersistedXbarState {
  const state = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const horses = Array.isArray(state.horses)
    ? (state.horses as HorseRecord[]).map((horse) => ({
        ...horse,
        documentFacts: Array.isArray((horse as HorseRecord & { documentFacts?: DocumentFact[] }).documentFacts)
          ? (horse as HorseRecord & { documentFacts?: DocumentFact[] }).documentFacts ?? []
          : Array.isArray((horse as HorseRecord & { ocrFacts?: DocumentFact[] }).ocrFacts)
            ? (horse as HorseRecord & { ocrFacts?: DocumentFact[] }).ocrFacts ?? []
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
  const usage = ((state.subscription as SubscriptionProfile | undefined)?.usage ?? {}) as Partial<SubscriptionProfile['usage']> & {
    ocrProcessed?: number;
    ocrLimit?: number;
    portalSeatsUsed?: number;
    portalSeatLimit?: number;
  };
  const subscription = state.subscription && typeof state.subscription === 'object'
    ? {
        ...(state.subscription as SubscriptionProfile),
        billingState: normalizeBillingState((state.subscription as SubscriptionProfile).billingState),
        sharedAccessEnabled:
          (state.subscription as SubscriptionProfile).sharedAccessEnabled ??
          (state.subscription as SubscriptionProfile & { ownerPortalEnabled?: boolean }).ownerPortalEnabled ??
          initialState.subscription.sharedAccessEnabled,
        usage: {
          ...(state.subscription as SubscriptionProfile).usage,
          documentsProcessed: usage.documentsProcessed ?? usage.ocrProcessed ?? initialState.subscription.usage.documentsProcessed,
          documentLimit: usage.documentLimit ?? usage.ocrLimit ?? initialState.subscription.usage.documentLimit,
          sharedAccessSeatsUsed:
            usage.sharedAccessSeatsUsed ?? usage.portalSeatsUsed ?? initialState.subscription.usage.sharedAccessSeatsUsed,
          sharedAccessSeatLimit:
            usage.sharedAccessSeatLimit ?? usage.portalSeatLimit ?? initialState.subscription.usage.sharedAccessSeatLimit,
        },
      }
    : initialState.subscription;
  const legacySavedHorseIds = Array.isArray(state.savedHorseIds) ? (state.savedHorseIds as string[]) : [];
  const sharedListings = Array.isArray(state.sharedListings)
    ? (state.sharedListings as SharedListingRecord[]).map((listing) => createSharedListingRecord(listing.horseId, listing))
    : legacySavedHorseIds.length
      ? legacySavedHorseIds.map((horseId) => createSharedListingRecord(horseId, { state: 'Draft' }))
      : initialState.sharedListings;
  const baseState: PersistedXbarState = {
    horses,
    documents,
    intakeBatches,
    ownershipRecords: Array.isArray(state.ownershipRecords) ? (state.ownershipRecords as OwnershipRecord[]) : initialState.ownershipRecords,
    expenseReceipts: Array.isArray(state.expenseReceipts) ? (state.expenseReceipts as ExpenseReceipt[]) : initialState.expenseReceipts,
    ranchAssets: Array.isArray(state.ranchAssets) ? (state.ranchAssets as RanchAsset[]) : initialState.ranchAssets,
    subscription,
    roleWorkspaces: Array.isArray(state.roleWorkspaces) ? (state.roleWorkspaces as RoleWorkspace[]) : initialState.roleWorkspaces,
    salesLeads: Array.isArray(state.salesLeads)
      ? (state.salesLeads as SalesLead[]).map((lead) => ({
          ...lead,
          shareReady:
            lead.shareReady ??
            (lead as SalesLead & { ownerPortalReady?: boolean }).ownerPortalReady ??
            false,
        }))
      : initialState.salesLeads,
    sharedListings,
    sharedAccess:
      state.sharedAccess && typeof state.sharedAccess === 'object'
        ? (state.sharedAccess as SharedAccessSnapshot)
        : state.portal && typeof state.portal === 'object'
          ? (state.portal as SharedAccessSnapshot)
          : initialState.sharedAccess,
    workspaceProfile: restoreWorkspaceProfile(state.workspaceProfile),
  };
  const derived = syncDerivedValues({
    horses: baseState.horses,
    salesLeads: baseState.salesLeads,
    sharedListings: baseState.sharedListings,
    sharedAccess: baseState.sharedAccess,
  });

  return {
    ...baseState,
    horses: derived.horses,
    sharedAccess: derived.sharedAccess,
  };
}

function createHorseRecord(input: NewHorseInput, workspaceProfile: WorkspaceProfile): HorseRecord {
  const id = createId('horse');
  const name = input.name.trim().toUpperCase();
  const barnName = input.barnName.trim();
  const ranchName = workspaceProfile.ranchName.trim() || 'Primary Ranch';
  const ranchManagerName = workspaceProfile.ranchManagerName.trim() || 'Unassigned';
  const operationsEmail = workspaceProfile.operationsEmail.trim();
  return {
    id,
    name,
    barnName,
    summary: `${barnName} is a newly staged XBAR horse record ready for intake, media, ownership, and care workflows.`,
    segment: input.segment,
    status: input.status,
    breed: 'Quarter Horse',
    registry: 'AQHA',
    aqhaNumber: input.aqhaNumber?.trim() || `AQHA-${Date.now().toString().slice(-6)}`,
    registrationNumber: input.registrationNumber?.trim() || `${barnName.toUpperCase().replace(/\s+/g, '-')}-${new Date().getFullYear()}`,
    registered: Boolean(input.aqhaNumber || input.registrationNumber),
    age: 4,
    foaledOn: `${new Date().getFullYear() - 4}-03-01`,
    sex: input.sex,
    color: 'To be confirmed',
    markings: 'Intake photos pending',
    microchipId: `9810${createNumericToken(10)}`,
    owner: input.owner.trim(),
    ownerEntity: input.ownerEntity.trim(),
    insuredValue: 65000,
    profileImage: '',
    tags: ['new-intake', 'media-needed'],
    bloodline: {
      sire: 'Pending intake',
      dam: 'Pending intake',
      family: 'Pending pedigree review',
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
      buyerConfidence: 50,
      inquiryCount: 0,
      watchlistCount: 0,
      socialReady: false,
    },
    readiness: {
      score: 42,
      blockers: ['Hero image missing', 'Ownership packet not uploaded', 'Medical summary not reviewed'],
      packetStatus: 'Needs Photos',
    },
    medicalNotes: 'Initial intake complete. Clinical review pending.',
    lastVetVisit: todayStamp(),
    documents: [],
    medicalTimeline: [],
    breedingTimeline: [],
    activity: [
      {
        id: createId('activity'),
        date: todayStamp(),
        title: 'Horse record created',
        summary: 'Initial horse profile created inside the live XBAR workspace.',
        owner: 'Ops Desk',
        category: 'Operations',
      },
    ],
    documentFacts: [],
    alerts: [
      {
        id: createId('alert'),
        title: 'Finish intake packet',
        summary: 'Media, registration, and initial ownership documents still need to be uploaded.',
        severity: 'medium',
        module: 'Documents',
      },
    ],
    notes: [],
  };
}

function guessHorseSexFromDocuments(documents: DocumentRecord[]): NewHorseInput['sex'] {
  const haystack = `${documents.map((document) => `${document.title} ${document.extractedTextPreview}`).join(' ')}`.toLowerCase();
  if (haystack.includes('gelding')) return 'Gelding';
  if (haystack.includes('stud') || haystack.includes('stallion') || haystack.includes('colt')) return 'Stud';
  if (haystack.includes('filly')) return 'Filly';
  return 'Mare';
}

function buildHorseInputFromDocuments(documents: DocumentRecord[], workspaceProfile: WorkspaceProfile): NewHorseInput | null {
  const horseName =
    documents.map((document) => document.entities.horseName?.trim()).find(Boolean) ??
    documents
      .map((document) => document.title.replace(/[-_]/g, ' ').trim())
      .find((title) => title.length >= 3) ??
    '';
  const registrationNumber = documents.map((document) => document.entities.registrationNumber?.trim()).find(Boolean) ?? '';
  const ownerName =
    documents.map((document) => document.entities.ownerName?.trim()).find(Boolean) ??
    workspaceProfile.defaultOwnerName.trim() ??
    '';
  const ownerEntity = workspaceProfile.defaultOwnerEntity.trim() || workspaceProfile.businessName.trim() || ownerName || '';

  if (!horseName && !registrationNumber) {
    return null;
  }

  const normalizedHorseName = (horseName || registrationNumber).trim().toUpperCase();
  const normalizedBarnName = normalizedHorseName.split(/\s+/).slice(0, 2).join(' ') || normalizedHorseName;

  return {
    name: normalizedHorseName,
    barnName: normalizedBarnName,
    segment: 'Sale Prospect',
    status: 'Sale Prep',
    sex: guessHorseSexFromDocuments(documents),
    owner: ownerName || 'Pending Owner',
    ownerEntity: ownerEntity || 'Pending Entity',
    aqhaNumber: registrationNumber.startsWith('AQHA') ? registrationNumber : '',
    registrationNumber,
    barn: workspaceProfile.defaultBarn.trim() || 'Intake Barn',
    pasture: workspaceProfile.defaultPasture.trim() || 'Pending Pasture',
  };
}

function createHorseFromDocuments(documents: DocumentRecord[], workspaceProfile: WorkspaceProfile) {
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

function promoteDocument(horse: HorseRecord, document: DocumentRecord): HorseRecord {
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
        category: document.type === 'Vet Record' ? 'Medical' : document.type === 'Transfer Packet' ? 'Ownership' : 'Operations',
      },
      ...horse.activity,
    ],
  };
}

function createTimelineEvent(params: {
  title: string;
  summary: string;
  owner: string;
  date: string;
  category: 'Medical' | 'Breeding' | 'Ownership' | 'Sales' | 'Operations';
}) {
  return {
    id: createId('event'),
    title: params.title.trim(),
    summary: params.summary.trim(),
    owner: params.owner.trim(),
    date: params.date,
    category: params.category,
  } as const;
}

function requireRoleCapability(role: UserRole, capability: RoleCapability) {
  return hasRoleCapability(role, capability) ? null : getCapabilityDeniedMessage(capability);
}

export const useXbarStore = create<XbarStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setCurrentRole: (role) => set({ currentRole: role }),
      updateWorkspaceProfile: (patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const nextProfile = restoreWorkspaceProfile({ ...get().workspaceProfile, ...patch });
        set({ workspaceProfile: nextProfile });
        return { ok: true, message: 'Workspace profile updated.' };
      },
      toggleSharedListing: (horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for shared access.' };
        }

        let isActive = false;
        set((state) => {
          const existingListing = state.sharedListings.find((listing) => listing.horseId === horseId && listing.state !== 'Archived');
          isActive = Boolean(existingListing);
          const nextSharedListings = existingListing
            ? state.sharedListings.map((listing) =>
                listing.horseId === horseId
                  ? {
                      ...listing,
                      state: 'Archived' as const,
                      updatedAt: todayStamp(),
                    }
                  : listing,
              )
            : [
                createSharedListingRecord(horseId, {
                  state: 'Draft',
                }),
                ...state.sharedListings,
              ];

          const horses = state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  sale: {
                    ...horse.sale,
                    watchlistCount: Math.max(0, horse.sale.watchlistCount + (existingListing ? -1 : 1)),
                  },
                }
              : horse,
          );

          return {
            sharedListings: nextSharedListings,
            ...syncDerivedValues({
              horses,
              salesLeads: state.salesLeads,
              sharedListings: nextSharedListings,
              sharedAccess: state.sharedAccess,
            }),
          };
        });
        return {
          ok: true,
          message: isActive ? 'Horse removed from shared access.' : 'Horse added to shared access.',
          id: horseId,
        };
      },
      recordSharedChannel: (horseId, channel) => {
        set((state) => ({
          sharedListings: state.sharedListings.map((listing) =>
            listing.horseId === horseId && listing.state !== 'Archived'
              ? {
                  ...listing,
                  state: listing.state === 'Draft' ? 'Live' : listing.state,
                  channels: listing.channels.includes(channel) ? listing.channels : [...listing.channels, channel],
                  lastSharedAt: todayStamp(),
                  updatedAt: todayStamp(),
                }
              : listing,
          ),
        }));
      },
      addHorse: (input) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'createHorse');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateNewHorseInput(input);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        const horse = createHorseRecord(input, get().workspaceProfile);
        const ownershipRecord = createOwnershipRecord(horse);
        set((state) => ({
          horses: [horse, ...state.horses],
          ownershipRecords: [ownershipRecord, ...state.ownershipRecords],
        }));
        return { ok: true, message: `${horse.name} is now live in the horse portfolio.`, id: horse.id };
      },
      createDocumentIntake: async ({ files, horseId, source, uploadedBy, label, createHorseFromBatch }) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'uploadDocuments');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const fileList = files.filter(Boolean);
        if (!fileList.length) {
          return { ok: false, message: 'Select at least one file for intake.' };
        }

        if (!uploadedBy.trim()) {
          return { ok: false, message: 'Uploaded by is required before starting intake.' };
        }

        const state = get();
        const storageIncrease = estimateStorageGb(fileList);
        if (state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb) {
          return { ok: false, message: 'Storage limit reached for the current plan. Upgrade before adding more files.' };
        }

        try {
          const selectedHorse = state.horses.find((horse) => horse.id === horseId);
          const batchId = createId('batch');
          let documents: DocumentRecord[] = await Promise.all(
            fileList.map(async (file) => {
              let uploadedAsset: Awaited<ReturnType<typeof uploadDocumentAssetToCloud>> = null;
              try {
                uploadedAsset = await uploadDocumentAssetToCloud({
                  file,
                  horseId: selectedHorse?.id ?? horseId,
                });
              } catch (error) {
                console.error('Cloud document upload failed; storing file locally instead.', error);
              }
              const document = await buildDocumentRecord({
                file,
                uploadedBy,
                source,
                selectedHorse,
                horses: get().horses,
                existingDocuments: get().documents,
              });
              const localFileUrl = uploadedAsset?.storagePath ? undefined : await readFileAsDataUrl(file);
              return {
                ...document,
                batchId,
                fileName: file.name,
                mimeType: file.type || undefined,
                fileSizeBytes: file.size,
                fileUrl: localFileUrl,
                storagePath: uploadedAsset?.storagePath,
              };
            }),
          );
          const createdHorseBundles =
            !selectedHorse && createHorseFromBatch
              ? Array.from(
                  documents
                    .filter((document) => !document.horseId)
                    .reduce((groups, document) => {
                      const key =
                        document.entities.registrationNumber?.trim() ||
                        document.entities.horseName?.trim() ||
                        document.title.trim().toUpperCase();
                      if (!key) {
                        return groups;
                      }
                      const group = groups.get(key) ?? [];
                      group.push(document);
                      groups.set(key, group);
                      return groups;
                    }, new Map<string, DocumentRecord[]>()),
                )
                  .map(([, groupedDocuments]) => {
                    const horseInput = buildHorseInputFromDocuments(groupedDocuments, state.workspaceProfile);
                    if (!horseInput) {
                      return null;
                    }

                    const duplicateHorse = state.horses.some(
                      (horse) =>
                        horse.name === horseInput.name ||
                        (horseInput.registrationNumber && horse.registrationNumber === horseInput.registrationNumber),
                    );
                    if (duplicateHorse) {
                      return null;
                    }

                    return createHorseFromDocuments(groupedDocuments, state.workspaceProfile);
                  })
                  .filter((bundle): bundle is NonNullable<typeof bundle> => Boolean(bundle))
              : [];

          if (createdHorseBundles.length) {
            const createdDocumentMap = new Map(
              createdHorseBundles.flatMap((bundle) => bundle.documents.map((document) => [document.id, document] as const)),
            );
            documents = documents.map((document) => createdDocumentMap.get(document.id) ?? document);
          }
          const localDocumentCount = documents.filter((document) => document.fileUrl && !document.storagePath).length;
          const createdHorses = createdHorseBundles.map((bundle) => bundle.horse);
          const createdOwnershipRecords = createdHorseBundles.map((bundle) => bundle.ownershipRecord);

          const batch: IntakeBatch = {
            id: batchId,
            label: label?.trim() || `${source} intake`,
            receivedAt: nowStamp(),
            source,
            fileCount: documents.length,
            processedCount: documents.length,
            needsReviewCount: documents.filter((document) => document.state === 'Needs Review').length,
            matchedCount: documents.filter((document) => document.state === 'Matched' || document.state === 'Ready').length,
            state: documents.some((document) => document.state === 'Needs Review')
              ? 'Reviewing'
              : 'Completed',
          };

          set((current) => {
            const allDocuments = [...documents, ...current.documents];
            const nextHorses = current.horses.map((horse) => {
              const matchedDocuments = documents.filter(
                (document) => document.horseId === horse.id && (document.state === 'Matched' || document.state === 'Ready'),
              );
              return matchedDocuments.reduce(promoteDocument, horse);
            });

            return {
              documents: allDocuments,
              intakeBatches: [batch, ...current.intakeBatches],
              horses: [...createdHorses, ...nextHorses],
              ownershipRecords: [...createdOwnershipRecords, ...current.ownershipRecords],
              subscription: {
                ...current.subscription,
                usage: {
                  ...current.subscription.usage,
                  storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
                },
              },
            };
          });

          return {
            ok: true,
            message: `${documents.length} file${documents.length === 1 ? '' : 's'} entered the document queue.${createdHorses.length ? ` ${createdHorses.length} new horse record${createdHorses.length === 1 ? ' was' : 's were'} created from the intake batch.` : ''}${localDocumentCount ? ` ${localDocumentCount} stored locally until cloud sync is available.` : ''}`,
            id: batch.id,
          };
        } catch (error) {
          console.error('Document intake failed', error);
          return { ok: false, message: 'Document intake failed. Check the selected files and try again.' };
        }
      },
      reviewDocument: (documentId, horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'reviewDocuments');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const document = state.documents.find((item) => item.id === documentId);
        if (!document) {
          return { ok: false, message: 'Document not found.' };
        }

        const nextHorseId = horseId ?? document.horseId;
        if (!nextHorseId) {
          return { ok: false, message: 'Choose a horse before approving this document.' };
        }

        const matchedHorse = state.horses.find((horse) => horse.id === nextHorseId);
        if (!matchedHorse) {
          return { ok: false, message: 'Selected horse record was not found.' };
        }

        const nextDocument: DocumentRecord = {
          ...document,
          horseId: nextHorseId,
          state: 'Ready',
          confidence: Math.max(document.confidence, 0.92),
          duplicateRisk: document.duplicateRisk === 'Possible Duplicate' ? 'Review' : document.duplicateRisk,
          entities: {
            ...document.entities,
            horseName: matchedHorse.name,
            ownerName: document.entities.ownerName ?? matchedHorse.owner,
            registrationNumber: document.entities.registrationNumber ?? matchedHorse.registrationNumber,
          },
          summary: `${document.title} is approved and attached to ${matchedHorse.name}.`,
        };

        set((current) => {
          const nextDocuments = current.documents.map((item) => (item.id === documentId ? nextDocument : item));
          const nextHorses = current.horses.map((horse) => (horse.id === matchedHorse.id ? promoteDocument(horse, nextDocument) : horse));
          const nextBatches = current.intakeBatches.map((batch) => summarizeBatch(batch, nextDocuments));

          return {
            documents: nextDocuments,
            horses: nextHorses,
            intakeBatches: nextBatches,
          };
        });

        return { ok: true, message: `${matchedHorse.name} now has this document attached.`, id: matchedHorse.id };
      },
      discardDocument: (documentId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'reviewDocuments');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const document = get().documents.find((item) => item.id === documentId);
        if (!document) {
          return { ok: false, message: 'Document not found.' };
        }

        set((current) => {
          const nextDocuments = current.documents.map((item) =>
            item.id === documentId
              ? {
                  ...item,
                  state: 'Archived' as const,
                  summary: `${item.title} was discarded from the review queue.`,
                }
              : item,
          );

          return {
            documents: nextDocuments,
            intakeBatches: current.intakeBatches.map((batch) => summarizeBatch(batch, nextDocuments)),
          };
        });

        return { ok: true, message: `${document.title} was removed from active review.`, id: document.id };
      },
      uploadHorseMedia: async ({ horseId, files, kind, makePrimary }) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'uploadMedia');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const fileList = files.filter(Boolean);
        if (!fileList.length) {
          return { ok: false, message: 'Select at least one image to upload.' };
        }

        const state = get();
        if (!state.horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this media upload.' };
        }

        const storageIncrease = estimateStorageGb(fileList);
        if (state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb) {
          return { ok: false, message: 'Storage limit reached for this plan. Upgrade before uploading more media.' };
        }

        try {
          const assets = await Promise.all(
            fileList.map(async (file) => {
              let uploadedAsset: Awaited<ReturnType<typeof uploadMediaAssetToCloud>> = null;
              try {
                uploadedAsset = await uploadMediaAssetToCloud({ file, horseId });
              } catch (error) {
                console.error('Cloud media upload failed; storing media locally instead.', error);
              }
              return {
                id: createId('media'),
                label: file.name.replace(/\.[^.]+$/, ''),
                kind: kind ?? guessGalleryKind(file.name),
                url: uploadedAsset?.publicUrl ?? await readFileAsDataUrl(file),
                storagePath: uploadedAsset?.storagePath,
                status: 'Approved' as const,
              };
            }),
          );
          const localAssetCount = assets.filter((asset) => !asset.storagePath).length;

          set((current) => ({
            horses: current.horses.map((horse) =>
              horse.id === horseId
                ? {
                    ...horse,
                    profileImage: makePrimary ? assets[0]?.url ?? horse.profileImage : horse.profileImage,
                    gallery: [...assets, ...horse.gallery],
                    readiness: {
                      ...horse.readiness,
                      score: Math.min(100, horse.readiness.score + 5),
                      packetStatus: horse.readiness.packetStatus === 'Needs Photos' ? 'Ready' : horse.readiness.packetStatus,
                      blockers: horse.readiness.blockers.filter((blocker) => blocker !== 'Hero image missing'),
                    },
                    sale: {
                      ...horse.sale,
                      socialReady: true,
                    },
                    activity: [
                      {
                        id: createId('activity'),
                        date: todayStamp(),
                        title: 'Media uploaded',
                        summary: `${assets.length} media asset${assets.length === 1 ? '' : 's'} added to the horse profile.`,
                        owner: 'Media Desk',
                        category: 'Sales' as const,
                      },
                      ...horse.activity,
                    ],
                  }
                : horse,
            ),
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
              },
            },
          }));

          return {
            ok: true,
            message: `${assets.length} media asset${assets.length === 1 ? '' : 's'} uploaded.${localAssetCount ? ` ${localAssetCount} stored locally until cloud sync is available.` : ''}`,
            id: horseId,
          };
        } catch (error) {
          console.error('Media upload failed', error);
          return { ok: false, message: 'Media upload failed. Check the selected files and try again.' };
        }
      },
      addExpenseReceipt: async (input) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateExpenseReceiptInput(input);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        const state = get();
        if (input.horseId && !state.horses.some((horse) => horse.id === input.horseId)) {
          return { ok: false, message: 'Horse record not found for this receipt.' };
        }

        const fileList = input.file ? [input.file] : [];
        const storageIncrease = estimateStorageGb(fileList);
        if (fileList.length && state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb) {
          return { ok: false, message: 'Storage limit reached for the current plan. Remove files or upgrade before adding more receipts.' };
        }

        try {
          let uploadedAsset: Awaited<ReturnType<typeof uploadDocumentAssetToCloud>> = null;
          if (input.file) {
            try {
              uploadedAsset = await uploadDocumentAssetToCloud({
                file: input.file,
                horseId: input.horseId,
              });
            } catch (error) {
              console.error('Cloud receipt upload failed; storing receipt locally instead.', error);
            }
          }

          const localFileUrl = input.file && !uploadedAsset?.storagePath ? await readFileAsDataUrl(input.file) : undefined;
          const receipt = createExpenseReceiptRecord(input, {
            fileUrl: localFileUrl,
            storagePath: uploadedAsset?.storagePath,
            fileName: input.file?.name,
            mimeType: input.file?.type || undefined,
            fileSizeBytes: input.file?.size,
          });

          set((current) => ({
            expenseReceipts: [receipt, ...current.expenseReceipts],
            horses: current.horses.map((horse) =>
              horse.id === receipt.horseId
                ? {
                    ...horse,
                    activity: [
                      {
                        id: createId('activity'),
                        date: receipt.receiptDate,
                        title: `${receipt.category} receipt logged`,
                        summary: `${receipt.vendor} receipt added for ${receipt.category.toLowerCase()} spend.`,
                        owner: receipt.uploadedBy,
                        category: 'Operations' as const,
                      },
                      ...horse.activity,
                    ],
                  }
                : horse,
            ),
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
              },
            },
          }));

          return {
            ok: true,
            message: `${receipt.category} receipt logged.${input.file && !uploadedAsset?.storagePath ? ' Receipt file is stored locally until cloud sync is available.' : ''}`,
            id: receipt.id,
          };
        } catch (error) {
          console.error('Expense receipt upload failed', error);
          return { ok: false, message: 'Receipt upload failed. Check the fields and try again.' };
        }
      },
      createSalesLead: ({ horseId, name, channel, shareReady }) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateLeadInput({ horseId, name, channel, shareReady });
        if (validationError) {
          return { ok: false, message: validationError };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this lead.' };
        }

        const lead: SalesLead = {
          id: createId('lead'),
          name: name.trim(),
          channel,
          horseId,
          stage: 'New',
          lastTouch: todayStamp(),
          nextFollowUp: '',
          notes: '',
          savedListing: false,
          shareReady: Boolean(shareReady),
        };

        set((current) => {
          const salesLeads = [lead, ...current.salesLeads];
          const horses = current.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  sale: {
                    ...horse.sale,
                    inquiryCount: horse.sale.inquiryCount + 1,
                  },
                  activity: [
                    {
                      id: createId('activity'),
                      date: todayStamp(),
                      title: 'Buyer inquiry captured',
                      summary: `${lead.name} entered the pipeline from ${lead.channel}.`,
                      owner: 'Sales Desk',
                      category: 'Sales' as const,
                    },
                    ...horse.activity,
                  ],
                }
              : horse,
          );

          return {
            salesLeads,
            ...syncDerivedValues({
              horses,
              salesLeads,
              sharedListings: current.sharedListings,
              sharedAccess: current.sharedAccess,
            }),
          };
        });

        return { ok: true, message: `${lead.name} is now in the buyer pipeline.`, id: lead.id };
      },
      updateSalesLead: (leadId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const lead = get().salesLeads.find((item) => item.id === leadId);
        if (!lead) {
          return { ok: false, message: 'Lead not found.' };
        }

        set((current) => {
          const salesLeads = current.salesLeads.map((item) =>
            item.id === leadId
              ? {
                  ...item,
                  ...patch,
                  lastTouch: patch.lastTouch ?? item.lastTouch,
                }
              : item,
          );

          return {
            salesLeads,
            ...syncDerivedValues({
              horses: current.horses,
              salesLeads,
              sharedListings: current.sharedListings,
              sharedAccess: current.sharedAccess,
            }),
          };
        });

        return { ok: true, message: `${lead.name} updated.`, id: leadId };
      },
      updateAsset: (assetId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!get().ranchAssets.some((asset) => asset.id === assetId)) {
          return { ok: false, message: 'Asset record not found.' };
        }

        const validationError = validateAssetPatch(patch);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        set((state) => ({
          ranchAssets: state.ranchAssets.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)),
        }));
        return { ok: true, message: 'Asset record updated.', id: assetId };
      },
      addHorseNote: (horseId, note) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateHorseNoteInput(note);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this note.' };
        }

        const nextNote: HorseNote = {
          id: createId('note'),
          title: note.title.trim(),
          body: note.body.trim(),
          author: note.author.trim(),
          tone: note.tone,
          createdAt: todayStamp(),
        };

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  notes: [nextNote, ...horse.notes],
                  activity: [
                    {
                      id: createId('activity'),
                      date: todayStamp(),
                      title: note.title,
                      summary: note.body,
                      owner: note.author,
                      category: 'Operations' as const,
                    },
                    ...horse.activity,
                  ],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Horse note saved.', id: nextNote.id };
      },
      addMedicalEvent: (horseId, event) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageMedical');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!event.title.trim() || !event.body.trim() || !event.author.trim() || !event.date.trim()) {
          return { ok: false, message: 'Medical events need a title, note, owner, and date.' };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this medical event.' };
        }

        const nextEvent = createTimelineEvent({
          title: event.title,
          summary: event.body,
          owner: event.author,
          date: event.date,
          category: 'Medical',
        });

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  status: 'Medical Review',
                  lastVetVisit: event.date,
                  medicalNotes: event.body,
                  medicalTimeline: [nextEvent, ...horse.medicalTimeline],
                  activity: [nextEvent, ...horse.activity],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Medical event added.', id: nextEvent.id };
      },
      addBreedingEvent: (horseId, event) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageBreeding');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!event.title.trim() || !event.body.trim() || !event.author.trim() || !event.date.trim()) {
          return { ok: false, message: 'Breeding events need a title, note, owner, and date.' };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this breeding event.' };
        }

        const nextEvent = createTimelineEvent({
          title: event.title,
          summary: event.body,
          owner: event.author,
          date: event.date,
          category: 'Breeding',
        });

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  breedingTimeline: [nextEvent, ...horse.breedingTimeline],
                  activity: [nextEvent, ...horse.activity],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Breeding event added.', id: nextEvent.id };
      },
      updateHorseLocation: (horseId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateLocationPatch(patch);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this location update.' };
        }

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  location: {
                    ...horse.location,
                    ...patch,
                  },
                  activity: [
                    {
                      id: createId('activity'),
                      date: todayStamp(),
                      title: 'Location updated',
                      summary: `Horse location updated to ${patch.barn ?? horse.location.barn} / ${patch.pasture ?? horse.location.pasture}.`,
                      owner: 'Field Ops',
                      category: 'Operations' as const,
                    },
                    ...horse.activity,
                  ],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Horse location updated.', id: horseId };
      },
      updateOwnershipRecord: (recordId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) {
          return { ok: false, message: 'Ownership record not found.' };
        }

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...item,
                  ...patch,
                }
              : item,
          ),
          horses: state.horses.map((horse) =>
            horse.id === record.horseId
              ? {
                  ...horse,
                  owner: patch.legalOwner ?? horse.owner,
                  ownership: horse.ownership.map((stake, index) =>
                    index === 0
                      ? {
                          ...stake,
                          name: patch.legalOwner ?? stake.name,
                        }
                      : stake,
                  ),
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Ownership record updated.', id: recordId };
      },
      addOwnershipAuditEntry: (recordId, entry) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const trimmed = entry.trim();
        if (!trimmed) {
          return { ok: false, message: 'Enter an audit note before saving.' };
        }

        if (!get().ownershipRecords.some((record) => record.id === recordId)) {
          return { ok: false, message: 'Ownership record not found.' };
        }

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((record) =>
            record.id === recordId
              ? {
                  ...record,
                  auditTrail: [`${todayStamp()} ${trimmed}`, ...record.auditTrail],
                }
              : record,
          ),
        }));

        return { ok: true, message: 'Audit note added.', id: recordId };
      },
      addOwnershipStake: (horseId, stake) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!stake.name.trim() || !stake.contact.trim() || !Number.isFinite(stake.share) || stake.share <= 0) {
          return { ok: false, message: 'Co-owner name, share, and contact are required.' };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this ownership update.' };
        }

        const nextStake: OwnershipStake = {
          id: createId('stake'),
          ...stake,
          name: stake.name.trim(),
          contact: stake.contact.trim(),
        };

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  ownership: [...horse.ownership, nextStake],
                  activity: [
                    createTimelineEvent({
                      title: 'Ownership updated',
                      summary: `${nextStake.name} added as ${nextStake.role}.`,
                      owner: 'Ownership Desk',
                      date: todayStamp(),
                      category: 'Ownership',
                    }),
                    ...horse.activity,
                  ],
                }
              : horse,
          ),
        }));

        return { ok: true, message: `${nextStake.name} added to the ownership split.`, id: nextStake.id };
      },
      exportWorkspaceBackup: () => ({
        app: 'XBAR',
        version: WORKSPACE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        workspace: selectPersistedState(get()),
      }),
      importWorkspaceBackup: (backup) => {
        const payload =
          backup && typeof backup === 'object' && 'workspace' in (backup as Record<string, unknown>)
            ? (backup as { workspace: unknown }).workspace
            : backup;
        if (
          !payload ||
          typeof payload !== 'object' ||
          (!('horses' in (payload as Record<string, unknown>)) &&
            !('documents' in (payload as Record<string, unknown>)) &&
            !('subscription' in (payload as Record<string, unknown>)))
        ) {
          return {
            ok: false,
            message: 'Backup file is missing the XBAR workspace payload.',
          };
        }
        const nextState = restorePersistedState(payload);
        set(nextState);
        return {
          ok: true,
          message: `Imported ${nextState.horses.length} horses, ${nextState.documents.length} documents, and ${nextState.salesLeads.length} leads.`,
        };
      },
    }),
    {
      name: 'xbar-live-workspace',
      storage: createJSONStorage(() => workspaceStateStorage),
      version: WORKSPACE_SCHEMA_VERSION,
      migrate: (persistedState) => restorePersistedState(persistedState),
      partialize: (state) =>
        selectPersistedState({
          horses: state.horses,
          documents: state.documents,
          intakeBatches: state.intakeBatches,
          ownershipRecords: state.ownershipRecords,
          expenseReceipts: state.expenseReceipts,
          ranchAssets: state.ranchAssets,
          subscription: state.subscription,
          roleWorkspaces: state.roleWorkspaces,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceProfile: state.workspaceProfile,
        }),
    },
  ),
);

function normalizeUsage(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function useCurrentRoleWorkspace() {
  return useXbarStore((state) => {
    const match = state.roleWorkspaces.find((workspace) => workspace.role === state.currentRole);
    return match ?? state.roleWorkspaces[0];
  });
}

export function useHorseRecord(id?: string) {
  return useXbarStore((state) => state.horses.find((horse) => horse.id === id));
}

export function useCurrentRoleCapability(capability: RoleCapability) {
  return useXbarStore((state) => hasRoleCapability(state.currentRole, capability));
}
