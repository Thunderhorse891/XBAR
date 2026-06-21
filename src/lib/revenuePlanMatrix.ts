import type { SubscriptionTier } from '@/types/xbar';

export type RevenuePlanFeature = {
  label: string;
  detail: string;
};

export type RevenuePlanProfile = {
  fit: string;
  revenueRole: string;
  features: RevenuePlanFeature[];
};

export const revenuePlanMatrix: Record<SubscriptionTier, RevenuePlanProfile> = {
  Starter: {
    fit: 'For a private owner or small barn getting out of spreadsheets.',
    revenueRole: 'Entry plan that proves XBAR value through clean horse records, care history, documents, and operating visibility.',
    features: [
      { label: 'Horse records', detail: 'Identity, ownership, care notes, documents, reminders, expenses, and weather context in one workspace.' },
      { label: 'Health expiry alerts', detail: 'Track Coggins, vaccines, deworming, and treatment reminders before records go stale.' },
      { label: 'Expense ledger', detail: 'Log feed, farrier, vet, supplements, bedding, travel, and documents for cleaner cost awareness.' },
      { label: 'Documents', detail: 'Keep registration, bills of sale, vet records, Coggins, breeding contracts, insurance, and transfer packets attached to the horse file.' },
    ],
  },
  Professional: {
    fit: 'For trainers, sellers, and barns that need clients, buyers, and team coordination.',
    revenueRole: 'Core paid tier for professional operators that need collaboration, buyer readiness, and client communication.',
    features: [
      { label: 'Owner and buyer sharing', detail: 'Controlled profiles, sale listings, document sharing, and owner visibility without exposing the full workspace.' },
      { label: 'Scheduling workflow', detail: 'Vet, farrier, lesson, show, follow-up, and appointment reminders tied to the right horse or client.' },
      { label: 'Client communication controls', detail: 'Prepare owner updates, buyer follow-ups, announcements, and shared records from the operating file.' },
      { label: 'Role-based team access', detail: 'Support owners, trainers, medical leads, and sales leads with the right level of workspace access.' },
    ],
  },
  'Ranch Ops': {
    fit: 'For serious barns and ranches managing multiple horses, people, supplies, care work, and sales movement.',
    revenueRole: 'High-value operating tier designed to support the revenue target with fewer serious barn accounts.',
    features: [
      { label: 'Business management', detail: 'Board, training, farrier, expense, late-fee, payroll summary, and profit/loss workflows planned around barn operations.' },
      { label: 'Inventory and supply control', detail: 'Track hay, grain, bedding, supplements, equipment, low-stock alerts, purchase lists, and cost per horse per month.' },
      { label: 'Breeding and foaling operations', detail: 'Mare cycle tracking, teasing logs, stallion book, breeding contracts, foaling notes, and birth records.' },
      { label: 'Activity accountability', detail: 'Time-stamped care, medication, feeding, turnout, document, and owner/buyer actions in one rhythm.' },
    ],
  },
  Enterprise: {
    fit: 'For high-volume boarding facilities, breeding programs, and multi-location equine businesses.',
    revenueRole: 'Premium capacity tier for operations that need scale, permissions, exports, integrations, and white-glove support.',
    features: [
      { label: 'Enterprise permissions', detail: 'Higher team capacity, owner portal control, audit visibility, and separation between staff, clients, buyers, vets, and farriers.' },
      { label: 'Data portability', detail: 'Bulk imports, CSV exports, QuickBooks-ready reporting, Google Calendar workflows, and API-ready integration planning.' },
      { label: 'Advanced automation roadmap', detail: 'Offline mobile workflows, QR stall access, voice entry, smart sensor intake, and telemedicine-ready PDF logs.' },
      { label: 'Priority implementation path', detail: 'Designed for larger barns that need onboarding, migration support, workflow setup, and integration planning.' },
    ],
  },
};
