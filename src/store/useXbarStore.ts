import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
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
  createShareAccessToken,
  deriveSharedAccessSnapshot,
  estimateStorageGb,
  guessGalleryKind,
  nowStamp,
  todayStamp,
} from '@/lib/xbarRuntime';
import { countReservedSharedAccessSeats, countReservedWorkspaceSeats, normalizeWorkspaceEmail, validateWorkspaceInvitation } from '@/lib/workspaceAccess';
import { apiConfig, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { getCapabilityDeniedMessage, hasRoleCapability } from '@/lib/permissions';
import { buildSaleHold } from '@/lib/saleTrustEngine';
import { featureGate } from '@/lib/commercialEngine';
import { buildOfferDecision } from '@/lib/profitIntelligence';
import { schedulePacketDownloadFollowUp } from '@/lib/salesFollowUp';
import {
  createWorkspaceInvitationInCloud,
  removeWorkspaceMemberFromCloud,
  revokeWorkspaceInvitationInCloud,
  updateSharedListingChannelsInCloud,
  uploadDocumentAssetToCloud,
  uploadMediaAssetToCloud,
  upsertSharedListingInCloud,
} from '@/lib/cloudWorkspace';
import { workspaceStateStorage } from '@/lib/workspaceStorage';
import {
  canMarkTransferClear,
  computeOwnershipConfidence,
  createAuditEvent,
  createOwnershipRecord,
  normalizeOwnershipRecord,
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
  BreedingEconomics,
  ExpenseReceipt,
  HorseNote,
  HorseRecord,
  IntakeBatch,
  MedicalEventType,
  OwnershipStake,
  RoleCapability,
  SalesLead,
  SharedListingRecord,
  SharedAccessSnapshot,
  SharedChannel,
  TimelineEvent,
  UserRole,
  WorkspaceProfile,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
} from '@/types/xbar';
import type {
  AuditAction,
  AuditEntityType,
  AuditEvent,
  BuyerRoomEvent,
  DocumentRecord,
  OwnershipRecord,
  RanchAsset,
  RoleWorkspace,
  SalePacketBuild,
  SubscriptionProfile,
} from '@/types/xbar';
import type { AssetPatch, DocumentIntakeInput, ExpenseReceiptInput, LeadInput, LocationPatch, MediaUploadInput, NewHorseInput } from '@/store/xbarStoreLogic';

type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
};

type HorsePatch = Partial<Pick<HorseRecord, 'name' | 'breed' | 'color' | 'sex' | 'registrationNumber' | 'registry' | 'aqhaNumber' | 'owner' | 'ownerEntity' | 'segment' | 'status' | 'costBasis'>> & { askPrice?: number };

type XbarStore = {
  currentRole: UserRole;
  horses: HorseRecord[];
  documents: DocumentRecord[];
  intakeBatches: IntakeBatch[];
  ownershipRecords: OwnershipRecord[];
  auditEvents: AuditEvent[];
  salePacketBuilds: SalePacketBuild[];
  buyerRoomEvents: BuyerRoomEvent[];
  expenseReceipts: ExpenseReceipt[];
  ranchAssets: RanchAsset[];
  subscription: SubscriptionProfile;
  roleWorkspaces: RoleWorkspace[];
  salesLeads: SalesLead[];
  sharedListings: SharedListingRecord[];
  sharedAccess: SharedAccessSnapshot;
  workspaceMembers: WorkspaceMemberRecord[];
  workspaceInvitations: WorkspaceInvitationRecord[];
  workspaceProfile: WorkspaceProfile;
  setCurrentRole: (role: UserRole) => void;
  initializeWorkspace: (profile: Partial<WorkspaceProfile>) => ActionResult;
  updateWorkspaceProfile: (patch: Partial<WorkspaceProfile>) => ActionResult;
  toggleSharedListing: (horseId: string) => Promise<ActionResult>;
  confirmSharedListingRelease: (horseId: string, confirmedBy: string) => Promise<ActionResult>;
  recordSharedChannel: (horseId: string, channel: SharedChannel) => Promise<ActionResult>;
  rotateSharedListingToken: (horseId: string) => Promise<ActionResult>;
  updateSharedListingAccessMode: (horseId: string, accessMode: SharedListingRecord['accessMode']) => Promise<ActionResult>;
  inviteWorkspaceMember: (email: string, role: UserRole) => Promise<ActionResult>;
  revokeWorkspaceInvitation: (invitationId: string) => Promise<ActionResult>;
  activateWorkspaceInvitation: (invitationId: string) => ActionResult;
  removeWorkspaceMember: (memberId: string) => Promise<ActionResult>;
  addHorse: (input: NewHorseInput) => ActionResult;
  createDocumentIntake: (input: DocumentIntakeInput) => Promise<ActionResult>;
  reviewDocument: (documentId: string, horseId?: string) => ActionResult;
  discardDocument: (documentId: string) => ActionResult;
  uploadHorseMedia: (input: MediaUploadInput) => Promise<ActionResult>;
  addExpenseReceipt: (input: ExpenseReceiptInput) => Promise<ActionResult>;
  createSalesLead: (input: LeadInput) => ActionResult;
  updateSalesLead: (
    leadId: string,
    patch: Partial<Pick<SalesLead, 'stage' | 'lastTouch' | 'nextFollowUp' | 'notes' | 'offerAmount' | 'counterOfferAmount' | 'offerStatus' | 'depositAmount' | 'depositStatus' | 'offerUpdatedAt' | 'savedListing' | 'shareReady' | 'outcome'>>,
  ) => ActionResult;
  addRanchAsset: (asset: Pick<RanchAsset, 'name' | 'category' | 'location'>) => ActionResult;
  updateAsset: (assetId: string, patch: AssetPatch) => ActionResult;
  deleteAsset: (assetId: string) => ActionResult;
  addHorseNote: (horseId: string, note: Pick<HorseNote, 'title' | 'body' | 'author' | 'tone'>) => ActionResult;
  addMedicalEvent: (
    horseId: string,
    event: Pick<HorseNote, 'title' | 'body' | 'author'> & { date: string; type: MedicalEventType },
  ) => ActionResult;
  addBreedingEvent: (horseId: string, event: Pick<HorseNote, 'title' | 'body' | 'author'> & { date: string }) => ActionResult;
  updateBreedingEconomics: (horseId: string, economics: BreedingEconomics) => ActionResult;
  deleteBreedingEvent: (horseId: string, eventId: string) => ActionResult;
  updateHorseLocation: (horseId: string, patch: LocationPatch) => ActionResult;
  updateHorse: (horseId: string, patch: HorsePatch) => ActionResult;
  deleteHorse: (horseId: string) => ActionResult;
  updateMedicalEvent: (horseId: string, eventId: string, patch: Partial<Pick<TimelineEvent, 'title' | 'summary' | 'date' | 'status'>>) => ActionResult;
  deleteMedicalEvent: (horseId: string, eventId: string) => ActionResult;
  updateOwnershipRecord: (
    recordId: string,
    patch: Partial<Pick<OwnershipRecord, 'legalOwner' | 'transferStatus' | 'complianceDeadline' | 'pendingDocuments'>>,
  ) => ActionResult;
  addOwnershipAuditEntry: (recordId: string, entry: string) => ActionResult;
  recordAuditEvent: (input: {
    actor: string;
    action: AuditAction;
    entityType: AuditEntityType;
    entityId: string;
    summary: string;
    context?: Record<string, string>;
  }) => void;
  linkOwnershipProof: (recordId: string, requirementId: string, documentId: string) => ActionResult;
  verifyOwnershipProof: (recordId: string, requirementId: string, verifiedBy: string) => ActionResult;
  unlinkOwnershipProof: (recordId: string, requirementId: string) => ActionResult;
  setTransferStatus: (recordId: string, status: OwnershipRecord['transferStatus'], actor: string) => ActionResult;
  createSalePacketBuild: (input: {
    horseId: string;
    buyerName?: string;
    buyerEmail?: string;
    watermark: string;
    documentIds: string[];
    includesBillOfSale: boolean;
    createdBy: string;
    downloadUrl?: string;
  }) => ActionResult & { packet?: SalePacketBuild };
  logBuyerRoomEvent: (input: {
    horseId: string;
    kind: BuyerRoomEvent['kind'];
    actor: string;
    packetId?: string;
    note?: string;
    amount?: number;
    dealStatus?: BuyerRoomEvent['dealStatus'];
    replyToEventId?: string;
  }) => ActionResult & { event?: BuyerRoomEvent };
  mergeBuyerRoomEvents: (events: BuyerRoomEvent[]) => ActionResult;
  captureBuyerRoomOffer: (eventId: string) => ActionResult;
  captureBuyerRoomFollowUp: (eventId: string) => ActionResult;
  addOwnershipStake: (horseId: string, stake: Omit<OwnershipStake, 'id'>) => ActionResult;
  removeOwnershipStake: (horseId: string, stakeId: string) => ActionResult;
  ensureOwnershipRecord: (horseId: string) => ActionResult & { recordId?: string };
  decideDocumentFact: (horseId: string, factId: string, decision: 'Accepted' | 'Rejected') => ActionResult;
  exportWorkspaceBackup: () => WorkspaceBackup;
  importWorkspaceBackup: (backup: unknown) => ActionResult;
};

