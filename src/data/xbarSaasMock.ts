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
  { label: 'Share With Buyer', state: 'Clear', detail: 'Watermarked proof verified across active records.' },
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
  steps: ['Packet prepared', 'Buyer invited', 'Buyer folder opened', 'Offer received', 'Release ready'],
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
    { label: 'Buyer viewed folder', time: 'Yesterday' },
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
  { id: 'packet', title: 'Create sale packet', detail: 'Assemble a buyer-ready packet in the builder.', done: false, action: 'Open Builder', to: '/sale-packet-studio' },
  { id: 'buyer', title: 'Invite buyer', detail: 'Send a secure invitation to a prospective buyer.', done: false, action: 'Invite', to: '/buyer-deal-room' },
  { id: 'room', title: 'Open Buyer Folder', detail: 'A private folder you can share with a buyer before the sale.', done: false, action: 'Open', to: '/buyer-deal-room' },
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
  { name: 'Ranch Ops', price: '$199', cadence: '/mo', summary: 'Buyer folders and ranch workflows.', features: ['Everything in Professional', 'Buyer folders', 'Team roles & breeding program', '20 team seats'], featured: true },
  { name: 'Enterprise', price: '$499', cadence: '/mo', summary: 'Multi-ranch, advanced reporting, team controls.', features: ['Everything in Ranch Ops', 'Multi-ranch & advanced reporting', 'Team controls', '60 team seats'], featured: false },
  { name: 'Sovereign', price: 'Custom', cadence: '', summary: 'Private setup, custom workflows, white-glove infrastructure.', features: ['Private setup', 'Custom workflows', 'White-glove infrastructure'], featured: false },
];

export const operationalTasks = ['Resolve release blocker', 'Prepare sale packet', 'Review buyer access'];

/* ===========================================================================
   Command Center — operational ranch data
   =========================================================================== */

/** Blocker resolutions performed in-session (home Resolve Blocker wizard →
 *  Sale Packet Builder). Keyed by animal id; lets the builder see a cleared
 *  health-certificate blocker instead of re-deriving it from static mock. */
export const resolvedBlockers = new Set<string>();

export const ranchSeason = { label: 'Sale Season', tone: 'brass' as ChipTone };
export const ranchWeather = { tempF: 88, label: 'Hot · dry', risk: 'Heat watch', tone: 'warning' as ChipTone };

export const commandMetrics = {
  tasksDueToday: 12,
  overdueTasks: 3,
  animalsNeedAttention: 4,
  medicalHolds: 1,
  revenueBlocked: 35000,
  activeBuyers: 2,
  documentsExpiring: 15,
  healthCerts: 7,
  coggins: 5,
  foalRegs: 3,
  activeSaleProspects: 8,
  buyerDealRooms: 4,
};

export type TaskPriority = 'Revenue Blocker' | 'High' | 'Medium' | 'Normal' | 'Planned';
export type WorkTask = {
  id: string;
  title: string;
  linkedType: 'Animal' | 'Pasture' | 'Document' | 'Sale Packet' | 'Herd Group' | 'Equipment';
  linkedName: string;
  priority: TaskPriority;
  assignee: string;
  due: string;
  status: 'Open' | 'Review' | 'Blocking Release' | 'Planned';
  category: 'Animal Care' | 'Pasture' | 'Feed' | 'Documents' | 'Sales' | 'Equipment';
  overdue?: boolean;
};

