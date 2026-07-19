import type {
  AuditAction,
  AuditEntityType,
  AuditEvent,
  BreedingEconomics,
  BuyerRoomEvent,
  DocumentRecord,
  ExpenseReceipt,
  HorseNote,
  HorseRecord,
  IntakeBatch,
  MedicalEventType,
  OwnershipRecord,
  OwnershipStake,
  RanchAsset,
  RoleWorkspace,
  SalePacketBuild,
  SalesLead,
  SharedAccessSnapshot,
  SharedChannel,
  SharedListingRecord,
  SubscriptionProfile,
  SubscriptionTier,
  TimelineEvent,
  UserRole,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
  WorkspaceProfile,
} from '@/types/xbar';
import type {
  AssetPatch,
  DocumentIntakeInput,
  ExpenseReceiptInput,
  LeadInput,
  LocationPatch,
  MediaUploadInput,
  NewHorseInput,
} from '@/store/xbarStoreLogic';

export type ActionResult = {
  ok: boolean;
  message: string;
  id?: string;
  createdHorseIds?: string[];
};

export type HorsePatch = Partial<
  Pick<
    HorseRecord,
    | 'name'
    | 'barnName'
    | 'breed'
    | 'color'
    | 'sex'
    | 'foaledOn'
    | 'registrationNumber'
    | 'registry'
    | 'aqhaNumber'
    | 'owner'
    | 'ownerEntity'
    | 'segment'
    | 'status'
    | 'costBasis'
  >
> & { askPrice?: number; sire?: string; dam?: string };

export type XbarStore = {
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
  applySubscriptionTier: (
    tier: SubscriptionTier,
    options?: { billingState?: SubscriptionProfile['billingState'] },
  ) => ActionResult;
  toggleSharedListing: (horseId: string) => Promise<ActionResult>;
  confirmSharedListingRelease: (horseId: string, confirmedBy: string) => Promise<ActionResult>;
  recordSharedChannel: (horseId: string, channel: SharedChannel) => Promise<ActionResult>;
  rotateSharedListingToken: (horseId: string) => Promise<ActionResult>;
  updateSharedListingAccessMode: (
    horseId: string,
    accessMode: SharedListingRecord['accessMode'],
  ) => Promise<ActionResult>;
  inviteWorkspaceMember: (email: string, role: UserRole) => Promise<ActionResult>;
  revokeWorkspaceInvitation: (invitationId: string) => Promise<ActionResult>;
  activateWorkspaceInvitation: (invitationId: string) => ActionResult;
  removeWorkspaceMember: (memberId: string) => Promise<ActionResult>;
  addHorse: (input: NewHorseInput) => ActionResult;
  createDocumentIntake: (input: DocumentIntakeInput) => Promise<ActionResult>;
  reviewDocument: (documentId: string, horseId?: string) => ActionResult;
  createHorseFromDocument: (documentId: string) => ActionResult;
  discardDocument: (documentId: string) => ActionResult;
  uploadHorseMedia: (input: MediaUploadInput) => Promise<ActionResult>;
  addExpenseReceipt: (input: ExpenseReceiptInput) => Promise<ActionResult>;
  createSalesLead: (input: LeadInput) => ActionResult;
  updateSalesLead: (
    leadId: string,
    patch: Partial<
      Pick<
        SalesLead,
        | 'stage'
        | 'lastTouch'
        | 'nextFollowUp'
        | 'notes'
        | 'offerAmount'
        | 'counterOfferAmount'
        | 'offerStatus'
        | 'depositAmount'
        | 'depositStatus'
        | 'offerUpdatedAt'
        | 'savedListing'
        | 'shareReady'
        | 'outcome'
      >
    >,
  ) => ActionResult;
  addRanchAsset: (asset: Pick<RanchAsset, 'name' | 'category' | 'location'>) => ActionResult;
  updateAsset: (assetId: string, patch: AssetPatch) => ActionResult;
  deleteAsset: (assetId: string) => ActionResult;
  addHorseNote: (horseId: string, note: Pick<HorseNote, 'title' | 'body' | 'author' | 'tone'>) => ActionResult;
  addMedicalEvent: (
    horseId: string,
    event: Pick<HorseNote, 'title' | 'body' | 'author'> & { date: string; type: MedicalEventType },
  ) => ActionResult;
  addBreedingEvent: (
    horseId: string,
    event: Pick<HorseNote, 'title' | 'body' | 'author'> & { date: string },
  ) => ActionResult;
  updateBreedingEconomics: (horseId: string, economics: BreedingEconomics) => ActionResult;
  deleteBreedingEvent: (horseId: string, eventId: string) => ActionResult;
  updateHorseLocation: (horseId: string, patch: LocationPatch) => ActionResult;
  updateHorse: (horseId: string, patch: HorsePatch) => ActionResult;
  deleteHorse: (horseId: string) => ActionResult;
  updateMedicalEvent: (
    horseId: string,
    eventId: string,
    patch: Partial<Pick<TimelineEvent, 'title' | 'summary' | 'date' | 'status'>>,
  ) => ActionResult;
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

export type PersistedXbarState = Pick<
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

export type WorkspaceBackup = {
  app: 'XBAR';
  version: number;
  exportedAt: string;
  workspace: PersistedXbarState;
};