type PersistedXbarState = Pick<
  XbarStore,
  | 'horses'
  | 'documents'
  | 'intakeBatches'
  | 'ownershipRecords'
  | 'auditEvents'
  | 'salePacketBuilds'
  | 'buyerRoomEvents'
  | 'expenseReceipts'
  | 'ranchAssets'
  | 'subscription'
  | 'roleWorkspaces'
  | 'salesLeads'
  | 'sharedListings'
  | 'sharedAccess'
  | 'workspaceMembers'
  | 'workspaceInvitations'
  | 'workspaceProfile'
>;

type WorkspaceBackup = {
  app: 'XBAR';
  version: number;
  exportedAt: string;
  workspace: PersistedXbarState;
};

const WORKSPACE_SCHEMA_VERSION = 8;
const legacyDemoHorseIds = new Set(['horse-wiggy', 'horse-hancock', 'horse-bonny', 'horse-dolly', 'horse-thunder', 'horse-shadow']);
const legacyDemoWorkspaceNames = new Set(['', 'XBAR']);
const legacyDemoRanchNames = new Set(['', 'Primary Ranch']);

function createEmptyWorkspaceState(): PersistedXbarState {
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

const initialState = {
  currentRole: (isSupabaseConfigured() ? 'Owner' : 'Admin') as UserRole,
  ...createEmptyWorkspaceState(),
};

function syncDerivedValues(
  state: Pick<XbarStore, 'horses' | 'salesLeads' | 'sharedListings' | 'sharedAccess' | 'workspaceMembers' | 'workspaceInvitations' | 'subscription'>,
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
    setupCompleteAt: value.setupCompleteAt?.trim() || '',
  };
}

function isWorkspaceSetup(profile: WorkspaceProfile) {
  return Boolean(profile.setupCompleteAt?.trim());
}

