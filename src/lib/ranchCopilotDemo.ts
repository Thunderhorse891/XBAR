import type { DocumentRecord, HorseRecord } from '../types/xbar.js';

// Deliberately synthetic, never seeded into a customer's store or sent to a service.
export const copilotDemoDate = new Date(2026, 10, 20, 12);
export const copilotDemoHorse = {
  id: 'copilot-fictional-copper',
  name: 'Copper Creek Demo',
  barnName: 'Copper',
  summary: 'Fictional demonstration horse',
  segment: 'Sale Prospect',
  status: 'Sale Prep',
  breed: 'Quarter Horse',
  registry: 'AQHA',
  registrationNumber: '1234567',
  aqhaNumber: '',
  registered: true,
  age: 7,
  foaledOn: '2019-04-02',
  sex: 'Gelding',
  color: 'Sorrel',
  markings: '',
  microchipId: '',
  owner: 'Fictional Cedar Ranch',
  ownerEntity: 'Fictional Cedar Ranch',
  insuredValue: 0,
  profileImage: '',
  tags: [],
  bloodline: { sire: '', dam: '', family: '' },
  location: { ranch: 'Fictional Cedar Ranch', barn: '', pasture: '', stall: '' },
  assignments: { trainer: '', ranchManager: '', veterinarian: '', farrier: '' },
  gallery: [],
  readiness: { score: 0, blockers: [], packetStatus: 'Needs Transfer Docs' },
  medicalNotes: '',
  lastVetVisit: '',
  documents: [],
  medicalTimeline: [],
  breedingTimeline: [],
  activity: [],
  documentFacts: [],
  alerts: [],
  notes: [],
  ownership: [],
  sale: {
    listingState: 'Private',
    askPrice: 0,
    buyerConfidence: 0,
    inquiryCount: 0,
    watchlistCount: 0,
    socialReady: false,
  },
} satisfies HorseRecord;
const base = {
  horseId: copilotDemoHorse.id,
  uploadedBy: 'Fictional demo',
  uploadedAt: '2026-11-20',
  source: 'Manual Upload',
  confidence: 90,
  duplicateRisk: 'Low',
  summary: 'Synthetic document',
  extractedTextPreview: '',
} as const;
export const copilotDemoDocuments: DocumentRecord[] = [
  {
    ...base,
    id: 'demo-coggins',
    title: 'Fictional Coggins — exam 2025-12-01',
    type: 'Coggins',
    state: 'Ready',
    entities: { horseName: 'Copper Creek Demo', examDate: '2025-12-01' },
    extractedTextPreview:
      'Coggins test\nHorse name: Copper Creek Demo\nExam date: 2025-12-01\nRegistration number: 1234567',
  },
  {
    ...base,
    id: 'demo-conflict',
    title: 'Fictional registration — conflicting number',
    type: 'Registration',
    state: 'Needs Review',
    identityReviewRequired: true,
    entities: { horseName: 'Copper Creek Demo', registrationNumber: '7654321' },
    extractedTextPreview: 'Certificate of registration\nHorse name: Copper Creek Demo\nRegistration number: 7654321',
  },
];

export const copilotSecondHorse: HorseRecord = {
  ...copilotDemoHorse,
  id: 'copilot-fictional-ridge',
  name: 'Copper Ridge Demo',
  barnName: 'Copper',
  registrationNumber: '2222222',
};

/** Before/after inputs only: never a mutation or a persistence operation. */
export function copilotFixture(horseId: string, corrected: boolean) {
  const horse = horseId === copilotSecondHorse.id ? copilotSecondHorse : copilotDemoHorse;
  const documents =
    horse.id === copilotSecondHorse.id
      ? copilotDemoDocuments.map((d) => ({
          ...d,
          id: `ridge-${d.id}`,
          horseId: horse.id,
          entities: { ...d.entities, horseName: horse.name },
          extractedTextPreview: d.extractedTextPreview
            .replaceAll(copilotDemoHorse.name, horse.name)
            .replaceAll('1234567', '2222222'),
        }))
      : copilotDemoDocuments.map((d) =>
          corrected && d.id === 'demo-conflict'
            ? {
                ...d,
                title: 'Fictional registration — corrected fixture',
                state: 'Ready' as const,
                identityReviewRequired: false,
                entities: { ...d.entities, registrationNumber: '1234567' },
                extractedTextPreview: d.extractedTextPreview.replaceAll('7654321', '1234567'),
              }
            : d,
        );
  return { horse, documents };
}
