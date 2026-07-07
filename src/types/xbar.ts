export type UserRole = 'Admin' | 'Ranch Manager' | 'Owner' | 'Medical Lead' | 'Sales Lead';
export type RoleCapability =
  | 'createHorse'
  | 'editHorse'
  | 'uploadDocuments'
  | 'reviewDocuments'
  | 'uploadMedia'
  | 'manageMedical'
  | 'manageBreeding'
  | 'manageSales'
  | 'manageOwnership'
  | 'manageAssets'
  | 'manageSharedAccess'
  | 'manageSettings'
  | 'manageBilling'
  | 'syncCloud';

export type HorseSegment = 'Broodmare' | 'Stud' | 'Show String' | 'Sale Prospect' | 'Young Stock' | 'Retired';

export type HorseStatus = 'In Training' | 'Broodmare Program' | 'Sale Prep' | 'Medical Review' | 'Pasture' | 'Retired';

export type HorseSex = 'Mare' | 'Stud' | 'Gelding' | 'Filly' | 'Colt';

export type DocumentType =
  | 'Registration'
  | 'Bill of Sale'
  | 'Vet Record'
  | 'Coggins'
  | 'Breeding Contract'
  | 'Insurance'
  | 'Transfer Packet'
  | 'Media Kit'
  | 'Ownership Memo';

export type DocumentSource = 'Manual Upload' | 'Bulk Intake' | 'Shared Upload' | 'Sales Packet';

export type ProcessingState = 'Queued' | 'Needs Review' | 'Matched' | 'Ready' | 'Archived';

export type Severity = 'low' | 'medium' | 'high';

export type MedicalEventType =
  'Vet visit' | 'Vaccine' | 'Coggins' | 'Injury' | 'Dental' | 'Deworming' | 'Treatment' | 'Historical note';

export type TransferStatus = 'Clear' | 'Pending Signatures' | 'AQHA Review' | 'Attention Required';

export type SubscriptionTier = 'Starter' | 'Professional' | 'Ranch Ops' | 'Enterprise';

export type AssetCategory = 'Tack' | 'Equipment' | 'Medical Kit' | 'Feed & Supply' | 'Transport';

export type AssetStatus = 'Available' | 'Assigned' | 'In Service';

export type AssetCondition = 'Excellent' | 'Service Soon' | 'Attention Required';

export type ExpenseCategory =
  'Feed' | 'Wormer' | 'Dental Float' | 'Farrier' | 'Vet Care' | 'Supplements' | 'Bedding' | 'Travel';

export interface GalleryAsset {
  id: string;
  label: string;
  kind: 'Hero' | 'Conformation' | 'Sale Still' | 'Pedigree' | 'Document Cover';
  url: string;
  storagePath?: string;
  status: 'Approved' | 'Draft' | 'Pending';
}

export interface BloodlineProfile {
  sire: string;
  dam: string;
  family: string;
}

export interface HorseLocation {
  ranch: string;
  barn: string;
  pasture: string;
  stall: string;
}

export interface HorseAssignments {
  trainer: string;
  ranchManager: string;
  veterinarian: string;
  farrier: string;
}

export interface OwnershipStake {
  id: string;
  name: string;
  share: number;
  role: 'Legal Owner' | 'Co-Owner' | 'Managing Partner' | 'Prospective Buyer';
  contact: string;
}

export type ProofStatus = 'missing' | 'linked' | 'verified';

export type OwnershipProofKind =
  'bill_of_sale' | 'registration_certificate' | 'transfer_form' | 'signature_page' | 'supporting';

export interface OwnershipProofRequirement {
  id: string;
  kind: OwnershipProofKind;
  label: string;
  status: ProofStatus;
  documentId?: string;
  documentTitle?: string;
  linkedAt?: string;
  verifiedAt?: string;
  verifiedBy?: string;
  note?: string;
}

export type AuditEntityType =
  'ownership' | 'document' | 'horse' | 'medical' | 'breeding' | 'sale-packet' | 'asset' | 'shared-access';

export type AuditAction =
  | 'created'
  | 'updated'
  | 'linked-proof'
  | 'unlinked-proof'
  | 'verified-proof'
  | 'status-change'
  | 'deleted'
  | 'shared'
  | 'generated';

export interface AuditEvent {
  id: string;
  at: string; // ISO
  actor: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  summary: string;
  context?: Record<string, string>;
}

export type BuyerRoomEventKind =
  | 'packet-shared'
  | 'packet-viewed'
  | 'packet-downloaded'
  | 'question'
  | 'call-requested'
  | 'proof-requested'
  | 'offer'
  | 'seller-response'
  | 'deal-status';

