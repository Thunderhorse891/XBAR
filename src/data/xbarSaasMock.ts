/**
 * Realistic XBAR mock data for the rebuilt SaaS surfaces. These power the
 * Cake-style dashboard, intelligence rail, and transaction flows when the
 * backend is not wired yet. Numbers mirror the product spec.
 */

export type ReadinessState = 'Ready' | 'Review' | 'Hold';
export type ChipTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brass';

export const stateToTone: Record<ReadinessState | 'Clear' | 'Blocked' | 'Complete', ChipTone> = {
  Ready: 'success',
  Clear: 'success',
  Complete: 'success',
  Review: 'warning',
  Hold: 'danger',
  Blocked: 'danger',
};

export const xbarRanch = {
  name: 'Thunder Horse Ranch',
  id: 'XBAR-THR-001',
  plan: 'Ranch Ops',
  setupProgress: 64,
  initials: 'TH',
};

export const dashboardMetrics = {
  horses: 32,
  activeSaleProspects: 8,
  documentsExpiring: 15,
  buyerDealRooms: 4,
  readinessScore: 94,
};

export const readinessSegments = [
  { label: 'Ready', value: 26, tone: 'var(--xbar-success)' },
  { label: 'Review', value: 4, tone: 'var(--xbar-warning)' },
  { label: 'Hold', value: 2, tone: 'var(--xbar-danger)' },
];

export const topReleaseItems: { label: string; state: ReadinessState | 'Clear'; detail: string }[] = [
  { label: 'Buyer-Safe Proof', state: 'Clear', detail: 'Watermarked proof verified across active assets.' },
  { label: 'Documents', state: 'Clear', detail: 'All required documents present and current.' },
  { label: 'Ownership Chain', state: 'Clear', detail: 'Title history complete and unbroken.' },
  { label: 'Packet Readiness', state: 'Review', detail: 'One packet needs a final review before release.' },
  { label: 'Release Blockers', state: 'Hold', detail: 'Health certificate expiration date missing.' },
];

export const activity30d = [
  { num: 1, label: 'Action Item', delta: 'open', to: '/getting-started' },
  { num: 2, label: 'Offers Created', delta: '+1 vs prev', to: '/sales-pipeline' },
  { num: 3, label: 'Packets Shared', delta: '+2 vs prev', to: '/sale-packet-studio' },
  { num: 7, label: 'Documents Uploaded', delta: '+3 vs prev', to: '/documents' },
  { num: 4, label: 'Buyer Views', delta: '+4 vs prev', to: '/buyer-deal-room' },
];

export const pipelineFeature = {
  name: 'RHA Pine Barrel Prospect',
  steps: ['Packet prepared', 'Buyer invited', 'Deal room opened', 'Offer received', 'Release ready'],
  currentStep: 3,
  currentOffer: 20000,
  targetPrice: 35000,
  daysActive: 23,
};

export const documentExpiry = {
  total: 15,
  breakdown: [
    { label: 'Health Certs', count: 7 },
    { label: 'Coggins', count: 5 },
    { label: 'Foal Regs', count: 3 },
  ],
};

export const intelligenceRail = {
  status: 'Active' as const,
  release: [
    { label: 'Ready to release', value: '94%', tone: 'success' as ChipTone },
    { label: 'Review', value: '1 item', tone: 'warning' as ChipTone },
    { label: 'Hold', value: '1 item', tone: 'danger' as ChipTone },
  ],
  nextAction: {
    title: 'Resolve 1 release blocker',
    detail: 'Health certificate expiration date missing',
  },
  recentActivity: [
    { label: 'Buyer downloaded packet', time: '12m ago' },
    { label: 'Call requested', time: '1h ago' },
    { label: 'Document uploaded', time: '3h ago' },
    { label: 'Buyer viewed deal room', time: 'Yesterday' },
  ],
};

