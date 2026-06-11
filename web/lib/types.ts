export type Tier = 'basic' | 'pro' | 'business';

export type VerificationState = 'verified' | 'pending' | 'blocked';

export type DocumentType =
  | 'registration'
  | 'coggins'
  | 'health_cert'
  | 'transfer'
  | 'bill_of_sale'
  | 'insurance'
  | 'other';

export interface Horse {
  id: string;
  name: string;
  breed: string;
  color: string;
  sex: string;
  birthdate: string; // ISO date
  registrationNumber: string;
  registry: string;
  microchip: string;
  ownerName: string;
  barnName: string;
  status: 'active' | 'sale-listed' | 'retired';
  photoUrl?: string;
  cogginsExpiresAt?: string;
  nextFarrierAt?: string;
  lastVetVisitAt?: string;
  missingDocuments: DocumentType[];
  packetReady: boolean;
}

export interface HealthRecord {
  id: string;
  horseId: string;
  kind: 'coggins' | 'vaccination' | 'deworming' | 'farrier' | 'dental';
  label: string;
  lastDate: string;
  nextDue: string;
  administeredBy: string;
}

export interface TimelineEntry {
  id: string;
  horseId: string;
  kind: 'vet' | 'farrier' | 'weight' | 'document' | 'ownership' | 'training';
  title: string;
  detail: string;
  occurredAt: string;
  actor: string;
}

export interface HorseDocument {
  id: string;
  horseId: string | null;
  horseName: string | null;
  title: string;
  fileName: string;
  type: DocumentType;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  confidence: number; // 0-1
  needsReview: boolean;
  verification: VerificationState;
  extracted: Record<string, string>;
}

export interface OcrResult {
  documentId: string;
  fileName: string;
  type: DocumentType;
  confidence: number;
  extracted: { field: string; value: string; confidence: number }[];
  suggestedHorseId: string | null;
  suggestedHorseName: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  horseId: string | null;
  horseName: string | null;
  kind: 'vet' | 'farrier' | 'lesson' | 'show';
  start: string; // ISO datetime
  durationMinutes: number;
  recurring: 'none' | 'weekly' | 'monthly' | 'yearly';
  reminder: 'none' | 'email' | 'push' | 'both';
  notes: string;
}

export interface SalePacket {
  id: string;
  horseId: string;
  horseName: string;
  buyerName: string;
  buyerEmail: string;
  watermark: string;
  documentCount: number;
  createdAt: string;
  downloadUrl: string;
  status: 'ready' | 'generating';
}

export interface OwnershipRecord {
  id: string;
  horseId: string;
  ownerName: string;
  from: string;
  to: string | null; // null = current
  transferDocumentId: string | null;
}

export interface AppNotification {
  id: string;
  title: string;
  body: string;
  severity: 'info' | 'warning' | 'danger';
  createdAt: string;
  read: boolean;
  href: string;
}

export interface Subscription {
  tier: Tier;
  tierLabel: string;
  monthlyPrice: number;
  billingInterval: 'monthly' | 'annual';
  nextBillingDate: string;
  trialEndsAt: string | null;
  usage: {
    horses: { used: number; limit: number };
    documents: { used: number; limit: number };
    seats: { used: number; limit: number };
  };
}

export interface Invoice {
  id: string;
  number: string;
  date: string;
  amount: number;
  status: 'paid' | 'open' | 'failed';
  pdfUrl: string;
}

export interface BarnMember {
  id: string;
  email: string;
  name: string;
  role: 'owner' | 'trainer' | 'vet' | 'barn-hand';
  status: 'active' | 'invited';
  lastActiveAt: string | null;
}

export interface ActivityEntry {
  id: string;
  user: string;
  action: string;
  entity: string;
  horseName: string | null;
  occurredAt: string;
}

export interface BarnBranding {
  barnName: string;
  logoFileName: string | null;
  primaryColor: string;
  secondaryColor: string;
  ownerPortalRestricted: boolean;
}

export const TIER_LABELS: Record<Tier, string> = {
  basic: 'Basic',
  pro: 'Pro',
  business: 'Business',
};

export const TIER_PRICES: Record<Tier, { monthly: number; annual: number }> = {
  basic: { monthly: 12, annual: 10 },
  pro: { monthly: 39, annual: 32 },
  business: { monthly: 89, annual: 74 },
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  registration: 'Registration',
  coggins: 'Coggins',
  health_cert: 'Health Certificate',
  transfer: 'Transfer',
  bill_of_sale: 'Bill of Sale',
  insurance: 'Insurance',
  other: 'Other',
};