export const todayTasks: WorkTask[] = [
  { id: 't1', title: 'Add missing health certificate expiration date', linkedType: 'Sale Packet', linkedName: 'RHA Pine Barrel Prospect', priority: 'Revenue Blocker', assignee: 'Erin W.', due: 'Now', status: 'Blocking Release', category: 'Sales', overdue: true },
  { id: 't2', title: 'Check north pasture water trough', linkedType: 'Pasture', linkedName: 'North Pasture', priority: 'High', assignee: 'Cody R.', due: 'Today', status: 'Open', category: 'Pasture' },
  { id: 't3', title: 'Give evening medication', linkedType: 'Animal', linkedName: 'RHA Pine Barrel Prospect', priority: 'High', assignee: 'Erin W.', due: '6:00 PM', status: 'Open', category: 'Animal Care' },
  { id: 't4', title: 'Upload new Coggins document', linkedType: 'Document', linkedName: 'THR Stone Mesa', priority: 'Medium', assignee: 'Erin W.', due: 'Today', status: 'Review', category: 'Documents' },
  { id: 't5', title: 'Repair south gate latch', linkedType: 'Equipment', linkedName: 'South Trap Gate', priority: 'High', assignee: 'Cody R.', due: 'Today', status: 'Open', category: 'Equipment', overdue: true },
  { id: 't6', title: 'Move mares to South Trap', linkedType: 'Herd Group', linkedName: 'Mares', priority: 'Normal', assignee: 'Cody R.', due: 'Tomorrow', status: 'Planned', category: 'Pasture' },
  { id: 't7', title: 'Log morning hay feeding', linkedType: 'Herd Group', linkedName: 'Sale Prospects', priority: 'Normal', assignee: 'Cody R.', due: 'Today', status: 'Open', category: 'Feed' },
  { id: 't8', title: 'Preg check — Copper Belle', linkedType: 'Animal', linkedName: 'Copper Belle', priority: 'Medium', assignee: 'Dr. Hale', due: 'Today', status: 'Open', category: 'Animal Care', overdue: true },
];

export const workboardTabs = ['All', 'Overdue', 'Animal Care', 'Pasture', 'Feed', 'Documents', 'Sales', 'Equipment'] as const;

export type HerdGroup = {
  id: string;
  name: string;
  count: number;
  location: string;
  openTasks: number;
  nextEvent: string;
  smart?: boolean;
};

export const herdGroups: HerdGroup[] = [
  { id: 'mares', name: 'Mares', count: 14, location: 'North Pasture', openTasks: 3, nextEvent: 'Move to South Trap' },
  { id: 'studs', name: 'Studs', count: 3, location: 'Stud Pen', openTasks: 1, nextEvent: 'Breeding record review' },
  { id: 'foals', name: 'Foals', count: 5, location: 'Foaling Pen', openTasks: 2, nextEvent: '3 need registration' },
  { id: 'sale', name: 'Sale Prospects', count: 8, location: 'Main Barn', openTasks: 4, nextEvent: '1 release blocked' },
  { id: 'medical', name: 'Medical Hold', count: 1, location: 'Quarantine Pen', openTasks: 2, nextEvent: 'Withdrawal active', smart: true },
  { id: 'docs30', name: 'Docs expiring · 30d', count: 6, location: 'Mixed', openTasks: 6, nextEvent: 'Renew certs & Coggins', smart: true },
];

export type Pasture = {
  id: string;
  name: string;
  animals: number;
  openTasks: number;
  water: 'OK' | 'Check' | 'Issue';
  fence: 'OK' | 'Check' | 'Issue';
  grazing: 'Good' | 'Moderate' | 'Heavy';
  rainfall: string;
};

export const pastures: Pasture[] = [
  { id: 'north', name: 'North Pasture', animals: 14, openTasks: 2, water: 'Check', fence: 'OK', grazing: 'Moderate', rainfall: '0.0" / 7d' },
  { id: 'south', name: 'South Pasture', animals: 9, openTasks: 1, water: 'OK', fence: 'Issue', grazing: 'Good', rainfall: '0.2" / 7d' },
  { id: 'main', name: 'Main Barn', animals: 8, openTasks: 3, water: 'OK', fence: 'OK', grazing: 'Heavy', rainfall: '—' },
  { id: 'foaling', name: 'Foaling Pen', animals: 5, openTasks: 1, water: 'OK', fence: 'OK', grazing: 'Good', rainfall: '—' },
];

export const healthCompliance = {
  overdue: 3,
  expiringDocs: 15,
  medicalHolds: 1,
  upcoming: 6,
  missingRecords: 2,
  items: [
    { label: 'Coggins expired — Stone Mesa', tone: 'danger' as ChipTone, detail: 'Re-test before release' },
    { label: 'Health cert expiration missing — Pine Barrel', tone: 'danger' as ChipTone, detail: 'Blocks $35k sale' },
    { label: 'Vaccines due — Mares (4)', tone: 'warning' as ChipTone, detail: 'Spring booster' },
    { label: 'Farrier due — Sale Prospects (3)', tone: 'warning' as ChipTone, detail: 'Trim cycle' },
  ],
};

