import type { BuyerRoomEvent, DealStatus, HorseRecord, SalesLead } from '../types/xbar.js';

export type BuyerDealRoomAction = {
  label: string;
  tone: 'blue' | 'amber' | 'rose' | 'emerald' | 'slate';
  reason: string;
};

export type BuyerDealRoomHorseSummary = {
  horseId: string;
  horseName: string;
  askPrice: number;
  eventCount: number;
  openQuestions: number;
  offers: number;
  packetDownloads: number;
  highestOffer: number;
  latestActivityAt?: string;
  status: DealStatus | 'quiet';
  action: BuyerDealRoomAction;
};

export type PublicShareEventRow = {
  id?: string;
  listing_id?: string;
  horse_id?: string;
  event_type?: string;
  metadata?: unknown;
  viewed_at?: string;
  created_at?: string;
};

const eventWeight: Record<BuyerRoomEvent['kind'], number> = {
  'packet-shared': 1,
  'packet-viewed': 2,
  'packet-downloaded': 3,
  question: 4,
  'call-requested': 5,
  'proof-requested': 6,
  offer: 8,
  'seller-response': 1,
  'deal-status': 3,
};

function timeValue(value?: string) {
  return value ? new Date(value).getTime() || 0 : 0;
}

export function sortBuyerRoomEvents(events: BuyerRoomEvent[]) {
  return [...events].sort((a, b) => timeValue(b.at) - timeValue(a.at) || eventWeight[b.kind] - eventWeight[a.kind]);
}

export function hasSellerResponse(events: BuyerRoomEvent[], target: BuyerRoomEvent) {
  if (target.kind !== 'question' && target.kind !== 'call-requested' && target.kind !== 'proof-requested') return true;
  return events.some(
    (event) =>
      event.horseId === target.horseId &&
      event.kind === 'seller-response' &&
      (event.replyToEventId ? event.replyToEventId === target.id : timeValue(event.at) >= timeValue(target.at)),
  );
}

export function openBuyerRequests(events: BuyerRoomEvent[]) {
  return sortBuyerRoomEvents(events).filter(
    (event) =>
      (event.kind === 'question' || event.kind === 'call-requested' || event.kind === 'proof-requested') &&
      !hasSellerResponse(events, event),
  );
}

export function openBuyerQuestions(events: BuyerRoomEvent[]) {
  return openBuyerRequests(events);
}

export function highestBuyerOffer(events: BuyerRoomEvent[]) {
  return events
    .filter((event) => event.kind === 'offer' && typeof event.amount === 'number')
    .reduce((highest, event) => Math.max(highest, event.amount ?? 0), 0);
}

export function latestDealStatus(events: BuyerRoomEvent[]): DealStatus | 'quiet' {
  const statusEvent = sortBuyerRoomEvents(events).find((event) => event.dealStatus);
  if (statusEvent?.dealStatus) return statusEvent.dealStatus;
  if (events.some((event) => event.kind === 'offer')) return 'offer';
  if (events.length) return 'open';
  return 'quiet';
}

function buildDealRoomAction(params: { openQuestions: number; highestOffer: number; packetDownloads: number; latestStatus: DealStatus | 'quiet'; lead?: SalesLead }): BuyerDealRoomAction {
  if (params.latestStatus === 'closed-won') return { label: 'Closed won', tone: 'emerald', reason: 'Buyer follow-up has a won deal status.' };
  if (params.latestStatus === 'closed-lost') return { label: 'Closed lost', tone: 'slate', reason: 'Buyer follow-up has a lost deal status.' };
  if (params.openQuestions > 0) return { label: 'Answer buyer', tone: 'amber', reason: `${params.openQuestions} buyer request needs a seller response.` };
  if (params.highestOffer > 0) return { label: 'Work offer', tone: 'blue', reason: `Highest open offer is $${params.highestOffer.toLocaleString()}.` };
  if (params.packetDownloads > 0) return { label: 'Follow up', tone: 'blue', reason: `${params.packetDownloads} buyer packet download${params.packetDownloads === 1 ? '' : 's'} signal active review.` };
  if (params.lead?.nextFollowUp) return { label: 'Follow up', tone: 'blue', reason: 'Lead has a scheduled next follow-up.' };
  return { label: 'Create movement', tone: 'slate', reason: 'No active buyer follow-up pressure yet.' };
}

