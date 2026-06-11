import type {
  ActivityEntry,
  AppNotification,
  BarnBranding,
  BarnMember,
  CalendarEvent,
  HealthRecord,
  Horse,
  HorseDocument,
  Invoice,
  OwnershipRecord,
  SalePacket,
  TimelineEntry,
} from './types';

// All mock dates are computed relative to "now" so expiry warnings, the
// calendar, and trial countdowns always demonstrate real behavior.
const DAY = 86_400_000;
export const now = () => new Date();
export const iso = (offsetDays: number, hour = 9) => {
  const date = new Date(Date.now() + offsetDays * DAY);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

export const horses: Horse[] = [
  {
    id: 'h-spirit',
    name: 'Spirit of the Desert',
    breed: 'Arabian',
    color: 'Bay',
    sex: 'Mare',
    birthdate: '2019-04-12',
    registrationNumber: 'AHA 0654321',
    registry: 'AHA',
    microchip: '985112004567890',
    ownerName: 'Erin Wyrick',
    barnName: 'North Barn',
    status: 'sale-listed',
    cogginsExpiresAt: iso(4),
    nextFarrierAt: iso(11),
    lastVetVisitAt: iso(-18),
    missingDocuments: [],
    packetReady: true,
  },
  {
    id: 'h-thunder',
    name: 'Thunderbolt',
    breed: 'Thoroughbred',
    color: 'Dark Bay',
    sex: 'Gelding',
    birthdate: '2017-02-03',
    registrationNumber: 'JC 9988776',
    registry: 'Jockey Club',
    microchip: '985112004511223',
    ownerName: 'Erin Wyrick',
    barnName: 'North Barn',
    status: 'active',
    cogginsExpiresAt: iso(212),
    nextFarrierAt: iso(3),
    lastVetVisitAt: iso(-44),
    missingDocuments: ['health_cert'],
    packetReady: false,
  },
  {
    id: 'h-glory',
    name: 'Morning Glory',
    breed: 'Arabian',
    color: 'Grey',
    sex: 'Mare',
    birthdate: '2012-05-20',
    registrationNumber: 'AHA 0111111',
    registry: 'AHA',
    microchip: '985112004533445',
    ownerName: 'Hollis Ranch LLC',
    barnName: 'Broodmare Barn',
    status: 'active',
    cogginsExpiresAt: iso(96),
    nextFarrierAt: iso(21),
    lastVetVisitAt: iso(-6),
    missingDocuments: ['registration', 'transfer'],
    packetReady: false,
  },
  {
    id: 'h-comet',
    name: 'Comet',
    breed: 'Quarter Horse',
    color: 'Sorrel',
    sex: 'Gelding',
    birthdate: '2015-08-01',
    registrationNumber: 'AQHA 5544332',
    registry: 'AQHA',
    microchip: '985112004599887',
    ownerName: 'Erin Wyrick',
    barnName: 'North Barn',
    status: 'active',
    cogginsExpiresAt: iso(-9),
    nextFarrierAt: iso(35),
    lastVetVisitAt: iso(-92),
    missingDocuments: ['coggins'],
    packetReady: false,
  },
  {
    id: 'h-vega',
    name: 'Vega',
    breed: 'Warmblood',
    color: 'Black',
    sex: 'Mare',
    birthdate: '2020-03-28',
    registrationNumber: 'USEF 7700991',
    registry: 'USEF',
    microchip: '985112004522110',
    ownerName: 'Caldwell Equine',
    barnName: 'Performance Barn',
    status: 'active',
    cogginsExpiresAt: iso(301),
    nextFarrierAt: iso(8),
    lastVetVisitAt: iso(-2),
    missingDocuments: [],
    packetReady: true,
  },
];

export const healthRecords: HealthRecord[] = [
  { id: 'hr-1', horseId: 'h-spirit', kind: 'coggins', label: 'Coggins (EIA) test', lastDate: iso(-361), nextDue: iso(4), administeredBy: 'Dr. Maria Lopez' },
  { id: 'hr-2', horseId: 'h-spirit', kind: 'vaccination', label: 'EWT/WN vaccine', lastDate: iso(-122), nextDue: iso(243), administeredBy: 'Dr. Maria Lopez' },
  { id: 'hr-3', horseId: 'h-spirit', kind: 'deworming', label: 'Ivermectin rotation', lastDate: iso(-61), nextDue: iso(29), administeredBy: 'Barn staff' },
  { id: 'hr-4', horseId: 'h-spirit', kind: 'farrier', label: 'Trim & reset', lastDate: iso(-31), nextDue: iso(11), administeredBy: 'C. Booker' },
  { id: 'hr-5', horseId: 'h-thunder', kind: 'coggins', label: 'Coggins (EIA) test', lastDate: iso(-153), nextDue: iso(212), administeredBy: 'Dr. Owen Pratt' },
  { id: 'hr-6', horseId: 'h-thunder', kind: 'farrier', label: 'Front shoes', lastDate: iso(-39), nextDue: iso(3), administeredBy: 'C. Booker' },
  { id: 'hr-7', horseId: 'h-comet', kind: 'coggins', label: 'Coggins (EIA) test', lastDate: iso(-374), nextDue: iso(-9), administeredBy: 'Dr. Owen Pratt' },
  { id: 'hr-8', horseId: 'h-glory', kind: 'dental', label: 'Dental float', lastDate: iso(-180), nextDue: iso(185), administeredBy: 'Dr. Maria Lopez' },
];

export const timeline: TimelineEntry[] = Array.from({ length: 36 }, (_, index) => {
  const kinds: TimelineEntry['kind'][] = ['vet', 'farrier', 'weight', 'document', 'ownership', 'training'];
  const kind = kinds[index % kinds.length]!;
  const horse = horses[index % horses.length]!;
  const titles: Record<TimelineEntry['kind'], [string, string]> = {
    vet: ['Veterinary exam', 'Routine wellness exam. No findings. Heart rate 36 bpm.'],
    farrier: ['Farrier visit', 'Trim and reset, all four. Slight flare corrected on left front.'],
    weight: ['Weight recorded', `Tape weight ${980 + (index % 6) * 14} lbs, body condition 5/9.`],
    document: ['Document uploaded', 'Coggins certificate scanned and verified via OCR.'],
    ownership: ['Ownership reviewed', 'Ownership chain verified against registry record.'],
    training: ['Training session', '45-minute flat session. Transitions and lateral work.'],
  };
  return {
    id: `tl-${index}`,
    horseId: horse.id,
    kind,
    title: titles[kind][0],
    detail: titles[kind][1],
    occurredAt: iso(-(index * 4 + 1), 14),
    actor: index % 3 === 0 ? 'Dr. Maria Lopez' : index % 3 === 1 ? 'C. Booker' : 'Erin Wyrick',
  };
});

export const documents: HorseDocument[] = [
  {
    id: 'd-1',
    horseId: 'h-spirit',
    horseName: 'Spirit of the Desert',
    title: 'AHA Certificate of Registration',
    fileName: 'spirit-registration.pdf',
    type: 'registration',
    mimeType: 'application/pdf',
    sizeBytes: 1_240_000,
    uploadedAt: iso(-41, 11),
    uploadedBy: 'Erin Wyrick',
    confidence: 0.97,
    needsReview: false,
    verification: 'verified',
    extracted: { name: 'Spirit of the Desert', registrationNumber: 'AHA 0654321', breed: 'Arabian' },
  },
  {
    id: 'd-2',
    horseId: 'h-spirit',
    horseName: 'Spirit of the Desert',
    title: 'Coggins Test — Negative',
    fileName: 'spirit-coggins-2025.pdf',
    type: 'coggins',
    mimeType: 'application/pdf',
    sizeBytes: 680_000,
    uploadedAt: iso(-361, 15),
    uploadedBy: 'Dr. Maria Lopez',
    confidence: 0.94,
    needsReview: false,
    verification: 'verified',
    extracted: { testDate: iso(-361).slice(0, 10), result: 'negative', labId: 'LAB-88421' },
  },
  {
    id: 'd-3',
    horseId: 'h-thunder',
    horseName: 'Thunderbolt',
    title: 'Jockey Club Registration',
    fileName: 'thunderbolt-jc-papers.pdf',
    type: 'registration',
    mimeType: 'application/pdf',
    sizeBytes: 2_100_000,
    uploadedAt: iso(-120, 10),
    uploadedBy: 'Erin Wyrick',
    confidence: 0.91,
    needsReview: false,
    verification: 'verified',
    extracted: { name: 'Thunderbolt', registrationNumber: 'JC 9988776' },
  },
  {
    id: 'd-4',
    horseId: 'h-glory',
    horseName: 'Morning Glory',
    title: 'Transfer of Ownership (scan)',
    fileName: 'glory-transfer-scan.jpg',
    type: 'transfer',
    mimeType: 'image/jpeg',
    sizeBytes: 3_400_000,
    uploadedAt: iso(-3, 16),
    uploadedBy: 'Erin Wyrick',
    confidence: 0.74,
    needsReview: true,
    verification: 'pending',
    extracted: { previousOwner: 'J. Hollis', newOwner: 'Hollis Ranch LLC' },
  },
  {
    id: 'd-5',
    horseId: null,
    horseName: null,
    title: 'Unassigned Coggins scan',
    fileName: 'IMG_2284.jpg',
    type: 'coggins',
    mimeType: 'image/jpeg',
    sizeBytes: 4_900_000,
    uploadedAt: iso(-1, 9),
    uploadedBy: 'Erin Wyrick',
    confidence: 0.62,
    needsReview: true,
    verification: 'blocked',
    extracted: { name: 'C0met (?)', testDate: '' },
  },
  {
    id: 'd-6',
    horseId: 'h-vega',
    horseName: 'Vega',
    title: 'Health Certificate — Interstate',
    fileName: 'vega-cvi.pdf',
    type: 'health_cert',
    mimeType: 'application/pdf',
    sizeBytes: 890_000,
    uploadedAt: iso(-12, 13),
    uploadedBy: 'Dr. Owen Pratt',
    confidence: 0.96,
    needsReview: false,
    verification: 'verified',
    extracted: { examDate: iso(-12).slice(0, 10), destination: 'Lexington, KY' },
  },
  {
    id: 'd-7',
    horseId: 'h-spirit',
    horseName: 'Spirit of the Desert',
    title: 'Bill of Sale (generated)',
    fileName: 'spirit-bill-of-sale.pdf',
    type: 'bill_of_sale',
    mimeType: 'application/pdf',
    sizeBytes: 220_000,
    uploadedAt: iso(-2, 17),
    uploadedBy: 'XBAR generator',
    confidence: 1,
    needsReview: false,
    verification: 'verified',
    extracted: { buyer: 'John Smith', price: '$18,500' },
  },
];

export const ownership: OwnershipRecord[] = [
  { id: 'o-1', horseId: 'h-spirit', ownerName: 'Erin Wyrick', from: iso(-540), to: null, transferDocumentId: null },
  { id: 'o-2', horseId: 'h-spirit', ownerName: 'Desert Wind Arabians', from: iso(-1900), to: iso(-540), transferDocumentId: 'd-1' },
  { id: 'o-3', horseId: 'h-glory', ownerName: 'Hollis Ranch LLC', from: iso(-3), to: null, transferDocumentId: 'd-4' },
  { id: 'o-4', horseId: 'h-glory', ownerName: 'J. Hollis', from: iso(-2200), to: iso(-3), transferDocumentId: null },
];

export const calendarEvents: CalendarEvent[] = [
  { id: 'e-1', title: 'Coggins draw — Spirit', horseId: 'h-spirit', horseName: 'Spirit of the Desert', kind: 'vet', start: iso(2, 10), durationMinutes: 45, recurring: 'none', reminder: 'email', notes: 'Dr. Lopez mobile visit.' },
  { id: 'e-2', title: 'Farrier — Thunderbolt', horseId: 'h-thunder', horseName: 'Thunderbolt', kind: 'farrier', start: iso(3, 8), durationMinutes: 60, recurring: 'monthly', reminder: 'both', notes: '' },
  { id: 'e-3', title: 'Lesson — Vega flatwork', horseId: 'h-vega', horseName: 'Vega', kind: 'lesson', start: iso(1, 16), durationMinutes: 45, recurring: 'weekly', reminder: 'push', notes: '' },
  { id: 'e-4', title: 'Region 9 Qualifier', horseId: 'h-spirit', horseName: 'Spirit of the Desert', kind: 'show', start: iso(12, 7), durationMinutes: 480, recurring: 'none', reminder: 'email', notes: 'Haul-in 6 AM.' },
  { id: 'e-5', title: 'Spring vaccines — barn', horseId: null, horseName: null, kind: 'vet', start: iso(6, 9), durationMinutes: 180, recurring: 'yearly', reminder: 'email', notes: 'All North Barn horses.' },
  { id: 'e-6', title: 'Farrier — Vega', horseId: 'h-vega', horseName: 'Vega', kind: 'farrier', start: iso(8, 9), durationMinutes: 45, recurring: 'none', reminder: 'none', notes: '' },
  { id: 'e-7', title: 'Lesson — junior group', horseId: 'h-comet', horseName: 'Comet', kind: 'lesson', start: iso(-2, 15), durationMinutes: 60, recurring: 'weekly', reminder: 'none', notes: '' },
  { id: 'e-8', title: 'Schooling show — Comet', horseId: 'h-comet', horseName: 'Comet', kind: 'show', start: iso(19, 8), durationMinutes: 360, recurring: 'none', reminder: 'email', notes: '' },
];

export const salePackets: SalePacket[] = [
  {
    id: 'p-1',
    horseId: 'h-spirit',
    horseName: 'Spirit of the Desert',
    buyerName: 'John Smith',
    buyerEmail: 'john@example.com',
    watermark: 'Copy for John Smith',
    documentCount: 4,
    createdAt: iso(-2, 17),
    downloadUrl: '#packet-p-1',
    status: 'ready',
  },
];

export const notifications: AppNotification[] = [
  { id: 'n-1', title: 'Coggins expires in 4 days', body: 'Spirit of the Desert — schedule a new EIA draw before the qualifier.', severity: 'danger', createdAt: iso(0, 7), read: false, href: '/horses/h-spirit' },
  { id: 'n-2', title: 'Coggins expired', body: 'Comet — expired 9 days ago. Sale packet generation is blocked.', severity: 'danger', createdAt: iso(-1, 8), read: false, href: '/horses/h-comet' },
  { id: 'n-3', title: 'Document needs review', body: 'Unassigned Coggins scan at 62% confidence. Assign to a horse.', severity: 'warning', createdAt: iso(-1, 9), read: false, href: '/documents' },
  { id: 'n-4', title: 'Farrier due in 3 days', body: 'Thunderbolt — front shoes with C. Booker.', severity: 'warning', createdAt: iso(0, 6), read: true, href: '/calendar' },
  { id: 'n-5', title: 'Sale packet downloaded', body: 'John Smith opened the Spirit of the Desert packet.', severity: 'info', createdAt: iso(-1, 19), read: true, href: '/horses/h-spirit' },
];

export const invoices: Invoice[] = [
  { id: 'i-1', number: 'XBAR-2026-0143', date: iso(-8), amount: 39, status: 'paid', pdfUrl: '#invoice-1' },
  { id: 'i-2', number: 'XBAR-2026-0117', date: iso(-38), amount: 39, status: 'paid', pdfUrl: '#invoice-2' },
  { id: 'i-3', number: 'XBAR-2026-0089', date: iso(-69), amount: 39, status: 'paid', pdfUrl: '#invoice-3' },
  { id: 'i-4', number: 'XBAR-2026-0061', date: iso(-99), amount: 12, status: 'paid', pdfUrl: '#invoice-4' },
];

export const barnMembers: BarnMember[] = [
  { id: 'm-1', email: 'erinswyrick85@gmail.com', name: 'Erin Wyrick', role: 'owner', status: 'active', lastActiveAt: iso(0, 6) },
  { id: 'm-2', email: 'mlopez@vetpartners.com', name: 'Dr. Maria Lopez', role: 'vet', status: 'active', lastActiveAt: iso(-1, 15) },
  { id: 'm-3', email: 'cbooker@farrierworks.com', name: 'Cole Booker', role: 'barn-hand', status: 'active', lastActiveAt: iso(-4, 12) },
  { id: 'm-4', email: 'trainer@performancebarn.com', name: 'Avery Quinn', role: 'trainer', status: 'invited', lastActiveAt: null },
];

export const activityLog: ActivityEntry[] = [
  { id: 'a-1', user: 'Erin Wyrick', action: 'Generated sale packet', entity: 'Sale packet', horseName: 'Spirit of the Desert', occurredAt: iso(-2, 17) },
  { id: 'a-2', user: 'Dr. Maria Lopez', action: 'Uploaded document', entity: 'Health certificate', horseName: 'Vega', occurredAt: iso(-12, 13) },
  { id: 'a-3', user: 'Erin Wyrick', action: 'Edited profile', entity: 'Horse record', horseName: 'Morning Glory', occurredAt: iso(-3, 10) },
  { id: 'a-4', user: 'Cole Booker', action: 'Logged farrier visit', entity: 'Timeline entry', horseName: 'Thunderbolt', occurredAt: iso(-4, 12) },
  { id: 'a-5', user: 'Erin Wyrick', action: 'Invited member', entity: 'Barn access', horseName: null, occurredAt: iso(-6, 9) },
  { id: 'a-6', user: 'Avery Quinn', action: 'Viewed horse record', entity: 'Horse record', horseName: 'Vega', occurredAt: iso(-7, 18) },
];

export const branding: BarnBranding = {
  barnName: 'North Barn Operations',
  logoFileName: null,
  primaryColor: '#18A8FF',
  secondaryColor: '#11151B',
  ownerPortalRestricted: true,
};
