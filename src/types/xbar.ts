export type UserRole = 'Admin' | 'Ranch Manager' | 'Owner' | 'Medical Lead' | 'Sales Lead';

export type HorseSegment =
  | 'Broodmare'
  | 'Stud'
  | 'Show String'
  | 'Sale Prospect'
  | 'Young Stock'
  | 'Retired';

export type HorseStatus =
  | 'In Training'
  | 'Broodmare Program'
  | 'Sale Prep'
  | 'Medical Review'
  | 'Pasture'
  | 'Retired';

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

export type DocumentSource = 'Manual Upload' | 'Bulk Intake' | 'Owner Portal' | 'Sales Packet';

export type ProcessingState =
  | 'Queued'
  | 'Extracting'
  | 'Needs Review'
  | 'Matched'
  | 'Ready'
  | 'Archived';

export type Severity = 'low' | 'medium' | 'high';

export type TransferStatus = 'Clear' | 'Pending Signatures' | 'AQHA Review' | 'Attention Required';

export type SubscriptionTier = 'Starter' | 'Professional' | 'Ranch Ops' | 'Enterprise';

export type AssetCategory = 'Tack' | 'Equipment' | 'Medical Kit' | 'Feed & Supply' | 'Transport';

export type AssetStatus = 'Available' | 'Assigned' | 'In Service';

export type AssetCondition = 'Excellent' | 'Service Soon' | 'Attention Required';

export interface GalleryAsset {
  id: string;
  label: string;
  kind: 'Hero' | 'Conformation' | 'Sale Still' | 'Pedigree' | 'Document Cover';
  url: string;
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

export interface TimelineEvent {
  id: string;
  date: string;
  title: string;
  summary: string;
  owner: string;
  category: 'Medical' | 'Breeding' | 'Ownership' | 'Sales' | 'Operations';
  status?: string;
  severity?: Severity;
}

export interface ExtractedFact {
  id: string;
  label: string;
  value: string;
  confidence: number;
  sourceDocumentId: string;
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
  activity: TimelineEvent[];
  ocrFacts: ExtractedFact[];
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
}

export interface OCRBatch {
  id: string;
  label: string;
  receivedAt: string;
  source: string;
  fileCount: number;
  processedCount: number;
  needsReviewCount: number;
  matchedCount: number;
  state: 'Intaking' | 'Processing' | 'Reviewing' | 'Completed';
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
}

export interface WeatherAlert {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  impact: string;
  effectiveAt: string;
}

export interface WeatherSnapshot {
  ranchName: string;
  locale: string;
  updatedAt: string;
  currentTempF: number;
  condition: string;
  windMph: number;
  humidity: number;
  riskLevel: 'Stable' | 'Watch' | 'Action';
  pastureImpact: string;
  transportImpact: string;
  breedingNote: string;
  alerts: WeatherAlert[];
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

export interface SubscriptionUsage {
  seatsUsed: number;
  seatLimit: number;
  ocrProcessed: number;
  ocrLimit: number;
  storageUsedGb: number;
  storageLimitGb: number;
  portalSeatsUsed: number;
  portalSeatLimit: number;
}

export interface SubscriptionProfile {
  tier: SubscriptionTier;
  monthlyRate: number;
  renewalDate: string;
  billingState: 'Active' | 'Upgrade Review' | 'Trial';
  ownerPortalEnabled: boolean;
  brandedListings: boolean;
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
  savedListing: boolean;
  ownerPortalReady: boolean;
}

export interface PortalSnapshot {
  invitedOwners: number;
  activeOwners: number;
  savedHorses: number;
  openInquiries: number;
  googleAuthReady: boolean;
  facebookAuthReady: boolean;
}