export function buildBuyerDealRoomSummaries(params: { horses: HorseRecord[]; leads: SalesLead[]; events: BuyerRoomEvent[] }) {
  return params.horses
    .filter((horse) => horse.sale.askPrice > 0 || params.leads.some((lead) => lead.horseId === horse.id) || params.events.some((event) => event.horseId === horse.id))
    .map((horse): BuyerDealRoomHorseSummary => {
      const horseEvents = params.events.filter((event) => event.horseId === horse.id);
      const horseLeads = params.leads.filter((lead) => lead.horseId === horse.id && lead.stage !== 'Closed');
      const openQuestions = openBuyerRequests(horseEvents).length;
      const highestOffer = Math.max(highestBuyerOffer(horseEvents), ...horseLeads.map((lead) => lead.offerAmount ?? 0));
      const packetDownloads = horseEvents.filter((event) => event.kind === 'packet-downloaded').length;
      const latestStatus = latestDealStatus(horseEvents);
      return {
        horseId: horse.id,
        horseName: horse.name,
        askPrice: horse.sale.askPrice || horse.insuredValue,
        eventCount: horseEvents.length,
        openQuestions,
        offers: horseEvents.filter((event) => event.kind === 'offer').length + horseLeads.filter((lead) => (lead.offerAmount ?? 0) > 0).length,
        packetDownloads,
        highestOffer,
        latestActivityAt: sortBuyerRoomEvents(horseEvents)[0]?.at ?? horseLeads.map((lead) => lead.lastTouch).sort().at(-1),
        status: latestStatus,
        action: buildDealRoomAction({ openQuestions, highestOffer, packetDownloads, latestStatus, lead: horseLeads[0] }),
      };
    })
    .sort((a, b) => {
      const priority = (item: BuyerDealRoomHorseSummary) =>
        item.openQuestions * 100 +
        item.highestOffer / 1000 +
        item.packetDownloads * 10 +
        (item.status === 'offer' ? 25 : 0) +
        (item.status === 'open' ? 5 : 0);
      return priority(b) - priority(a) || timeValue(b.latestActivityAt) - timeValue(a.latestActivityAt);
    });
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function publicShareEventToBuyerRoomEvent(row: PublicShareEventRow): BuyerRoomEvent | null {
  const eventKind: Record<string, BuyerRoomEvent['kind']> = {
    view: 'packet-viewed',
    'buyer-question': 'question',
    'buyer-call-requested': 'call-requested',
    'buyer-proof-requested': 'proof-requested',
    'buyer-offer': 'offer',
    'buyer-packet-downloaded': 'packet-downloaded',
    'seller-response': 'seller-response',
  };
  const kind = eventKind[row.event_type ?? ''];
  if (!kind || !row.id || !row.horse_id) return null;

  const metadata = asRecord(row.metadata);
  const buyerName = typeof metadata.buyerName === 'string' ? metadata.buyerName.trim() : '';
  const buyerEmail = typeof metadata.buyerEmail === 'string' ? metadata.buyerEmail.trim() : '';
  const message = typeof metadata.message === 'string' ? metadata.message.trim() : '';
  const responseNote = typeof metadata.note === 'string' ? metadata.note.trim() : '';
  const responseActor = typeof metadata.actor === 'string' ? metadata.actor.trim() : '';
  const replyToEventId = typeof metadata.replyToEventId === 'string' ? metadata.replyToEventId.trim() : '';
  const amount = Number(metadata.amount);
  const note = [
    message,
    responseNote,
    buyerEmail ? `Contact: ${buyerEmail}` : '',
    kind === 'packet-viewed' ? 'Opened the shared buyer profile.' : '',
    kind === 'packet-downloaded' ? 'Downloaded the buyer packet.' : '',
  ].filter(Boolean).join(' — ');

  return {
    id: `public-share-${row.id}`,
    horseId: row.horse_id,
    packetId: row.listing_id || undefined,
    kind,
    at: row.viewed_at || row.created_at || new Date().toISOString(),
    actor: responseActor || buyerName || buyerEmail || 'Buyer visitor',
    note: note || undefined,
    amount: Number.isFinite(amount) && amount > 0 ? amount : undefined,
    replyToEventId: replyToEventId || undefined,
  };
}