export type DealStatus = 'open' | 'offer' | 'under-contract' | 'closed-won' | 'closed-lost';

export interface BuyerRoomEvent {
  id: string;
  horseId: string;
  packetId?: string;
  kind: BuyerRoomEventKind;
  at: string; // ISO
  actor: string; // buyer name/email or seller role
  note?: string;
  amount?: number; // offers and responses
  dealStatus?: DealStatus;
  replyToEventId?: string;
}

export interface SalePacketBuild {
  id: string;
  horseId: string;
  createdAt: string;
  createdBy: string;
  buyerName?: string;
  buyerEmail?: string;
  watermark: string;
  documentIds: string[];
  includesBillOfSale: boolean;
  status: 'draft' | 'generated' | 'shared';
  fileName?: string;
  downloadUrl?: string;
}

export interface MedicalRecordDetails {
  recordType: 'exam' | 'vaccination' | 'deworming' | 'dental' | 'farrier' | 'injury' | 'medication';
  practitioner?: string;
  medication?: string;
  dosage?: string;
  followUpDue?: string;
  documentId?: string;
}

export interface BreedingRecordDetails {
  recordType: 'breeding' | 'pregnancy-check' | 'foaling' | 'weaning' | 'contract';
  mateName?: string;
  method?: 'live-cover' | 'ai-fresh' | 'ai-frozen' | 'embryo-transfer';
  result?: string;
  dueDate?: string;
  documentId?: string;
}

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  summary: string;
  owner: string;
  category: 'Medical' | 'Breeding' | 'Ownership' | 'Sales' | 'Operations';
  status?: string;
  severity?: Severity;
  details?: MedicalRecordDetails | BreedingRecordDetails;
}

export interface DocumentFact {
  id: string;
  label: string;
  value: string;
  confidence: number;
  sourceDocumentId: string;
  decision?: 'Accepted' | 'Rejected';
}

export interface HorseNote {
  id: string;
  title: string;
  body: string;
  author: string;
  createdAt: string;
  tone: 'info' | 'watch' | 'opportunity';
}

export interface SaleProfile {
  listingState: 'Private' | 'Buyer Review' | 'Market Ready' | 'Hold';
  askPrice: number;
  buyerConfidence: number;
  inquiryCount: number;
  watchlistCount: number;
  socialReady: boolean;
}

export interface SaleReadiness {
  score: number;
  blockers: string[];
  packetStatus: 'Ready' | 'Needs Photos' | 'Needs Transfer Docs' | 'Needs Vet Review';
}

export interface HorseAlert {
  id: string;
  title: string;
  summary: string;
  severity: Severity;
  module: 'Medical' | 'Ownership' | 'Sales' | 'Breeding' | 'Documents';
}

export interface HorseRecord {
  id: string;
  name: string;
  barnName: string;
  summary: string;
  segment: HorseSegment;
  status: HorseStatus;
  breed: string;
  registry: string;
  aqhaNumber: string;
  registrationNumber: string;
  registered: boolean;
  age: number;
  foaledOn: string;
  sex: HorseSex;
  color: string;
  markings: string;
  microchipId: string;
  owner: string;
  ownerEntity: string;
  insuredValue: number;
  costBasis?: number;
  profileImage: string;
  tags: string[];
  bloodline: BloodlineProfile;
  location: HorseLocation;
  assignments: HorseAssignments;
  ownership: OwnershipStake[];
  gallery: GalleryAsset[];
  sale: SaleProfile;
  readiness: SaleReadiness;
  medicalNotes: string;
  lastVetVisit: string;
  documents: string[];
  medicalTimeline: TimelineEvent[];
  breedingTimeline: TimelineEvent[];
  breedingEconomics?: BreedingEconomics;
  activity: TimelineEvent[];
  documentFacts: DocumentFact[];
  alerts: HorseAlert[];
  notes: HorseNote[];
}

export interface DocumentEntities {
  horseName?: string;
  registrationNumber?: string;
  ownerName?: string;
  examDate?: string;
  veterinarian?: string;
  transferStatus?: string;
}

export interface DocumentRecord {
  id: string;
  batchId?: string;
  title: string;
  type: DocumentType;
  horseId?: string;
  uploadedBy: string;
  uploadedAt: string;
  source: DocumentSource;
  state: ProcessingState;
  confidence: number;
  duplicateRisk: 'Low' | 'Review' | 'Possible Duplicate';
  extractedTextPreview: string;
  summary: string;
  entities: DocumentEntities;
  fileUrl?: string;
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
}

