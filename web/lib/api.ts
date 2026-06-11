import { getTier, getToken } from './auth';
import * as mock from './mock-data';
import type {
  ActivityEntry,
  AppNotification,
  BarnBranding,
  BarnMember,
  CalendarEvent,
  DocumentType,
  HealthRecord,
  Horse,
  HorseDocument,
  Invoice,
  OcrResult,
  OwnershipRecord,
  SalePacket,
  Subscription,
  TimelineEntry,
} from './types';
import { TIER_PRICES, TIER_LABELS as tierLabels } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Authenticated fetch wrapper used when a real backend URL is configured.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(detail.message || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

// ----- Mock backend (default for development) ------------------------------
// Module-level state so mutations are visible across the app within a session.
const db = {
  horses: [...mock.horses],
  documents: [...mock.documents],
  events: [...mock.calendarEvents],
  packets: [...mock.salePackets],
  notifications: [...mock.notifications],
  members: [...mock.barnMembers],
  health: [...mock.healthRecords],
  branding: { ...mock.branding },
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = () => Math.random().toString(36).slice(2, 10);

export interface DocumentFilters {
  horseId?: string;
  type?: DocumentType | 'all';
  needsReview?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface OcrAssignment {
  documentId: string;
  horseName: string;
  action: 'create' | 'assign';
  horseId?: string;
}

export const api = {
  async listHorses(): Promise<Horse[]> {
    if (API_URL) return request('/api/horses');
    await wait(220);
    return [...db.horses];
  },

  async getHorse(id: string): Promise<Horse | null> {
    if (API_URL) return request(`/api/horses/${id}`);
    await wait(160);
    return db.horses.find((horse) => horse.id === id) ?? null;
  },

  async createHorse(input: Pick<Horse, 'name' | 'breed' | 'color' | 'sex' | 'birthdate' | 'registrationNumber'>): Promise<Horse> {
    if (API_URL) return request('/api/horses', { method: 'POST', body: JSON.stringify(input) });
    await wait(380);
    const horse: Horse = {
      id: `h-${uid()}`,
      registry: '',
      microchip: '',
      ownerName: 'Erin Wyrick',
      barnName: 'North Barn',
      status: 'active',
      missingDocuments: ['registration', 'coggins'],
      packetReady: false,
      ...input,
    };
    db.horses.unshift(horse);
    return horse;
  },

  async updateHorse(id: string, patch: Partial<Horse>): Promise<Horse> {
    if (API_URL) return request(`/api/horses/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    await wait(300);
    const horse = db.horses.find((entry) => entry.id === id);
    if (!horse) throw new Error('Horse not found');
    Object.assign(horse, patch);
    return { ...horse };
  },

  async listHealth(horseId: string): Promise<HealthRecord[]> {
    if (API_URL) return request(`/api/horses/${horseId}/health`);
    await wait(180);
    return db.health.filter((record) => record.horseId === horseId);
  },

  async addReminder(horseId: string, input: { kind: HealthRecord['kind']; label: string; nextDue: string }): Promise<HealthRecord> {
    if (API_URL) return request(`/api/horses/${horseId}/reminders`, { method: 'POST', body: JSON.stringify(input) });
    await wait(280);
    const record: HealthRecord = { id: `hr-${uid()}`, horseId, lastDate: '', administeredBy: '—', ...input };
    db.health.push(record);
    return record;
  },

  async listTimeline(horseId: string, page: number): Promise<{ entries: TimelineEntry[]; hasMore: boolean }> {
    if (API_URL) return request(`/api/horses/${horseId}/timeline?page=${page}`);
    await wait(320);
    const all = mock.timeline.filter((entry) => entry.horseId === horseId);
    const pageSize = 6;
    const entries = all.slice(page * pageSize, (page + 1) * pageSize);
    return { entries, hasMore: (page + 1) * pageSize < all.length };
  },

  async listOwnership(horseId: string): Promise<OwnershipRecord[]> {
    if (API_URL) return request(`/api/horses/${horseId}/ownership`);
    await wait(150);
    return mock.ownership.filter((record) => record.horseId === horseId);
  },

  async listDocuments(filters: DocumentFilters = {}): Promise<{ documents: HorseDocument[]; total: number }> {
    if (API_URL) return request(`/api/documents?${new URLSearchParams(filters as Record<string, string>)}`);
    await wait(240);
    let list = [...db.documents].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    if (filters.horseId) list = list.filter((doc) => doc.horseId === filters.horseId);
    if (filters.type && filters.type !== 'all') list = list.filter((doc) => doc.type === filters.type);
    if (filters.needsReview) list = list.filter((doc) => doc.needsReview);
    if (filters.search) {
      const query = filters.search.toLowerCase();
      list = list.filter((doc) => `${doc.title} ${doc.fileName} ${doc.horseName ?? ''}`.toLowerCase().includes(query));
    }
    const pageSize = filters.pageSize ?? 8;
    const page = filters.page ?? 0;
    return { documents: list.slice(page * pageSize, (page + 1) * pageSize), total: list.length };
  },

  // Simulated OCR pipeline: called once per accepted file after the progress
  // modal finishes its staged status updates.
  async runOcr(files: { name: string; size: number; type: string }[]): Promise<OcrResult[]> {
    if (API_URL) return request('/api/documents/bulk-upload-with-ocr', { method: 'POST', body: JSON.stringify({ files }) });
    await wait(500);
    return files.map((file, index) => {
      const lower = file.name.toLowerCase();
      const type: DocumentType = lower.includes('coggins') ? 'coggins' : lower.includes('transfer') ? 'transfer' : lower.includes('health') || lower.includes('cvi') ? 'health_cert' : 'registration';
      const confidence = [0.97, 0.86, 0.64][index % 3]!;
      const horse = db.horses[index % db.horses.length]!;
      const matched = confidence > 0.9;
      return {
        documentId: `ocr-${uid()}`,
        fileName: file.name,
        type,
        confidence,
        extracted: [
          { field: 'Horse name', value: matched ? horse.name : `${horse.name.slice(0, 4)}…(?)`, confidence },
          { field: 'Registration #', value: matched ? horse.registrationNumber : '', confidence: Math.max(0.4, confidence - 0.08) },
          { field: type === 'coggins' ? 'Test date' : 'Issue date', value: new Date().toISOString().slice(0, 10), confidence: Math.min(0.99, confidence + 0.02) },
        ],
        suggestedHorseId: matched ? horse.id : null,
        suggestedHorseName: matched ? horse.name : '',
      };
    });
  },

  async saveOcrAssignments(assignments: OcrAssignment[]): Promise<{ saved: number }> {
    if (API_URL) return request('/api/documents/bulk-upload-with-ocr', { method: 'POST', body: JSON.stringify({ mode: 'commit', assignments }) });
    await wait(600);
    for (const assignment of assignments) {
      const horse =
        assignment.action === 'assign'
          ? db.horses.find((entry) => entry.id === assignment.horseId)
          : undefined;
      const horseId = horse?.id ?? `h-${uid()}`;
      if (!horse && assignment.action === 'create') {
        db.horses.unshift({
          id: horseId,
          name: assignment.horseName,
          breed: '', color: '', sex: '', birthdate: '2018-01-01',
          registrationNumber: '', registry: '', microchip: '',
          ownerName: 'Erin Wyrick', barnName: 'North Barn', status: 'active',
          missingDocuments: [], packetReady: false,
        });
      }
      db.documents.unshift({
        id: assignment.documentId,
        horseId,
        horseName: horse?.name ?? assignment.horseName,
        title: `OCR intake — ${assignment.horseName}`,
        fileName: `${assignment.documentId}.pdf`,
        type: 'registration',
        mimeType: 'application/pdf',
        sizeBytes: 900_000,
        uploadedAt: new Date().toISOString(),
        uploadedBy: 'Erin Wyrick',
        confidence: 0.95,
        needsReview: false,
        verification: 'verified',
        extracted: { name: assignment.horseName },
      });
    }
    return { saved: assignments.length };
  },

  async listEvents(): Promise<CalendarEvent[]> {
    if (API_URL) return request('/api/calendar');
    await wait(200);
    return [...db.events];
  },

  async createEvent(input: Omit<CalendarEvent, 'id'>): Promise<CalendarEvent> {
    if (API_URL) return request('/api/calendar', { method: 'POST', body: JSON.stringify(input) });
    await wait(320);
    const event: CalendarEvent = { id: `e-${uid()}`, ...input };
    db.events.push(event);
    return event;
  },

  async listSalePackets(horseId?: string): Promise<SalePacket[]> {
    if (API_URL) return request(`/api/sale-packets${horseId ? `?horseId=${horseId}` : ''}`);
    await wait(180);
    return horseId ? db.packets.filter((packet) => packet.horseId === horseId) : [...db.packets];
  },

  async createSalePacket(input: {
    horseId: string;
    documentIds: string[];
    includeBillOfSale: boolean;
    buyerName: string;
    buyerEmail: string;
    salePrice: string;
    watermark: string;
  }): Promise<SalePacket> {
    if (API_URL) return request('/api/sale-packets', { method: 'POST', body: JSON.stringify(input) });
    await wait(1400);
    const horse = db.horses.find((entry) => entry.id === input.horseId);
    const packet: SalePacket = {
      id: `p-${uid()}`,
      horseId: input.horseId,
      horseName: horse?.name ?? 'Unknown',
      buyerName: input.buyerName,
      buyerEmail: input.buyerEmail,
      watermark: input.watermark,
      documentCount: input.documentIds.length + (input.includeBillOfSale ? 1 : 0),
      createdAt: new Date().toISOString(),
      downloadUrl: `#packet-${uid()}`,
      status: 'ready',
    };
    db.packets.unshift(packet);
    return packet;
  },

  async listNotifications(): Promise<AppNotification[]> {
    if (API_URL) return request('/api/notifications');
    await wait(150);
    return [...db.notifications];
  },

  async markNotificationsRead(): Promise<void> {
    if (API_URL) return request('/api/notifications/read', { method: 'POST' });
    db.notifications = db.notifications.map((entry) => ({ ...entry, read: true }));
  },

  async getSubscription(): Promise<Subscription> {
    if (API_URL) return request('/api/billing/subscription');
    await wait(170);
    const tier = getTier();
    return {
      tier,
      tierLabel: tierLabels[tier],
      monthlyPrice: TIER_PRICES[tier].monthly,
      billingInterval: 'monthly',
      nextBillingDate: mock.iso(22),
      trialEndsAt: tier === 'basic' ? mock.iso(2) : null,
      usage: {
        horses: { used: db.horses.length, limit: tier === 'basic' ? 5 : tier === 'pro' ? 25 : 200 },
        documents: { used: db.documents.length + 41, limit: tier === 'basic' ? 100 : tier === 'pro' ? 1000 : 10000 },
        seats: { used: db.members.filter((member) => member.status === 'active').length, limit: tier === 'basic' ? 1 : tier === 'pro' ? 5 : 25 },
      },
    };
  },

  async listInvoices(): Promise<Invoice[]> {
    if (API_URL) return request('/api/billing/invoices');
    await wait(190);
    return [...mock.invoices];
  },

  async listBarnMembers(): Promise<BarnMember[]> {
    if (API_URL) return request('/api/barn/members');
    await wait(180);
    return [...db.members];
  },

  async inviteBarnMember(input: { email: string; role: BarnMember['role'] }): Promise<BarnMember> {
    if (API_URL) return request('/api/barn/members', { method: 'POST', body: JSON.stringify(input) });
    await wait(420);
    const member: BarnMember = { id: `m-${uid()}`, name: input.email.split('@')[0]!, status: 'invited', lastActiveAt: null, ...input };
    db.members.push(member);
    return member;
  },

  async listActivity(): Promise<ActivityEntry[]> {
    if (API_URL) return request('/api/barn/activity');
    await wait(200);
    return [...mock.activityLog];
  },

  async getBranding(): Promise<BarnBranding> {
    if (API_URL) return request('/api/barn/branding');
    await wait(120);
    return { ...db.branding };
  },

  async updateBranding(patch: Partial<BarnBranding>): Promise<BarnBranding> {
    if (API_URL) return request('/api/barn/branding', { method: 'PATCH', body: JSON.stringify(patch) });
    await wait(260);
    Object.assign(db.branding, patch);
    return { ...db.branding };
  },
};
