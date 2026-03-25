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
  weatherSeed,
} from '@/data/xbarPlatform';
import {
  buildDocumentRecord,
  createId,
  derivePortalSnapshot,
  estimateOcrPages,
  estimateStorageGb,
  guessGalleryKind,
  nowStamp,
  readFileAsDataUrl,
  subscriptionTierConfig,
  todayStamp,
} from '@/lib/xbarRuntime';
import type {
  AssetCondition,
  AssetStatus,
  DocumentSource,
  HorseNote,
  HorseRecord,
  HorseSegment,
  HorseSex,
  HorseStatus,
  OCRBatch,
  PortalSnapshot,
  SalesLead,
  SubscriptionTier,
  UserRole,
} from '@/types/xbar';
import type {
  DocumentRecord,
  OwnershipRecord,
  RanchAsset,
  RoleWorkspace,
  SubscriptionProfile,
  WeatherSnapshot,
} from '@/types/xbar';

type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
};

type NewHorseInput = {
  name: string;
  barnName: string;
  segment: HorseSegment;
  status: HorseStatus;
  sex: HorseSex;
  owner: string;
  ownerEntity: string;
  aqhaNumber?: string;
  registrationNumber?: string;
  barn: string;
  pasture: string;
};

type OCRIntakeInput = {
  files: File[];
  horseId?: string;
  source: DocumentSource;
  uploadedBy: string;
  label?: string;
};

type MediaUploadInput = {
  horseId: string;
  files: File[];
  kind?: 'Hero' | 'Conformation' | 'Sale Still' | 'Pedigree' | 'Document Cover';
  makePrimary?: boolean;
};

type LeadInput = {
  name: string;
  channel: SalesLead['channel'];
  horseId: string;
  portalReady?: boolean;
};

type AssetPatch = {
  status?: AssetStatus;
  condition?: AssetCondition;
  assignedTo?: string;
  location?: string;
  nextService?: string;
  notes?: string;
};

type LocationPatch = {
  barn?: string;
  pasture?: string;
  stall?: string;
};

type XbarStore = {
  currentRole: UserRole;
  horses: HorseRecord[];
  documents: DocumentRecord[];
  ocrBatches: OCRBatch[];
  ownershipRecords: OwnershipRecord[];
  ranchAssets: RanchAsset[];
  subscription: SubscriptionProfile;
  weather: WeatherSnapshot;
  roleWorkspaces: RoleWorkspace[];
  salesLeads: SalesLead[];
  portal: PortalSnapshot;
  savedHorseIds: string[];
  setCurrentRole: (role: UserRole) => void;
  toggleSavedHorse: (horseId: string) => void;
  addHorse: (input: NewHorseInput) => ActionResult;
  createOCRIntake: (input: OCRIntakeInput) => Promise<ActionResult>;
  reviewDocument: (documentId: string, horseId?: string) => ActionResult;
  uploadHorseMedia: (input: MediaUploadInput) => Promise<ActionResult>;
  createSalesLead: (input: LeadInput) => ActionResult;
  updateAsset: (assetId: string, patch: AssetPatch) => ActionResult;
  addHorseNote: (horseId: string, note: Pick<HorseNote, 'title' | 'body' | 'author' | 'tone'>) => ActionResult;
  updateHorseLocation: (horseId: string, patch: LocationPatch) => ActionResult;
  changeSubscriptionTier: (tier: SubscriptionTier) => void;
};

