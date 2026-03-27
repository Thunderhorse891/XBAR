import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { documentsSeed, intakeBatchesSeed } from '@/data/xbarDocuments';
import { horsesSeed } from '@/data/xbarHorses';
import {
  ownershipSeed,
  ranchAssetsSeed,
  roleSeed,
  salesLeadsSeed,
  sharedAccessSeed,
  subscriptionSeed,
  workspaceProfileSeed,
} from '@/data/xbarPlatform';
import {
  buildDocumentRecord,
  createId,
  createNumericToken,
  deriveSharedAccessSnapshot,
  estimateStorageGb,
  guessGalleryKind,
  nowStamp,
  readFileAsDataUrl,
  todayStamp,
} from '@/lib/xbarRuntime';
import { uploadDocumentAssetToCloud, uploadMediaAssetToCloud } from '@/lib/cloudWorkspace';
import { workspaceStateStorage } from '@/lib/workspaceStorage';
import {
  createOwnershipRecord,
  summarizeBatch,
  validateAssetPatch,
  validateHorseNoteInput,
  validateLeadInput,
  validateLocationPatch,
  validateNewHorseInput,
} from '@/store/xbarStoreLogic';
import type {
  DocumentFact,
  HorseNote,
  HorseRecord,
  IntakeBatch,
  OwnershipStake,
  SalesLead,
  SharedAccessSnapshot,
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
import type { AssetPatch, DocumentIntakeInput, LeadInput, LocationPatch, MediaUploadInput, NewHorseInput } from '@/store/xbarStoreLogic';

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
  ranchAssets: RanchAsset[];
  subscription: SubscriptionProfile;
  roleWorkspaces: RoleWorkspace[];
  salesLeads: SalesLead[];
  sharedAccess: SharedAccessSnapshot;
  workspaceProfile: WorkspaceProfile;
  savedHorseIds: string[];
  setCurrentRole: (role: UserRole) => void;
  updateWorkspaceProfile: (patch: Partial<WorkspaceProfile>) => ActionResult;
  toggleSavedHorse: (horseId: string) => void;
  addHorse: (input: NewHorseInput) => ActionResult;
  createDocumentIntake: (input: DocumentIntakeInput) => Promise<ActionResult>;
  reviewDocument: (documentId: string, horseId?: string) => ActionResult;
  discardDocument: (documentId: string) => ActionResult;
  uploadHorseMedia: (input: MediaUploadInput) => Promise<ActionResult>;
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
  | 'currentRole'
  | 'horses'
  | 'documents'
  | 'intakeBatches'
  | 'ownershipRecords'
  | 'ranchAssets'
  | 'subscription'
  | 'roleWorkspaces'
  | 'salesLeads'
  | 'sharedAccess'
  | 'workspaceProfile'
  | 'savedHorseIds'
>;

type WorkspaceBackup = {
  app: 'XBAR';
  version: number;
  exportedAt: string;
  workspace: PersistedXbarState;
};

const WORKSPACE_SCHEMA_VERSION = 4;

const initialState = {
  currentRole: 'Admin' as UserRole,
  horses: horsesSeed,
  documents: documentsSeed,
  intakeBatches: intakeBatchesSeed,
  ownershipRecords: ownershipSeed,
  ranchAssets: ranchAssetsSeed,
  subscription: subscriptionSeed,
  roleWorkspaces: roleSeed,
  salesLeads: salesLeadsSeed,
  sharedAccess: sharedAccessSeed,
  workspaceProfile: workspaceProfileSeed,
  savedHorseIds: ['horse-wiggy', 'horse-dolly'],
};

function syncDerivedValues(state: Pick<XbarStore, 'horses' | 'salesLeads' | 'savedHorseIds' | 'sharedAccess'>) {
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
    sharedAccess: deriveSharedAccessSnapshot(state.sharedAccess, state.savedHorseIds, state.salesLeads),
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

  return {
    ranchName: value.ranchName?.trim() || workspaceProfileSeed.ranchName,
    businessName: value.businessName?.trim() || workspaceProfileSeed.businessName,
    defaultOwnerName: value.defaultOwnerName?.trim() || '',
    defaultOwnerEntity: value.defaultOwnerEntity?.trim() || '',
    ranchManagerName: value.ranchManagerName?.trim() || '',
    operationsEmail: value.operationsEmail?.trim() || '',
    defaultBarn: value.defaultBarn?.trim() || '',
    defaultPasture: value.defaultPasture?.trim() || '',
  };
}

function selectPersistedState(state: PersistedXbarState): PersistedXbarState {
  return {
    currentRole: state.currentRole,
    horses: state.horses,
    documents: state.documents,
    intakeBatches: state.intakeBatches,
    ownershipRecords: state.ownershipRecords,
    ranchAssets: state.ranchAssets,
    subscription: state.subscription,
    roleWorkspaces: state.roleWorkspaces,
    salesLeads: state.salesLeads,
    sharedAccess: state.sharedAccess,
    workspaceProfile: state.workspaceProfile,
    savedHorseIds: state.savedHorseIds,
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
  const baseState: PersistedXbarState = {
    currentRole: (state.currentRole as UserRole | undefined) ?? initialState.currentRole,
    horses,
    documents,
    intakeBatches,
    ownershipRecords: Array.isArray(state.ownershipRecords) ? (state.ownershipRecords as OwnershipRecord[]) : initialState.ownershipRecords,
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
    sharedAccess:
      state.sharedAccess && typeof state.sharedAccess === 'object'
        ? (state.sharedAccess as SharedAccessSnapshot)
        : state.portal && typeof state.portal === 'object'
          ? (state.portal as SharedAccessSnapshot)
          : initialState.sharedAccess,
    workspaceProfile: restoreWorkspaceProfile(state.workspaceProfile),
    savedHorseIds: Array.isArray(state.savedHorseIds) ? (state.savedHorseIds as string[]) : initialState.savedHorseIds,
  };
  const derived = syncDerivedValues({
    horses: baseState.horses,
    salesLeads: baseState.salesLeads,
    savedHorseIds: baseState.savedHorseIds,
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
    profileImage: `${import.meta.env.BASE_URL}xbar-logo-sleek.png`,
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

export const useXbarStore = create<XbarStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setCurrentRole: (role) => set({ currentRole: role }),
      updateWorkspaceProfile: (patch) => {
        const nextProfile = restoreWorkspaceProfile({ ...get().workspaceProfile, ...patch });
        set({ workspaceProfile: nextProfile });
        return { ok: true, message: 'Workspace profile updated.' };
      },
      toggleSavedHorse: (horseId) =>
        set((state) => {
          const nextSavedHorseIds = state.savedHorseIds.includes(horseId)
            ? state.savedHorseIds.filter((id) => id !== horseId)
            : [...state.savedHorseIds, horseId];

          const horses = state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  sale: {
                    ...horse.sale,
                    watchlistCount: Math.max(0, horse.sale.watchlistCount + (state.savedHorseIds.includes(horseId) ? -1 : 1)),
                  },
                }
              : horse,
          );

          return {
            savedHorseIds: nextSavedHorseIds,
              ...syncDerivedValues({
                horses,
                salesLeads: state.salesLeads,
                savedHorseIds: nextSavedHorseIds,
                sharedAccess: state.sharedAccess,
              }),
            };
        }),
      addHorse: (input) => {
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
      createDocumentIntake: async ({ files, horseId, source, uploadedBy, label }) => {
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
          const documents = await Promise.all(
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
          const localDocumentCount = documents.filter((document) => document.fileUrl && !document.storagePath).length;

          const batch: IntakeBatch = {
            id: batchId,
            label: label?.trim() || `${source} intake`,
            receivedAt: nowStamp(),
            source,
            fileCount: documents.length,
            processedCount: documents.length,
            needsReviewCount: documents.filter((document) => document.state === 'Needs Review').length,
            matchedCount: documents.filter((document) => document.state === 'Matched').length,
            state: documents.some((document) => document.state === 'Needs Review')
              ? 'Reviewing'
              : 'Completed',
          };

          set((current) => {
            const allDocuments = [...documents, ...current.documents];
            const nextHorses = current.horses.map((horse) => {
              const matchedDocuments = documents.filter(
                (document) => document.horseId === horse.id && document.state === 'Matched',
              );
              return matchedDocuments.reduce(promoteDocument, horse);
            });

            return {
              documents: allDocuments,
              intakeBatches: [batch, ...current.intakeBatches],
              horses: nextHorses,
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
            message: `${documents.length} file${documents.length === 1 ? '' : 's'} entered the document queue.${localDocumentCount ? ` ${localDocumentCount} stored locally until cloud sync is available.` : ''}`,
            id: batch.id,
          };
        } catch (error) {
          console.error('Document intake failed', error);
          return { ok: false, message: 'Document intake failed. Check the selected files and try again.' };
        }
      },
      reviewDocument: (documentId, horseId) => {
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
      createSalesLead: ({ horseId, name, channel, shareReady }) => {
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
              savedHorseIds: current.savedHorseIds,
              sharedAccess: current.sharedAccess,
            }),
          };
        });

        return { ok: true, message: `${lead.name} is now in the buyer pipeline.`, id: lead.id };
      },
      updateSalesLead: (leadId, patch) => {
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
              savedHorseIds: current.savedHorseIds,
              sharedAccess: current.sharedAccess,
            }),
          };
        });

        return { ok: true, message: `${lead.name} updated.`, id: leadId };
      },
      updateAsset: (assetId, patch) => {
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
          currentRole: state.currentRole,
          horses: state.horses,
          documents: state.documents,
          intakeBatches: state.intakeBatches,
          ownershipRecords: state.ownershipRecords,
          ranchAssets: state.ranchAssets,
          subscription: state.subscription,
          roleWorkspaces: state.roleWorkspaces,
          salesLeads: state.salesLeads,
          sharedAccess: state.sharedAccess,
          workspaceProfile: state.workspaceProfile,
          savedHorseIds: state.savedHorseIds,
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