function looksLikeLegacyDemoWorkspace(state: PersistedXbarState) {
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

function createSharedListingRecord(horseId: string, patch?: Partial<SharedListingRecord>): SharedListingRecord {
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

function createInitialWorkspaceMember(profile: WorkspaceProfile): WorkspaceMemberRecord {
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

function restoreWorkspaceMembers(raw: unknown): WorkspaceMemberRecord[] {
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

function restoreWorkspaceInvitations(raw: unknown): WorkspaceInvitationRecord[] {
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
  const salePacketBuilds = Array.isArray(state.salePacketBuilds) ? (state.salePacketBuilds as SalePacketBuild[]) : [];
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
          horsesUsed: usage.horsesUsed ?? horses.length,
          horseLimit: usage.horseLimit ?? initialState.subscription.usage.horseLimit,
          documentsProcessed: documents.filter((document) => document.state !== 'Archived').length,
          documentLimit: usage.documentLimit ?? usage.ocrLimit ?? initialState.subscription.usage.documentLimit,
          salePacketsGenerated: salePacketBuilds.length,
          salePacketLimit: usage.salePacketLimit ?? initialState.subscription.usage.salePacketLimit,
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
    expenseReceipts: Array.isArray(state.expenseReceipts) ? (state.expenseReceipts as ExpenseReceipt[]) : initialState.expenseReceipts,
    ranchAssets: Array.isArray(state.ranchAssets) ? (state.ranchAssets as RanchAsset[]) : initialState.ranchAssets,
    subscription,
    roleWorkspaces: Array.isArray(state.roleWorkspaces) ? (state.roleWorkspaces as RoleWorkspace[]) : initialState.roleWorkspaces,
    salesLeads: Array.isArray(state.salesLeads)
      ? (state.salesLeads as SalesLead[]).map((lead) => ({
          ...lead,
          offerStatus: lead.offerStatus ?? (lead.offerAmount ? 'Submitted' : 'Draft'),
          depositStatus: lead.depositStatus ?? 'Not Requested',
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
    summary: '',
    segment: input.segment,
    status: input.status,
    breed: '',
    registry: input.aqhaNumber?.trim() ? 'AQHA' : '',
    aqhaNumber: input.aqhaNumber?.trim() || '',
    registrationNumber: input.registrationNumber?.trim() || '',
    registered: Boolean(input.aqhaNumber || input.registrationNumber),
    age: 0,
    foaledOn: '',
    sex: input.sex,
    color: '',
    markings: '',
    microchipId: '',
    owner: input.owner.trim(),
    ownerEntity: input.ownerEntity.trim(),
    insuredValue: 0,
    profileImage: '',
    tags: ['intake-pending'],
    bloodline: {
      sire: '',
      dam: '',
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
      blockers: ['Registration not verified', 'Ownership packet not uploaded', 'Medical summary not reviewed', 'Sale photos missing'],
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
        summary: 'Registration, media, medical, and ownership details must be verified before this record is ready to share.',
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
    barn: workspaceProfile.defaultBarn.trim() || 'Main Barn',
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

function requireRoleCapability(role: UserRole, capability: RoleCapability) {
  return hasRoleCapability(role, capability) ? null : getCapabilityDeniedMessage(capability);
}

export const useXbarStore = create<XbarStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setCurrentRole: (role) => set({ currentRole: role }),
      initializeWorkspace: (profile) => {
        const businessName = profile.businessName?.trim() ?? '';
        const ranchName = profile.ranchName?.trim() ?? '';
        if (!businessName || !ranchName) {
          return { ok: false, message: 'Business name and ranch name are required to create the workspace.' };
        }

        const current = get();
        const nextProfile = restoreWorkspaceProfile({
          ...current.workspaceProfile,
          ...profile,
          businessName,
          ranchName,
          setupCompleteAt: current.workspaceProfile.setupCompleteAt || nowStamp(),
        });
        const resetLegacyDemo = looksLikeLegacyDemoWorkspace(selectPersistedState(current));
        const seedState = resetLegacyDemo ? createEmptyWorkspaceState() : selectPersistedState(current);
        const workspaceMembers = seedState.workspaceMembers.length ? seedState.workspaceMembers : [createInitialWorkspaceMember(nextProfile)];
        const derived = syncDerivedValues({
          horses: seedState.horses,
          salesLeads: seedState.salesLeads,
          sharedListings: seedState.sharedListings,
          sharedAccess: seedState.sharedAccess,
          workspaceMembers,
          workspaceInvitations: seedState.workspaceInvitations,
          subscription: seedState.subscription,
        });

        set({
          ...seedState,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
          workspaceMembers,
          workspaceProfile: nextProfile,
        });

        return {
          ok: true,
          message: resetLegacyDemo ? 'Workspace created and legacy starter records were cleared.' : 'Workspace created.',
        };
      },
      updateWorkspaceProfile: (patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const current = get();
        const nextProfile = restoreWorkspaceProfile({ ...current.workspaceProfile, ...patch });
        const workspaceMembers = current.workspaceMembers.map((member, index) =>
          index === 0 && member.source === 'Owner'
            ? {
                ...member,
                email: normalizeWorkspaceEmail(nextProfile.operationsEmail) || member.email,
              }
            : member,
        );
        const derived = syncDerivedValues({
          horses: current.horses,
          salesLeads: current.salesLeads,
          sharedListings: current.sharedListings,
          sharedAccess: current.sharedAccess,
          workspaceMembers,
          workspaceInvitations: current.workspaceInvitations,
          subscription: current.subscription,
        });
        set({
          workspaceProfile: nextProfile,
          workspaceMembers,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });
        return { ok: true, message: 'Workspace profile updated.' };
      },
      toggleSharedListing: async (horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        if (!state.horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for shared access.' };
        }

        const existingListing = state.sharedListings.find((listing) => listing.horseId === horseId && listing.state !== 'Archived');
        const isActive = Boolean(existingListing);
        const cloudListing = existingListing
          ? {
              ...existingListing,
              state: 'Archived' as const,
              updatedAt: todayStamp(),
            }
          : createSharedListingRecord(horseId, {
              state: 'Draft',
            });

        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(cloudListing);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        set((state) => {
          const nextSharedListings = existingListing
            ? state.sharedListings.map((listing) =>
                listing.horseId === horseId
                  ? {
                      ...cloudListing,
                    }
                  : listing,
              )
            : [
                cloudListing,
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
              workspaceMembers: state.workspaceMembers,
              workspaceInvitations: state.workspaceInvitations,
              subscription: state.subscription,
            }),
          };
        });
        return {
          ok: true,
          message: isActive ? 'Horse removed from shared access.' : 'Horse added to shared access.',
          id: horseId,
        };
      },
      confirmSharedListingRelease: async (horseId, confirmedBy) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const state = get();
        const horse = state.horses.find((item) => item.id === horseId);
        const listing = state.sharedListings.find((item) => item.horseId === horseId && item.state !== 'Archived');
        if (!horse || !listing) return { ok: false, message: 'Create the buyer listing before confirming release.' };
        const hold = buildSaleHold(horse, state.documents, state.ownershipRecords.find((record) => record.horseId === horseId));
        if (hold.held) return { ok: false, message: `Release blocked: ${hold.reasons[0]}` };
        if (!confirmedBy.trim()) return { ok: false, message: 'Authorized seller name is required for legal release confirmation.' };

        const nextListing = {
          ...listing,
          releaseConfirmedAt: nowStamp(),
          releaseConfirmedBy: confirmedBy.trim(),
          releaseConfirmationVersion: 'buyer-packet-release-v1',
          updatedAt: todayStamp(),
        };
        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(nextListing);
          if (!cloudResult.ok) return cloudResult;
        }
        const auditEvent = createAuditEvent({
          actor: get().currentRole,
          action: 'status-change',
          entityType: 'shared-access',
          entityId: listing.id,
          summary: `${confirmedBy.trim()} confirmed legal release for the buyer packet.`,
          context: { horseId, releaseVersion: 'buyer-packet-release-v1' },
        });
        set((current) => ({
          sharedListings: current.sharedListings.map((item) => item.id === listing.id ? nextListing : item),
          auditEvents: [auditEvent, ...current.auditEvents].slice(0, 500),
        }));
        return { ok: true, message: `${confirmedBy.trim()} confirmed the buyer packet release.`, id: horseId };
      },
      recordSharedChannel: async (horseId, channel) => {
        const state = get();
        const horse = state.horses.find((item) => item.id === horseId);
        const listing = state.sharedListings.find((item) => item.horseId === horseId && item.state !== 'Archived');
        if (!horse || !listing) return { ok: false, message: 'Create the buyer listing before sharing.' };
        const hold = buildSaleHold(horse, state.documents, state.ownershipRecords.find((record) => record.horseId === horseId));
        if (hold.held) return { ok: false, message: `Buyer packet is on hold: ${hold.reasons[0]}` };
        if (!listing.releaseConfirmedAt || !listing.releaseConfirmedBy) {
          return { ok: false, message: 'Authorized seller release confirmation is required before sharing the buyer packet.' };
        }
        if (isSupabaseConfigured()) {
          const cloudResult = await updateSharedListingChannelsInCloud({ horseId, channel });
          if (!cloudResult.ok) {
            return { ok: false, message: `Buyer packet share was not recorded in the cloud audit trail: ${cloudResult.message}` };
          }
        }

        const auditEvent = createAuditEvent({
          actor: state.currentRole,
          action: 'shared',
          entityType: 'shared-access',
          entityId: listing.id,
          summary: `Buyer packet shared through ${channel}.`,
          context: { horseId, channel },
        });
        set((current) => ({
          sharedListings: current.sharedListings.map((item) =>
            item.horseId === horseId && item.state !== 'Archived'
              ? {
                  ...item,
                  state: item.state === 'Draft' ? 'Live' : item.state,
                  channels: item.channels.includes(channel) ? item.channels : [...item.channels, channel],
                  lastSharedAt: todayStamp(),
                  updatedAt: todayStamp(),
                }
              : item,
          ),
          auditEvents: [auditEvent, ...current.auditEvents].slice(0, 500),
        }));
        return { ok: true, message: 'Buyer packet share recorded.', id: horseId };
      },
      rotateSharedListingToken: async (horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const existingListing = state.sharedListings.find((listing) => listing.horseId === horseId && listing.state !== 'Archived');
        if (!existingListing) {
          return { ok: false, message: 'Shared listing not found for this horse.' };
        }

        const nextListing = {
          ...existingListing,
          shareToken: createShareAccessToken(),
          tokenIssuedAt: todayStamp(),
          updatedAt: todayStamp(),
        };

        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(nextListing);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        set((state) => ({
          sharedListings: state.sharedListings.map((listing) =>
            listing.horseId === horseId && listing.state !== 'Archived'
              ? {
                  ...nextListing,
                }
              : listing,
          ),
        }));

        return { ok: true, message: 'Share token rotated.', id: horseId };
      },
      updateSharedListingAccessMode: async (horseId, accessMode) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const existingListing = state.sharedListings.find((listing) => listing.horseId === horseId && listing.state !== 'Archived');
        if (!existingListing) {
          return { ok: false, message: 'Shared listing not found for this horse.' };
        }

        const nextListing = {
          ...existingListing,
          accessMode,
          updatedAt: todayStamp(),
        };

        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(nextListing);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        set((state) => ({
          sharedListings: state.sharedListings.map((listing) =>
            listing.horseId === horseId && listing.state !== 'Archived'
              ? {
                  ...nextListing,
                }
              : listing,
          ),
        }));

        return {
          ok: true,
          message: accessMode === 'Public Link' ? 'Sale link is now public.' : 'Sale link now requires a token.',
          id: horseId,
        };
      },
      inviteWorkspaceMember: async (email, role) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const validationError = validateWorkspaceInvitation({
          email,
          role,
          members: state.workspaceMembers,
          invitations: state.workspaceInvitations,
          seatLimit: state.subscription.usage.seatLimit,
          sharedAccessSeatLimit: state.subscription.usage.sharedAccessSeatLimit,
        });

        if (validationError) {
          return { ok: false, message: validationError };
        }

        const invite: WorkspaceInvitationRecord = {
          id: createId('invite'),
          email: normalizeWorkspaceEmail(email),
          role,
          status: 'Pending',
          invitedBy: state.workspaceProfile.ranchManagerName.trim() || state.workspaceProfile.businessName.trim() || 'Workspace Admin',
          invitedAt: nowStamp(),
        };

        if (isSupabaseConfigured()) {
          const cloudResult = await createWorkspaceInvitationInCloud(invite);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }

          // Fire invite email via API (best-effort — don't block on failure)
          try {
            const session = useCloudStore.getState().session;
            const accessToken = session?.access_token ?? '';
            const apiBase = apiConfig.baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
            await fetch(`${apiBase}/api/invite`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({ email: invite.email, role: invite.role, workspaceId: useCloudStore.getState().workspaceId, invitationId: invite.id }),
            });
          } catch { /* non-critical */ }
        }

        const workspaceInvitations = [invite, ...state.workspaceInvitations];
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers: state.workspaceMembers,
          workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceInvitations,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: `Invite reserved for ${invite.email}.`, id: invite.id };
      },
      revokeWorkspaceInvitation: async (invitationId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        if (!state.workspaceInvitations.some((invite) => invite.id === invitationId && invite.status === 'Pending')) {
          return { ok: false, message: 'Pending invite not found.' };
        }

        if (isSupabaseConfigured()) {
          const cloudResult = await revokeWorkspaceInvitationInCloud(invitationId);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        const workspaceInvitations = state.workspaceInvitations.map((invite) =>
          invite.id === invitationId
            ? {
                ...invite,
                status: 'Revoked' as const,
                revokedAt: nowStamp(),
              }
            : invite,
        );
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers: state.workspaceMembers,
          workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceInvitations,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: 'Invite revoked.', id: invitationId };
      },
      activateWorkspaceInvitation: (invitationId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const invite = state.workspaceInvitations.find((item) => item.id === invitationId && item.status === 'Pending');
        if (!invite) {
          return { ok: false, message: 'Pending invite not found.' };
        }

        const workspaceInvitations = state.workspaceInvitations.map((item) =>
          item.id === invitationId
            ? {
                ...item,
                status: 'Accepted' as const,
                acceptedAt: nowStamp(),
              }
            : item,
        );
        const workspaceMembers = [
          {
            id: createId('member'),
            email: invite.email,
            role: invite.role,
            status: 'Active' as const,
            invitedAt: invite.invitedAt,
            joinedAt: nowStamp(),
            source: 'Invite' as const,
          },
          ...state.workspaceMembers.filter((member) => normalizeWorkspaceEmail(member.email) !== invite.email),
        ];
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers,
          workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceMembers,
          workspaceInvitations,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: `${invite.email} is now active.`, id: invitationId };
      },
      removeWorkspaceMember: async (memberId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const member = state.workspaceMembers.find((item) => item.id === memberId);
        if (!member) {
          return { ok: false, message: 'Workspace member not found.' };
        }

        const activeAdmins = state.workspaceMembers.filter((item) => item.status === 'Active' && item.role === 'Admin');
        if (member.role === 'Admin' && member.status === 'Active' && activeAdmins.length <= 1) {
          return { ok: false, message: 'Keep at least one active admin on the workspace.' };
        }

        if (isSupabaseConfigured()) {
          const cloudResult = await removeWorkspaceMemberFromCloud(member);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        const workspaceMembers = state.workspaceMembers.filter((item) => item.id !== memberId);
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers,
          workspaceInvitations: state.workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceMembers,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: `${member.email} removed from the workspace.`, id: memberId };
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
          subscription: {
            ...state.subscription,
            usage: { ...state.subscription.usage, horsesUsed: state.horses.length + 1 },
          },
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
          return { ok: false, message: 'Select at least one file to upload.' };
        }

        if (!uploadedBy.trim()) {
          return { ok: false, message: 'Uploaded by is required before uploading.' };
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
              const localFileUrl = undefined;
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
          let createdHorseBundles =
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
          const availableHorseSlots = Math.max(0, state.subscription.usage.horseLimit - state.horses.length);
          const omittedHorseCount = Math.max(0, createdHorseBundles.length - availableHorseSlots);
          createdHorseBundles = createdHorseBundles.slice(0, availableHorseSlots);

          if (createdHorseBundles.length) {
            const createdDocumentMap = new Map(
              createdHorseBundles.flatMap((bundle) => bundle.documents.map((document) => [document.id, document] as const)),
            );
            documents = documents.map((document) => createdDocumentMap.get(document.id) ?? document);
          }
          const localDocumentCount = documents.filter((document) => !document.storagePath).length;
          const createdHorses = createdHorseBundles.map((bundle) => bundle.horse);
          const createdOwnershipRecords = createdHorseBundles.map((bundle) => bundle.ownershipRecord);

          const batch: IntakeBatch = {
            id: batchId,
            label: label?.trim() || `${source} upload`,
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
                  documentsProcessed: allDocuments.filter((document) => document.state !== 'Archived').length,
                  horsesUsed: createdHorses.length + nextHorses.length,
                  storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
                },
              },
            };
          });

          return {
            ok: true,
            message: `${documents.length} file${documents.length === 1 ? '' : 's'} entered the document queue.${createdHorses.length ? ` ${createdHorses.length} new horse record${createdHorses.length === 1 ? ' was' : 's were'} created from the upload batch.` : ''}${omittedHorseCount ? ` ${omittedHorseCount} additional horse candidate${omittedHorseCount === 1 ? ' was' : 's were'} left for review because the horse limit was reached.` : ''}${localDocumentCount ? ` ${localDocumentCount} kept as metadata only because cloud file storage is not available.` : ''}`,
            id: batch.id,
          };
        } catch (error) {
          console.error('Document upload failed', error);
          return { ok: false, message: 'Document upload failed. Check the selected files and try again.' };
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
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                documentsProcessed: nextDocuments.filter((item) => item.state !== 'Archived').length,
              },
            },
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
                url: uploadedAsset?.publicUrl ?? '',
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
            message: `${assets.length} media asset${assets.length === 1 ? '' : 's'} uploaded.${localAssetCount ? ` ${localAssetCount} kept as metadata only because cloud media storage is not available.` : ''}`,
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

          const localFileUrl = undefined;
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
            message: `${receipt.category} receipt logged.${input.file && !uploadedAsset?.storagePath ? ' Receipt file metadata was saved, but the file itself requires cloud storage.' : ''}`,
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
          offerStatus: 'Draft',
          depositStatus: 'Not Requested',
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
                      title: 'Sale inquiry captured',
                      summary: `${lead.name} entered the pipeline from ${lead.channel}.`,
                      owner: 'Ranch Staff',
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
              workspaceMembers: current.workspaceMembers,
              workspaceInvitations: current.workspaceInvitations,
              subscription: current.subscription,
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
        if (
          patch.offerAmount !== undefined ||
          patch.counterOfferAmount !== undefined ||
          patch.offerStatus !== undefined ||
          patch.depositAmount !== undefined ||
          patch.depositStatus !== undefined
        ) {
          const planBlocked = featureGate(get().subscription, 'buyerDealRoom');
          if (planBlocked) return { ok: false, message: planBlocked };
        }

        const lead = get().salesLeads.find((item) => item.id === leadId);
        if (!lead) {
          return { ok: false, message: 'Lead not found.' };
        }

        const nextOfferStatus = patch.offerStatus ?? lead.offerStatus;
        if (nextOfferStatus && ['Accepted', 'Deposit Due', 'Deposit Paid'].includes(nextOfferStatus)) {
          const horse = get().horses.find((item) => item.id === lead.horseId);
          if (!horse) return { ok: false, message: 'Horse record not found for this offer.' };
          const decision = buildOfferDecision(
            horse,
            get().expenseReceipts,
            patch.offerAmount ?? lead.offerAmount ?? 0,
            patch.counterOfferAmount ?? lead.counterOfferAmount ?? 0,
          );
          if (decision.acceptanceBlocked) {
            return { ok: false, message: `${decision.label}. ${decision.recommendation}` };
          }
        }

        set((current) => {
          const salesLeads = current.salesLeads.map((item) =>
            item.id === leadId
              ? {
                  ...item,
                  ...patch,
                  lastTouch: patch.lastTouch ?? item.lastTouch,
                  offerUpdatedAt:
                    patch.offerAmount !== undefined ||
                    patch.counterOfferAmount !== undefined ||
                    patch.offerStatus !== undefined ||
                    patch.depositAmount !== undefined ||
                    patch.depositStatus !== undefined
                      ? nowStamp()
                      : item.offerUpdatedAt,
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
              workspaceMembers: current.workspaceMembers,
              workspaceInvitations: current.workspaceInvitations,
              subscription: current.subscription,
            }),
          };
        });

        return { ok: true, message: `${lead.name} updated.`, id: leadId };
      },
      addRanchAsset: (asset) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        if (!asset.name.trim()) return { ok: false, message: 'Asset name is required.' };
        const id = crypto.randomUUID();
        set((state) => ({
          ranchAssets: [...state.ranchAssets, {
            id,
            name: asset.name.trim(),
            category: asset.category,
            status: 'Available' as const,
            condition: 'Excellent' as const,
            assignedTo: '',
            location: asset.location.trim(),
            nextService: '',
            notes: '',
          }],
        }));
        return { ok: true, message: 'Asset added.', id };
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
      deleteAsset: (assetId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const state = get();
        const asset = state.ranchAssets.find((a) => a.id === assetId);
        if (!asset) return { ok: false, message: 'Asset not found.' };
        const auditEvent = createAuditEvent({
          actor: state.currentRole,
          action: 'deleted',
          entityType: 'asset',
          entityId: assetId,
          summary: `Equipment asset "${asset.name}" deleted`,
        });
        set({
          ranchAssets: state.ranchAssets.filter((a) => a.id !== assetId),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        });
        return { ok: true, message: `${asset.name} removed from equipment.` };
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

        if (!event.title.trim() || !event.body.trim() || !event.author.trim() || !event.date.trim() || !event.type.trim()) {
          return { ok: false, message: 'Medical events need a type, title, note, owner, and date.' };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this medical event.' };
        }

        const shouldOpenMedicalReview = event.type === 'Injury';
        const nextEvent = createTimelineEvent({
          title: event.title,
          summary: event.body,
          owner: event.author,
          date: event.date,
          category: 'Medical',
          status: event.type,
          severity: event.type === 'Injury' ? 'high' : event.type === 'Treatment' ? 'medium' : undefined,
        });

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  status: shouldOpenMedicalReview ? 'Medical Review' : horse.status,
                  lastVetVisit: event.type === 'Vet visit' ? event.date : horse.lastVetVisit,
                  medicalNotes: shouldOpenMedicalReview ? event.body : horse.medicalNotes,
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
      updateBreedingEconomics: (horseId, economics) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageBreeding');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const planBlocked = featureGate(get().subscription, 'breedingRevenue');
        if (planBlocked) return { ok: false, message: planBlocked };
        if (!get().horses.some((horse) => horse.id === horseId)) return { ok: false, message: 'Horse record not found.' };
        const normalized = Object.fromEntries(
          Object.entries(economics).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]),
        ) as unknown as BreedingEconomics;
        set((state) => ({
          horses: state.horses.map((horse) => horse.id === horseId ? { ...horse, breedingEconomics: normalized } : horse),
        }));
        return { ok: true, message: 'Breeding revenue profile updated.', id: horseId };
      },
      deleteBreedingEvent: (horseId, eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageBreeding');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const horse = get().horses.find((h) => h.id === horseId);
        if (!horse) return { ok: false, message: 'Horse not found.' };
        const removedBreeding = horse.breedingTimeline.find((e) => e.id === eventId);
        const breedingAudit = createAuditEvent({
          actor: get().currentRole,
          action: 'deleted',
          entityType: 'breeding',
          entityId: eventId,
          summary: `Breeding record "${removedBreeding?.title ?? 'entry'}" deleted from ${horse.name}`,
          context: { horseId },
        });
        set({
          horses: get().horses.map((h) => h.id === horseId ? { ...h, breedingTimeline: h.breedingTimeline.filter((e) => e.id !== eventId) } : h),
          auditEvents: [breedingAudit, ...get().auditEvents].slice(0, 500),
        });
        return { ok: true, message: 'Breeding event removed.' };
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
                      owner: 'Ranch Staff',
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
      updateHorse: (horseId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        if (!get().horses.some((h) => h.id === horseId)) return { ok: false, message: 'Horse not found.' };
        set((state) => ({
          horses: state.horses.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  name: patch.name?.trim() ?? h.name,
                  breed: patch.breed?.trim() ?? h.breed,
                  color: patch.color?.trim() ?? h.color,
                  sex: patch.sex ?? h.sex,
                  registrationNumber: patch.registrationNumber?.trim() ?? h.registrationNumber,
                  registry: patch.registry?.trim() ?? h.registry,
                  aqhaNumber: patch.aqhaNumber?.trim() ?? h.aqhaNumber,
                  owner: patch.owner?.trim() ?? h.owner,
                  ownerEntity: patch.ownerEntity?.trim() ?? h.ownerEntity,
                  segment: patch.segment ?? h.segment,
                  status: patch.status ?? h.status,
                  costBasis: patch.costBasis !== undefined ? Math.max(0, Number(patch.costBasis) || 0) : h.costBasis,
                  sale: patch.askPrice !== undefined ? { ...h.sale, askPrice: patch.askPrice } : h.sale,
                }
              : h,
          ),
        }));
        return { ok: true, message: 'Horse record updated.', id: horseId };
      },
      deleteHorse: (horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const removedHorse = get().horses.find((h) => h.id === horseId);
        set((state) => {
          const horses = state.horses.filter((h) => h.id !== horseId);
          return {
            horses,
            subscription: { ...state.subscription, usage: { ...state.subscription.usage, horsesUsed: horses.length } },
            auditEvents: [
              createAuditEvent({
                actor: state.currentRole,
                action: 'deleted',
                entityType: 'horse',
                entityId: horseId,
                summary: `Horse record "${removedHorse?.name ?? horseId}" deleted with its documents and timelines`,
              }),
              ...state.auditEvents,
            ].slice(0, 500),
          };
        });
        return { ok: true, message: 'Horse removed from records.', id: horseId };
      },
      updateMedicalEvent: (horseId, eventId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        set((state) => ({
          horses: state.horses.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  medicalTimeline: h.medicalTimeline.map((ev) =>
                    ev.id === eventId ? { ...ev, ...patch } : ev,
                  ),
                  activity: h.activity.map((ev) =>
                    ev.id === eventId ? { ...ev, ...patch } : ev,
                  ),
                }
              : h,
          ),
        }));
        return { ok: true, message: 'Medical event updated.', id: eventId };
      },
      deleteMedicalEvent: (horseId, eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const medicalHorse = get().horses.find((h) => h.id === horseId);
        const removedMedical = medicalHorse?.medicalTimeline.find((ev) => ev.id === eventId);
        set((state) => ({
          horses: state.horses.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  medicalTimeline: h.medicalTimeline.filter((ev) => ev.id !== eventId),
                  activity: h.activity.filter((ev) => ev.id !== eventId || ev.category !== 'Medical'),
                }
              : h,
          ),
          auditEvents: [
            createAuditEvent({
              actor: state.currentRole,
              action: 'deleted',
              entityType: 'medical',
              entityId: eventId,
              summary: `Medical record "${removedMedical?.title ?? 'entry'}" deleted from ${medicalHorse?.name ?? horseId}`,
              context: { horseId },
            }),
            ...state.auditEvents,
          ].slice(0, 500),
        }));
        return { ok: true, message: 'Medical event removed.', id: eventId };
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
      recordAuditEvent: (input) => {
        const event = createAuditEvent(input);
        set((state) => ({ auditEvents: [event, ...state.auditEvents].slice(0, 500) }));
      },
      linkOwnershipProof: (recordId, requirementId, documentId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };
        const document = get().documents.find((item) => item.id === documentId);
        if (!document) return { ok: false, message: 'Select an uploaded document to use as proof.' };

        const normalized = normalizeOwnershipRecord(record);
        const requirement = normalized.proofRequirements?.find((item) => item.id === requirementId);
        if (!requirement) return { ok: false, message: 'Proof requirement not found.' };

        const nextRequirements = (normalized.proofRequirements ?? []).map((item) =>
          item.id === requirementId
            ? {
                ...item,
                status: 'linked' as const,
                documentId,
                documentTitle: document.title,
                linkedAt: new Date().toISOString(),
                verifiedAt: undefined,
                verifiedBy: undefined,
              }
            : item,
        );
        const auditEvent = createAuditEvent({
          actor: get().currentRole,
          action: 'linked-proof',
          entityType: 'ownership',
          entityId: recordId,
          summary: `${requirement.label} linked to document "${document.title}"`,
          context: { documentId, horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  proofRequirements: nextRequirements,
                  confidence: computeOwnershipConfidence(nextRequirements),
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `${requirement.label} linked to ${document.title}.`, id: recordId };
      },
      verifyOwnershipProof: (recordId, requirementId, verifiedBy) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };

        const normalized = normalizeOwnershipRecord(record);
        const requirement = normalized.proofRequirements?.find((item) => item.id === requirementId);
        if (!requirement) return { ok: false, message: 'Proof requirement not found.' };
        if (requirement.status !== 'linked') {
          return { ok: false, message: 'Link a document before verifying.' };
        }

        const nextRequirements = (normalized.proofRequirements ?? []).map((item) =>
          item.id === requirementId
            ? { ...item, status: 'verified' as const, verifiedAt: new Date().toISOString(), verifiedBy }
            : item,
        );
        const auditEvent = createAuditEvent({
          actor: verifiedBy,
          action: 'verified-proof',
          entityType: 'ownership',
          entityId: recordId,
          summary: `${requirement.label} verified against "${requirement.documentTitle ?? 'linked document'}"`,
          context: { horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  proofRequirements: nextRequirements,
                  confidence: computeOwnershipConfidence(nextRequirements),
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `${requirement.label} verified.`, id: recordId };
      },
      unlinkOwnershipProof: (recordId, requirementId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };

        const normalized = normalizeOwnershipRecord(record);
        const requirement = normalized.proofRequirements?.find((item) => item.id === requirementId);
        if (!requirement) return { ok: false, message: 'Proof requirement not found.' };

        const nextRequirements = (normalized.proofRequirements ?? []).map((item) =>
          item.id === requirementId
            ? {
                ...item,
                status: 'missing' as const,
                documentId: undefined,
                documentTitle: undefined,
                linkedAt: undefined,
                verifiedAt: undefined,
                verifiedBy: undefined,
              }
            : item,
        );
        const auditEvent = createAuditEvent({
          actor: get().currentRole,
          action: 'unlinked-proof',
          entityType: 'ownership',
          entityId: recordId,
          summary: `${requirement.label} unlinked — proof must be re-established`,
          context: { horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  proofRequirements: nextRequirements,
                  confidence: computeOwnershipConfidence(nextRequirements),
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `${requirement.label} unlinked.`, id: recordId };
      },
      setTransferStatus: (recordId, status, actor) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };

        const normalized = normalizeOwnershipRecord(record);
        if (status === 'Clear') {
          const clearance = canMarkTransferClear(normalized);
          if (!clearance.ok) {
            return {
              ok: false,
              message: `Cannot mark transfer Clear until every proof is verified: ${clearance.blockers.join('; ')}.`,
            };
          }
        }

        const auditEvent = createAuditEvent({
          actor,
          action: 'status-change',
          entityType: 'ownership',
          entityId: recordId,
          summary: `Transfer status changed: ${record.transferStatus} → ${status}`,
          context: { horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  transferStatus: status,
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `Transfer status set to ${status}.`, id: recordId };
      },
      createSalePacketBuild: (input) => {
        const horse = get().horses.find((item) => item.id === input.horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found for this packet.' };
        }

        const slug = horse.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'horse';
        const packet: SalePacketBuild = {
          id: createId('packet'),
          horseId: input.horseId,
          createdAt: new Date().toISOString(),
          createdBy: input.createdBy,
          buyerName: input.buyerName,
          buyerEmail: input.buyerEmail,
          watermark: input.watermark,
          documentIds: input.documentIds,
          includesBillOfSale: input.includesBillOfSale,
          status: 'generated',
          fileName: `sale-packet-${slug}-${todayStamp()}.pdf`,
          downloadUrl: input.downloadUrl,
        };
        const auditEvent = createAuditEvent({
          actor: input.createdBy,
          action: 'generated',
          entityType: 'sale-packet',
          entityId: packet.id,
          summary: `Sale packet generated for ${horse.name} (${input.documentIds.length} documents${input.includesBillOfSale ? ' + Bill of Sale' : ''})`,
          context: { horseId: input.horseId },
        });

        set((state) => ({
          salePacketBuilds: [packet, ...state.salePacketBuilds],
          subscription: {
            ...state.subscription,
            usage: { ...state.subscription.usage, salePacketsGenerated: state.subscription.usage.salePacketsGenerated + 1 },
          },
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `Sale packet ready for ${horse.name}.`, id: packet.id, packet };
      },
      logBuyerRoomEvent: (input) => {
        const horse = get().horses.find((item) => item.id === input.horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found for this buyer event.' };
        }
        const kindLabels: Record<BuyerRoomEvent['kind'], string> = {
          'packet-shared': 'Packet shared with buyer',
          'packet-viewed': 'Buyer viewed packet',
          'packet-downloaded': 'Buyer downloaded packet',
          question: 'Buyer asked a question',
          'call-requested': 'Buyer requested a call',
          'proof-requested': 'Buyer requested proof',
          offer: 'Buyer submitted an offer',
          'seller-response': 'Seller responded',
          'deal-status': 'Deal status updated',
        };
        const event: BuyerRoomEvent = {
          id: createId('buyer-event'),
          horseId: input.horseId,
          packetId: input.packetId,
          kind: input.kind,
          at: new Date().toISOString(),
          actor: input.actor,
          note: input.note,
          amount: input.amount,
          dealStatus: input.dealStatus,
          replyToEventId: input.replyToEventId,
        };
        const auditEvent = createAuditEvent({
          actor: input.actor,
          action: input.kind === 'packet-shared' ? 'shared' : 'updated',
          entityType: 'sale-packet',
          entityId: input.packetId ?? input.horseId,
          summary: `${kindLabels[input.kind]} — ${horse.name}${input.amount ? ` ($${input.amount.toLocaleString()})` : ''}`,
          context: { horseId: input.horseId },
        });
        set((state) => ({
          buyerRoomEvents: [event, ...state.buyerRoomEvents].slice(0, 1000),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));
        return { ok: true, message: `${kindLabels[input.kind]} logged for ${horse.name}.`, id: event.id, event };
      },
      mergeBuyerRoomEvents: (events) => {
        const current = get().buyerRoomEvents;
        const merged = [...events, ...current]
          .filter((event, index, list) => list.findIndex((candidate) => candidate.id === event.id) === index)
          .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
          .slice(0, 1000);
        set({ buyerRoomEvents: merged });
        return {
          ok: true,
          message: events.length ? `${events.length} public buyer event${events.length === 1 ? '' : 's'} refreshed.` : 'Buyer activity is current.',
        };
      },
      captureBuyerRoomOffer: (eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }
        const planBlocked = featureGate(get().subscription, 'buyerDealRoom');
        if (planBlocked) {
          return { ok: false, message: planBlocked };
        }

        const event = get().buyerRoomEvents.find((item) => item.id === eventId);
        if (!event || event.kind !== 'offer' || !(event.amount && event.amount > 0)) {
          return { ok: false, message: 'Buyer offer event not found.' };
        }

        const normalizedActor = event.actor.trim().toLowerCase();
        let lead = get().salesLeads.find(
          (item) => item.horseId === event.horseId && item.name.trim().toLowerCase() === normalizedActor,
        );
        if (!lead) {
          const created = get().createSalesLead({
            horseId: event.horseId,
            name: event.actor,
            channel: 'Site Inquiry',
            shareReady: true,
          });
          if (!created.ok || !created.id) {
            return created;
          }
          lead = get().salesLeads.find((item) => item.id === created.id);
        }
        if (!lead) {
          return { ok: false, message: 'Buyer lead could not be prepared for this offer.' };
        }

        const offerNote = event.note?.trim() ?? '';
        const notes = [lead.notes?.trim(), offerNote && !lead.notes?.includes(offerNote) ? offerNote : ''].filter(Boolean).join('\n\n');
        const updated = get().updateSalesLead(lead.id, {
          stage: 'Offer',
          lastTouch: todayStamp(),
          offerAmount: event.amount,
          offerStatus: 'Submitted',
          shareReady: true,
          notes,
        });
        if (!updated.ok) {
          return updated;
        }

        return {
          ok: true,
          id: lead.id,
          message: `${event.actor}'s ${event.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} offer is now in the Sales margin workflow.`,
        };
      },
      captureBuyerRoomFollowUp: (eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }
        const planBlocked = featureGate(get().subscription, 'buyerDealRoom');
        if (planBlocked) {
          return { ok: false, message: planBlocked };
        }

        const event = get().buyerRoomEvents.find((item) => item.id === eventId);
        if (!event || event.kind !== 'packet-downloaded') {
          return { ok: false, message: 'Buyer packet download event not found.' };
        }

        const normalizedActor = event.actor.trim().toLowerCase();
        let lead = get().salesLeads.find(
          (item) => item.stage !== 'Closed' && item.horseId === event.horseId && item.name.trim().toLowerCase() === normalizedActor,
        );
        if (!lead) {
          const created = get().createSalesLead({
            horseId: event.horseId,
            name: event.actor,
            channel: 'Site Inquiry',
            shareReady: true,
          });
          if (!created.ok || !created.id) {
            return created;
          }
          lead = get().salesLeads.find((item) => item.id === created.id);
        }
        if (!lead) {
          return { ok: false, message: 'Buyer lead could not be prepared for follow-up.' };
        }

        const patch = schedulePacketDownloadFollowUp(lead, event);
        if (!patch) {
          return { ok: false, message: 'Buyer packet download event not found.' };
        }
        const updated = get().updateSalesLead(lead.id, patch);
        if (!updated.ok) {
          return updated;
        }

        return {
          ok: true,
          id: lead.id,
          message: `Follow-up for ${event.actor} is due today in Sales.`,
        };
      },
      addOwnershipStake: (horseId, stake) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!stake.name.trim() || !Number.isFinite(stake.share) || stake.share <= 0) {
          return { ok: false, message: 'Co-owner name and share percentage are required.' };
        }

        const targetHorse = get().horses.find((horse) => horse.id === horseId);
        if (!targetHorse) {
          return { ok: false, message: 'Horse record not found for this ownership update.' };
        }

        const horse = get().horses.find((item) => item.id === horseId);
        const currentShareTotal = horse?.ownership.reduce((total, item) => total + item.share, 0) ?? 0;
        if (currentShareTotal + stake.share > 100) {
          return {
            ok: false,
            message: `Ownership split cannot exceed 100%. Current split is ${currentShareTotal}%.`,
          };
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
      removeOwnershipStake: (horseId, stakeId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const horse = get().horses.find((h) => h.id === horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found.' };
        }

        const stake = horse.ownership.find((s) => s.id === stakeId);
        if (!stake) {
          return { ok: false, message: 'Ownership stake not found.' };
        }

        set((state) => ({
          horses: state.horses.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  ownership: h.ownership.filter((s) => s.id !== stakeId),
                  activity: [
                    createTimelineEvent({
                      title: 'Ownership updated',
                      summary: `${stake.name} removed from ownership split.`,
                      owner: 'Ownership Desk',
                      date: todayStamp(),
                      category: 'Ownership',
                    }),
                    ...h.activity,
                  ],
                }
              : h,
          ),
        }));

        return { ok: true, message: `${stake.name} removed from the ownership split.` };
      },
      ensureOwnershipRecord: (horseId) => {
        const existing = get().ownershipRecords.find((r) => r.horseId === horseId);
        if (existing) {
          return { ok: true, message: 'Ownership record already exists.', recordId: existing.id };
        }

        const horse = get().horses.find((h) => h.id === horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found.' };
        }

        const newRecord = createOwnershipRecord(horse);
        set((state) => ({
          ownershipRecords: [newRecord, ...state.ownershipRecords],
        }));
        return { ok: true, message: `Ownership record created for ${horse.name}.`, recordId: newRecord.id };
      },
      decideDocumentFact: (horseId, factId, decision) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'reviewDocuments');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const horse = get().horses.find((item) => item.id === horseId);
        if (!horse) return { ok: false, message: 'Horse record not found.' };
        if (!horse.documentFacts.some((fact) => fact.id === factId)) return { ok: false, message: 'OCR fact not found.' };
        set((state) => ({
          horses: state.horses.map((item) => item.id === horseId ? {
            ...item,
            documentFacts: item.documentFacts.map((fact) => fact.id === factId ? { ...fact, decision } : fact),
            activity: [createTimelineEvent({
              title: `OCR fact ${decision.toLowerCase()}`,
              summary: `${factId} was ${decision.toLowerCase()} into the horse record.`,
              owner: 'Proof Vault',
              date: todayStamp(),
              category: 'Operations',
            }), ...item.activity],
          } : item),
        }));
        return { ok: true, message: `OCR fact ${decision.toLowerCase()}.`, id: factId };
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

export function useWorkspaceReady() {
  return useXbarStore((state) => isWorkspaceSetup(state.workspaceProfile));
}

export function useWorkspaceHydrated() {
  const [hydrated, setHydrated] = useState(() => useXbarStore.persist.hasHydrated());

  useEffect(() => {
    const unsubscribeHydrate = useXbarStore.persist.onHydrate(() => setHydrated(false));
    const unsubscribeFinish = useXbarStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useXbarStore.persist.hasHydrated());

    return () => {
      unsubscribeHydrate();
      unsubscribeFinish();
    };
  }, []);

  return hydrated;
}