export const gettingStartedSteps: {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action: string;
  to: string;
}[] = [
  { id: 'ranch', title: 'Create ranch profile', detail: 'Name, location, and operating identity.', done: true, action: 'View', to: '/settings' },
  { id: 'horse', title: 'Add first horse', detail: 'Start the horse record with identity and status.', done: true, action: 'View', to: '/horses' },
  { id: 'coggins', title: 'Upload Coggins', detail: 'Attach the negative Coggins test record.', done: true, action: 'View', to: '/documents' },
  { id: 'health', title: 'Upload health certificate', detail: 'Add a current health certificate with expiration.', done: false, action: 'Upload', to: '/documents?upload=1' },
  { id: 'packet', title: 'Create sale packet', detail: 'Assemble a buyer-ready packet in the studio.', done: false, action: 'Open Studio', to: '/sale-packet-studio' },
  { id: 'buyer', title: 'Invite buyer', detail: 'Send a secure invitation to a prospective buyer.', done: false, action: 'Invite', to: '/buyer-deal-room' },
  { id: 'room', title: 'Open deal room', detail: 'Launch a controlled buyer deal room.', done: false, action: 'Open', to: '/buyer-deal-room' },
  { id: 'plan', title: 'Choose subscription plan', detail: 'Pick the plan that matches your operation.', done: false, action: 'Compare', to: '/subscriptions' },
];

export type SaaSHorse = {
  id: string;
  name: string;
  readinessScore: number;
  saleStatus: ReadinessState;
  blockers: string[];
  buyerViews: number;
  packetShared: boolean;
  currentOffer: number | null;
  targetPrice: number;
  discipline: string;
};

export const saasHorses: SaaSHorse[] = [
  { id: 'rha-pine-barrel-prospect', name: 'RHA Pine Barrel Prospect', readinessScore: 94, saleStatus: 'Review', blockers: ['Health certificate expiration date missing'], buyerViews: 8, packetShared: true, currentOffer: 20000, targetPrice: 35000, discipline: 'Ranch / Reining' },
  { id: 'thr-copper-canyon', name: 'THR Copper Canyon', readinessScore: 100, saleStatus: 'Ready', blockers: [], buyerViews: 5, packetShared: true, currentOffer: 28000, targetPrice: 30000, discipline: 'Cutting' },
  { id: 'thr-juniper-ledge', name: 'THR Juniper Ledge', readinessScore: 88, saleStatus: 'Review', blockers: ['Bill of sale unsigned'], buyerViews: 3, packetShared: false, currentOffer: null, targetPrice: 22000, discipline: 'Trail / Ranch' },
  { id: 'thr-stone-mesa', name: 'THR Stone Mesa', readinessScore: 61, saleStatus: 'Hold', blockers: ['Coggins expired', 'Ownership transfer pending'], buyerViews: 1, packetShared: false, currentOffer: null, targetPrice: 18000, discipline: 'Prospect' },
];

export type DealRoom = {
  id: string;
  buyer: string;
  horse: string;
  access: 'Active' | 'Pending' | 'Revoked';
  packetViews: number;
  downloads: number;
  offer: ReadinessState | 'Received' | 'None';
  offerAmount: number | null;
  lastActivity: string;
};

export const dealRooms: DealRoom[] = [
  { id: 'dr-001', buyer: 'Marlow Ranch Partners', horse: 'RHA Pine Barrel Prospect', access: 'Active', packetViews: 8, downloads: 2, offer: 'Received', offerAmount: 20000, lastActivity: '12m ago' },
  { id: 'dr-002', buyer: 'Cedar Hollow Equine', horse: 'THR Copper Canyon', access: 'Active', packetViews: 5, downloads: 1, offer: 'Received', offerAmount: 28000, lastActivity: '2h ago' },
  { id: 'dr-003', buyer: 'J. Castellano', horse: 'THR Juniper Ledge', access: 'Pending', packetViews: 0, downloads: 0, offer: 'None', offerAmount: null, lastActivity: 'Invited yesterday' },
  { id: 'dr-004', buyer: 'High Plains Stock Co.', horse: 'THR Copper Canyon', access: 'Active', packetViews: 3, downloads: 0, offer: 'None', offerAmount: null, lastActivity: '1d ago' },
];

