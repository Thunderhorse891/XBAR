import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { documentsSeed, ocrBatchesSeed } from '@/data/xbarDocuments';
import { horsesSeed } from '@/data/xbarHorses';
import {
  ownershipSeed,
  portalSeed,
  ranchAssetsSeed,
  roleSeed,
  salesLeadsSeed,
  subscriptionSeed,
} from '@/data/xbarPlatform';
import {
  buildDocumentRecord,
  createId,
  derivePortalSnapshot,
  estimateStorageGb,
  guessGalleryKind,
  nowStamp,
  readFileAsDataUrl,
  todayStamp,
} from '@/lib/xbarRuntime';
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
  HorseNote,
  HorseRecord,
  OCRBatch,
  OwnershipStake,
  PortalSnapshot,
  SalesLead,
  UserRole,
} from '@/types/xbar';
import type {
  DocumentRecord,
  OwnershipRecord,
  RanchAsset,
  RoleWorkspace,
  SubscriptionProfile,
} from '@/types/xbar';
import type { AssetPatch, LeadInput, LocationPatch, MediaUploadInput, NewHorseInput, OCRIntakeInput } from '@/store/xbarStoreLogic';

type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
};

type XbarStore = {
  currentRole: UserRole;
  horses: HorseRecord[];
  documents: DocumentRecord[];
  ocrBatches: OCRBatch[];
  ownershipRecords: OwnershipRecord[];
  ranchAssets: RanchAsset[];
  subscription: SubscriptionProfile;
  roleWorkspaces: RoleWorkspace[];
  salesLeads: SalesLead[];
  portal: PortalSnapshot;
  savedHorseIds: string[];
  setCurrentRole: (role: UserRole) => void;
  toggleSavedHorse: (horseId: string) => void;
  addHorse: (input: NewHorseInput) => ActionResult;
  createOCRIntake: (input: OCRIntakeInput) => Promise<ActionResult>;
  reviewDocument: (documentId: string, horseId?: string) => ActionResult;
  discardDocument: (documentId: string) => ActionResult;
  uploadHorseMedia: (input: MediaUploadInput) => Promise<ActionResult>;
  createSalesLead: (input: LeadInput) => ActionResult;
  updateSalesLead: (
    leadId: string,
    patch: Partial<Pick<SalesLead, 'stage' | 'lastTouch' | 'nextFollowUp' | 'notes' | 'offerAmount' | 'savedListing' | 'ownerPortalReady' | 'outcome'>>,
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
};

const initialState = {
  currentRole: 'Admin' as UserRole,
  horses: horsesSeed,
  documents: documentsSeed,
  ocrBatches: ocrBatchesSeed,
  ownershipRecords: ownershipSeed,
  ranchAssets: ranchAssetsSeed,
  subscription: subscriptionSeed,
  roleWorkspaces: roleSeed,
  salesLeads: salesLeadsSeed,
  portal: portalSeed,
  savedHorseIds: ['horse-wiggy', 'horse-dolly'],
};

function syncDerivedValues(state: Pick<XbarStore, 'horses' | 'salesLeads' | 'savedHorseIds' | 'portal'>) {
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
    portal: derivePortalSnapshot(state.portal, state.savedHorseIds, state.salesLeads),
  };
}

function createHorseRecord(input: NewHorseInput): HorseRecord {
  const id = createId('horse');
  const name = input.name.trim().toUpperCase();
  const barnName = input.barnName.trim();
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
    microchipId: `9810${Math.random().toString().slice(2, 12)}`,
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
      ranch: 'XBAR Main Ranch',
      barn: input.barn.trim(),
      pasture: input.pasture.trim(),
      stall: 'Unassigned',
    },
    assignments: {
      trainer: 'Unassigned',
      ranchManager: 'Erin Wyrick',
      veterinarian: 'Pending',
      farrier: 'Pending',
    },
    ownership: [
      {
        id: createId('stake'),
        name: input.owner.trim(),
        share: 100,
        role: 'Legal Owner',
        contact: 'pending@xbarllc.com',
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
    ocrFacts: [],
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
  const nextFacts = [...horse.ocrFacts];
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
    ocrFacts: nextFacts,
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
              portal: state.portal,
            }),
          };
        }),
      addHorse: (input) => {
        const validationError = validateNewHorseInput(input);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        const horse = createHorseRecord(input);
        const ownershipRecord = createOwnershipRecord(horse);
        set((state) => ({
          horses: [horse, ...state.horses],
          ownershipRecords: [ownershipRecord, ...state.ownershipRecords],
        }));
        return { ok: true, message: `${horse.name} is now live in the horse portfolio.`, id: horse.id };
      },
      createOCRIntake: async ({ files, horseId, source, uploadedBy, label }) => {
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
          const documents = (await Promise.all(
            fileList.map((file) =>
              buildDocumentRecord({
                file,
                uploadedBy,
                source,
                selectedHorse,
                horses: get().horses,
                existingDocuments: get().documents,
              }),
            ),
          )).map((document) => ({
            ...document,
            batchId,
          }));

          const batch: OCRBatch = {
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
              ocrBatches: [batch, ...current.ocrBatches],
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
            message: `${documents.length} file${documents.length === 1 ? '' : 's'} entered the document queue.`,
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
          const nextBatches = current.ocrBatches.map((batch) => summarizeBatch(batch, nextDocuments));

          return {
            documents: nextDocuments,
            horses: nextHorses,
            ocrBatches: nextBatches,
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
            ocrBatches: current.ocrBatches.map((batch) => summarizeBatch(batch, nextDocuments)),
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
            fileList.map(async (file) => ({
              id: createId('media'),
              label: file.name.replace(/\.[^.]+$/, ''),
              kind: kind ?? guessGalleryKind(file.name),
              url: await readFileAsDataUrl(file),
              status: 'Approved' as const,
            })),
          );

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

          return { ok: true, message: `${assets.length} media asset${assets.length === 1 ? '' : 's'} uploaded.`, id: horseId };
        } catch (error) {
          console.error('Media upload failed', error);
          return { ok: false, message: 'Media upload failed. Check the selected files and try again.' };
        }
      },
      createSalesLead: ({ horseId, name, channel, portalReady }) => {
        const validationError = validateLeadInput({ horseId, name, channel, portalReady });
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
          ownerPortalReady: Boolean(portalReady),
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
              portal: current.portal,
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
              portal: current.portal,
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
    }),
    {
      name: 'xbar-live-workspace',
      storage: createJSONStorage(() => workspaceStateStorage),
      partialize: (state) => ({
        currentRole: state.currentRole,
        horses: state.horses,
        documents: state.documents,
        ocrBatches: state.ocrBatches,
        ownershipRecords: state.ownershipRecords,
        ranchAssets: state.ranchAssets,
        subscription: state.subscription,
        roleWorkspaces: state.roleWorkspaces,
        salesLeads: state.salesLeads,
        portal: state.portal,
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