export const feedInventory = {
  feedCostMonth: 4820,
  lowStock: [
    { name: 'Coastal hay', level: 'Low', detail: '6 days left', tone: 'danger' as ChipTone },
    { name: 'Alfalfa cubes', level: 'Reorder', detail: '12 days left', tone: 'warning' as ChipTone },
    { name: 'Mineral supplement', level: 'OK', detail: '5 weeks left', tone: 'success' as ChipTone },
  ],
  nextReorder: 'Coastal hay — Thu',
  costPerAnimalDay: 4.1,
};

export const equipment = {
  serviceDue: 2,
  broken: 1,
  workOrders: 3,
  items: [
    { name: 'Stock trailer (24ft)', status: 'Service due', detail: 'Bearings · 400 mi over', tone: 'warning' as ChipTone },
    { name: 'South Trap gate', status: 'Broken', detail: 'Latch failed', tone: 'danger' as ChipTone },
    { name: 'Ranch UTV', status: 'OK', detail: 'Serviced last week', tone: 'success' as ChipTone },
  ],
};

export const financialSnapshot = {
  monthExpenses: 11240,
  feedCost: 4820,
  healthCost: 2360,
  openSaleValue: 84000,
  projectedMargin: 38,
  rows: [
    { label: 'Feed', value: 4820 },
    { label: 'Vet & health', value: 2360 },
    { label: 'Farrier', value: 640 },
    { label: 'Labor', value: 2100 },
    { label: 'Equipment', value: 1320 },
  ],
};

export const nextBestAction = {
  title: 'Clear release blocker for RHA Pine Barrel Prospect',
  reason: 'A $35,000 sale target is blocked by a missing health certificate expiration date.',
  to: '/sale-packet-studio',
};

export const commandRisk = [
  '15 documents expire soon',
  '3 animals have overdue care',
  '1 pasture issue open (South fence)',
];

export const commandRevenue = [
  '$35,000 target sale blocked',
  '2 active buyers',
  '1 offer below target',
];

export const commandActivity = [
  { label: 'Buyer downloaded packet', time: '12m ago' },
  { label: 'Coggins uploaded — Stone Mesa', time: '1h ago' },
  { label: 'Task completed — AM feeding', time: '2h ago' },
  { label: 'Horse moved to Quarantine', time: '4h ago' },
  { label: 'Offer recorded — $20,000', time: 'Yesterday' },
];

/* ===========================================================================
   Extended object data — roster, pipeline, health, ownership, equipment, breeding
   =========================================================================== */


export const pipelineStages: { id: string; label: string; deals: { id: string; horse: string; price: number; offer: number | null; tone: ChipTone; note: string }[] }[] = [
  { id: 'prospect', label: 'Prospect', deals: [{ id: 'p1', horse: 'Copper Belle', price: 18000, offer: null, tone: 'neutral', note: 'Evaluating' }] },
  { id: 'packet', label: 'Packet Ready', deals: [{ id: 'p2', horse: 'THR Juniper Ledge', price: 22000, offer: null, tone: 'warning', note: 'Bill of sale unsigned' }] },
  { id: 'invited', label: 'Buyer Invited', deals: [{ id: 'p3', horse: 'High Plains — Copper Canyon', price: 30000, offer: null, tone: 'info', note: '3 buyer views' }] },
  { id: 'room', label: 'Buyer Folder', deals: [{ id: 'p4', horse: 'THR Copper Canyon', price: 30000, offer: 28000, tone: 'success', note: 'Release ready' }] },
  { id: 'offer', label: 'Offer / Blocked', deals: [{ id: 'p5', horse: 'RHA Pine Barrel Prospect', price: 35000, offer: 20000, tone: 'danger', note: 'Release blocked' }] },
  { id: 'release', label: 'Release Ready', deals: [] },
  { id: 'closed', label: 'Closed', deals: [{ id: 'p6', horse: 'THR Willow Creek', price: 16500, offer: 16500, tone: 'success', note: 'Sold · Apr' }] },
];