const initialState = {
  currentRole: 'Admin' as UserRole,
  horses: horsesSeed,
  documents: documentsSeed,
  ocrBatches: ocrBatchesSeed,
  ownershipRecords: ownershipSeed,
  ranchAssets: ranchAssetsSeed,
  subscription: subscriptionSeed,
  weather: weatherSeed,
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

function createOwnershipRecord(horse: HorseRecord): OwnershipRecord {
  return {
    id: createId('ownership'),
    horseId: horse.id,
    legalOwner: horse.owner,
    transferStatus: 'Attention Required',
    pendingDocuments: ['Ownership memo', 'Registration proof'],
    complianceDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    confidence: 35,
    auditTrail: [
      `${todayStamp()} Ownership record created from horse intake`,
      `${todayStamp()} Supporting ownership documents still need upload`,
    ],
  };
}

function summarizeBatch(batch: OCRBatch, documents: DocumentRecord[]): OCRBatch {
  const batchDocuments = documents.filter((document) => document.batchId === batch.id);
  if (!batchDocuments.length) {
    return batch;
  }

  const fileCount = batchDocuments.length;
  const processedCount = batchDocuments.filter((document) => document.state !== 'Queued').length;
  const needsReviewCount = batchDocuments.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting').length;
  const matchedCount = batchDocuments.filter((document) => document.state === 'Matched' || document.state === 'Ready').length;

  let state: OCRBatch['state'] = 'Processing';
  if (needsReviewCount > 0) {
    state = 'Reviewing';
  } else if (matchedCount >= fileCount) {
    state = 'Completed';
  }

  return {
    ...batch,
    fileCount,
    processedCount,
    needsReviewCount,
    matchedCount,
    state,
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

        const state = get();
        const storageIncrease = estimateStorageGb(fileList);
        const pageIncrease = estimateOcrPages(fileList);

        if (state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb) {
          return { ok: false, message: 'Storage limit reached for the current plan. Upgrade before adding more files.' };
        }

        if (state.subscription.usage.ocrProcessed + pageIncrease > state.subscription.usage.ocrLimit) {
          return { ok: false, message: 'OCR page limit reached for the current plan. Upgrade or archive older intake first.' };
        }

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
          needsReviewCount: documents.filter((document) => document.state === 'Needs Review' || document.state === 'Extracting').length,
          matchedCount: documents.filter((document) => document.state === 'Matched' || document.state === 'Ready').length,
          state: documents.some((document) => document.state === 'Needs Review' || document.state === 'Extracting')
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
            ocrBatches: [batch, ...current.ocrBatches],
            horses: nextHorses,
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
                ocrProcessed: current.subscription.usage.ocrProcessed + pageIncrease,
              },
            },
          };
        });

        return {
          ok: true,
          message: `${documents.length} file${documents.length === 1 ? '' : 's'} entered the OCR queue.`,
          id: batch.id,
        };
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
      uploadHorseMedia: async ({ horseId, files, kind, makePrimary }) => {
        const fileList = files.filter(Boolean);
        if (!fileList.length) {
          return { ok: false, message: 'Select at least one image to upload.' };
        }

        const state = get();
        const storageIncrease = estimateStorageGb(fileList);
        if (state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb) {
          return { ok: false, message: 'Storage limit reached for this plan. Upgrade before uploading more media.' };
        }

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
      },
      createSalesLead: ({ horseId, name, channel, portalReady }) => {
        const lead: SalesLead = {
          id: createId('lead'),
          name: name.trim(),
          channel,
          horseId,
          stage: 'New',
          lastTouch: todayStamp(),
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
      updateAsset: (assetId, patch) => {
        set((state) => ({
          ranchAssets: state.ranchAssets.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)),
        }));
        return { ok: true, message: 'Asset record updated.', id: assetId };
      },
      addHorseNote: (horseId, note) => {
        const nextNote: HorseNote = {
          id: createId('note'),
          title: note.title,
          body: note.body,
          author: note.author,
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
      updateHorseLocation: (horseId, patch) => {
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
      changeSubscriptionTier: (tier) =>
        set((state) => {
          const config = subscriptionTierConfig[tier];
          return {
            subscription: {
              ...state.subscription,
              tier,
              monthlyRate: config.monthlyRate,
              ownerPortalEnabled: config.ownerPortalEnabled,
              brandedListings: config.brandedListings,
              featureFlags: config.featureFlags,
              billingState: tier === state.subscription.tier ? state.subscription.billingState : 'Upgrade Review',
              usage: {
                ...state.subscription.usage,
                seatLimit: config.limits.seatLimit,
                ocrLimit: config.limits.ocrLimit,
                storageLimitGb: config.limits.storageLimitGb,
                portalSeatLimit: config.limits.portalSeatLimit,
              },
            },
          };
        }),
    }),
    {
      name: 'xbar-live-workspace',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentRole: state.currentRole,
        horses: state.horses,
        documents: state.documents,
        ocrBatches: state.ocrBatches,
        ownershipRecords: state.ownershipRecords,
        ranchAssets: state.ranchAssets,
        subscription: state.subscription,
        weather: state.weather,
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