export type DataRoomDoc = {
  id: string;
  name: string;
  type: 'Health Cert' | 'Coggins' | 'Registration' | 'Bill of Sale' | 'Photos' | 'Contracts';
  horse: string;
  transaction: string;
  status: 'Current' | 'Expiring' | 'Missing' | 'Review';
  expires: string | null;
};

export const dataRoomDocs: DataRoomDoc[] = [
  { id: 'd1', name: 'Health Certificate — Pine Barrel', type: 'Health Cert', horse: 'RHA Pine Barrel Prospect', transaction: 'Marlow Ranch Partners', status: 'Missing', expires: null },
  { id: 'd2', name: 'Coggins (negative) — Pine Barrel', type: 'Coggins', horse: 'RHA Pine Barrel Prospect', transaction: 'Marlow Ranch Partners', status: 'Current', expires: '2026-11-02' },
  { id: 'd3', name: 'Registration Papers — Copper Canyon', type: 'Registration', horse: 'THR Copper Canyon', transaction: 'Cedar Hollow Equine', status: 'Current', expires: null },
  { id: 'd4', name: 'Bill of Sale — Juniper Ledge', type: 'Bill of Sale', horse: 'THR Juniper Ledge', transaction: 'J. Castellano', status: 'Review', expires: null },
  { id: 'd5', name: 'Coggins (negative) — Stone Mesa', type: 'Coggins', horse: 'THR Stone Mesa', transaction: '—', status: 'Expiring', expires: '2026-07-08' },
  { id: 'd6', name: 'Sale Photos — Copper Canyon', type: 'Photos', horse: 'THR Copper Canyon', transaction: 'Cedar Hollow Equine', status: 'Current', expires: null },
  { id: 'd7', name: 'Purchase Contract — Copper Canyon', type: 'Contracts', horse: 'THR Copper Canyon', transaction: 'Cedar Hollow Equine', status: 'Current', expires: null },
  { id: 'd8', name: 'Foal Registration — Stone Mesa', type: 'Registration', horse: 'THR Stone Mesa', transaction: '—', status: 'Expiring', expires: '2026-07-19' },
];

export const documentFilters = ['All', 'Health Cert', 'Coggins', 'Registration', 'Bill of Sale', 'Photos', 'Contracts'] as const;

export const subscriptionPlanCards = [
  { name: 'Starter', price: '$29', cadence: '/mo', summary: 'Basic horses and records.', features: ['Horse records & care log', 'Document storage with OCR intake', '1 team seat'], featured: false },
  { name: 'Professional', price: '$79', cadence: '/mo', summary: 'Sale packet tools.', features: ['Everything in Starter', 'Watermarked sale packets', 'Published sale listings', '5 team seats'], featured: false },
  { name: 'Ranch Ops', price: '$199', cadence: '/mo', summary: 'Buyer deal rooms & operational workflows.', features: ['Everything in Professional', 'Buyer deal rooms', 'Team roles & breeding program', '20 team seats'], featured: true },
  { name: 'Enterprise', price: '$499', cadence: '/mo', summary: 'Multi-ranch, advanced reporting, team controls.', features: ['Everything in Ranch Ops', 'Multi-ranch & advanced reporting', 'Team controls', '60 team seats'], featured: false },
  { name: 'Sovereign', price: 'Custom', cadence: '', summary: 'Private setup, custom workflows, white-glove infrastructure.', features: ['Private setup', 'Custom workflows', 'White-glove infrastructure'], featured: false },
];

export const operationalTasks = ['Resolve release blocker', 'Prepare sale packet', 'Review buyer access'];