export const healthRecords = [
  { id: 'h1', animal: 'RHA Pine Barrel Prospect', type: 'Health certificate', date: '—', status: 'Blocker', tone: 'danger' as ChipTone, detail: 'Expiration date missing' },
  { id: 'h2', animal: 'THR Stone Mesa', type: 'Coggins', date: '2026-07-08', status: 'Expiring', tone: 'warning' as ChipTone, detail: 'Re-test before release' },
  { id: 'h3', animal: 'Mares (4)', type: 'Vaccines', date: 'Due', status: 'Due', tone: 'warning' as ChipTone, detail: 'Spring booster' },
  { id: 'h4', animal: 'Sale Prospects (3)', type: 'Farrier', date: 'Due', status: 'Due', tone: 'warning' as ChipTone, detail: 'Trim cycle' },
  { id: 'h5', animal: 'THR Copper Canyon', type: 'Dental', date: '2026-05-20', status: 'Current', tone: 'success' as ChipTone, detail: 'Float complete' },
  { id: 'h6', animal: 'Copper Belle', type: 'Vet visit', date: '2026-06-22', status: 'Current', tone: 'success' as ChipTone, detail: 'Preg check scheduled' },
];

export const ownershipChain = [
  { id: 'o1', animalId: 'rha-pine-barrel-prospect', animal: 'RHA Pine Barrel Prospect', owner: 'Thunder Horse Ranch', proof: 'Registration + 2 transfers', status: 'Clear', tone: 'success' as ChipTone },
  { id: 'o2', animalId: 'thr-copper-canyon', animal: 'THR Copper Canyon', owner: 'Thunder Horse Ranch', proof: 'Registration + bill of sale', status: 'Clear', tone: 'success' as ChipTone },
  { id: 'o3', animalId: 'thr-juniper-ledge', animal: 'THR Juniper Ledge', owner: 'Thunder Horse Ranch', proof: 'Bill of sale unsigned', status: 'Review', tone: 'warning' as ChipTone },
  { id: 'o4', animalId: 'thr-stone-mesa', animal: 'THR Stone Mesa', owner: 'Pending transfer', proof: 'Prior owner release missing', status: 'Gap Detected', tone: 'danger' as ChipTone },
];

export const equipmentList = [
  { id: 'e1', name: 'Stock trailer (24ft)', type: 'Trailer', location: 'Equipment Yard', status: 'Service due', tone: 'warning' as ChipTone, detail: 'Bearings · 400 mi over' },
  { id: 'e2', name: 'South Trap gate', type: 'Gate', location: 'South Pasture', status: 'Broken', tone: 'danger' as ChipTone, detail: 'Latch failed' },
  { id: 'e3', name: 'Ranch UTV', type: 'UTV', location: 'Main Barn', status: 'OK', tone: 'success' as ChipTone, detail: 'Serviced last week' },
  { id: 'e4', name: 'Kubota tractor', type: 'Tractor', location: 'Equipment Yard', status: 'OK', tone: 'success' as ChipTone, detail: 'Next service Aug' },
  { id: 'e5', name: 'Water trough — North', type: 'Water trough', location: 'North Pasture', status: 'Check', tone: 'warning' as ChipTone, detail: 'Float sticking' },
];

export const breedingRecords = [
  { id: 'b1', mare: 'Copper Belle', stud: 'Rojo', method: 'Live cover', stage: 'Preg check due', due: '2027-04-12', tone: 'warning' as ChipTone },
  { id: 'b2', mare: 'THR Juniper Ledge', stud: 'External AI', method: 'AI', stage: 'Open', due: '—', tone: 'neutral' as ChipTone },
  { id: 'b3', mare: 'Sage', stud: 'Rojo', method: 'Live cover', stage: 'Confirmed in foal', due: '2027-03-02', tone: 'success' as ChipTone },
];

export const expenseRows = [
  { id: 'x1', date: '2026-06-22', desc: 'Coastal hay — 60 bales', category: 'Feed', animal: 'Ranch-wide', amount: 1080 },
  { id: 'x2', date: '2026-06-20', desc: 'Vet — preg check', category: 'Vet & health', animal: 'Copper Belle', amount: 240 },
  { id: 'x3', date: '2026-06-18', desc: 'Farrier — trim cycle', category: 'Farrier', animal: 'Sale Prospects', amount: 360 },
  { id: 'x4', date: '2026-06-15', desc: 'Trailer bearings', category: 'Equipment', animal: 'Stock trailer', amount: 420 },
  { id: 'x5', date: '2026-06-12', desc: 'Coggins lab fees', category: 'Vet & health', animal: 'THR Stone Mesa', amount: 95 },
];