export interface IntakeBatch {
  id: string;
  label: string;
  receivedAt: string;
  source: string;
  fileCount: number;
  processedCount: number;
  needsReviewCount: number;
  matchedCount: number;
  state: 'Queued' | 'Reviewing' | 'Completed';
}

export interface OwnershipRecord {
  id: string;
  horseId: string;
  legalOwner: string;
  transferStatus: TransferStatus;
  pendingDocuments: string[];
  complianceDeadline: string;
  confidence: number;
  auditTrail: string[];
  proofRequirements?: OwnershipProofRequirement[];
  auditEvents?: AuditEvent[];
}

export interface RanchAsset {
  id: string;
  name: string;
  category: AssetCategory;
  status: AssetStatus;
  condition: AssetCondition;
  assignedTo: string;
  location: string;
  nextService: string;
  notes: string;
}

export interface ExpenseReceipt {
  id: string;
  horseId?: string;
  title: string;
  category: ExpenseCategory;
  vendor: string;
  amount: number;
  receiptDate: string;
  notes?: string;
  uploadedAt: string;
  uploadedBy: string;
  fileUrl?: string;
  storagePath?: string;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
}

export interface SubscriptionUsage {
  horsesUsed: number;
  horseLimit: number;
  seatsUsed: number;
  seatLimit: number;
  documentsProcessed: number;
  documentLimit: number;
  salePacketsGenerated: number;
  salePacketLimit: number;
  storageUsedGb: number;
  storageLimitGb: number;
  sharedAccessSeatsUsed: number;
  sharedAccessSeatLimit: number;
}

export interface SubscriptionProfile {
  tier: SubscriptionTier;
  monthlyRate: number;
  renewalDate: string;
  billingState: 'Active' | 'Manual Billing' | 'Past Due';
  sharedAccessEnabled: boolean;
  featureFlags: string[];
  usage: SubscriptionUsage;
}

export interface RoleWorkspace {
  role: UserRole;
  label: string;
  summary: string;
  primaryModules: string[];
  permissions: string[];
}

export interface SalesLead {
  id: string;
  name: string;
  channel: 'Facebook' | 'Instagram' | 'Referral' | 'Site Inquiry';
  horseId: string;
  stage: 'New' | 'Qualified' | 'Offer' | 'Closed';
  lastTouch: string;
  nextFollowUp?: string;
  notes?: string;
  offerAmount?: number;
  counterOfferAmount?: number;
  offerStatus?: 'Draft' | 'Submitted' | 'Countered' | 'Accepted' | 'Rejected' | 'Deposit Due' | 'Deposit Paid';
  depositAmount?: number;
  depositStatus?: 'Not Requested' | 'Due' | 'Paid';
  offerUpdatedAt?: string;
  outcome?: 'Won' | 'Lost';
  savedListing: boolean;
  shareReady: boolean;
}

export type SharedChannel = 'Direct Link' | 'Facebook';
export type SharedAccessMode = 'Public Link' | 'Private Token';

export interface SharedListingRecord {
  id: string;
  horseId: string;
  sharePath: string;
  accessMode: SharedAccessMode;
  shareToken: string;
  tokenIssuedAt: string;
  state: 'Draft' | 'Live' | 'Archived';
  channels: SharedChannel[];
  createdAt: string;
  updatedAt: string;
  lastSharedAt?: string;
  releaseConfirmedAt?: string;
  releaseConfirmedBy?: string;
  releaseConfirmationVersion?: string;
}

export interface BreedingEconomics {
  studFee: number;
  bookedMares: number;
  breedingCosts: number;
  mareProductionValue: number;
  foalProjectedValue: number;
}

export interface SharedAccessSnapshot {
  invitedOwners: number;
  activeOwners: number;
  savedHorses: number;
  openInquiries: number;
}

export interface WorkspaceMemberRecord {
  id: string;
  email: string;
  role: UserRole;
  status: 'Active' | 'Inactive';
  invitedAt?: string;
  joinedAt: string;
  source: 'Owner' | 'Invite';
}

export interface WorkspaceInvitationRecord {
  id: string;
  email: string;
  role: UserRole;
  status: 'Pending' | 'Accepted' | 'Revoked';
  invitedBy: string;
  invitedAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

export interface WorkspaceProfile {
  ranchName: string;
  businessName: string;
  defaultOwnerName: string;
  defaultOwnerEntity: string;
  ranchManagerName: string;
  operationsEmail: string;
  defaultBarn: string;
  defaultPasture: string;
  workspaceShortcuts: string[];
  setupCompleteAt: string;
}
