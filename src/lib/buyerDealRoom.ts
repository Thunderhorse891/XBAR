import type { BuyerRoomEvent, DealStatus, HorseRecord, SalesLead } from '@/types/xbar';

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
  highestOffer: number;
  latestActivityAt?: string;
  status: DealStatus | 'quiet';
  action: BuyerDealRoomAction;
};

const eventWeight: Record<BuyerRoomEvent['kind'], number> = {
  'packet-shared': 1,
  'packet-viewed': 2,
  question: 4,
  'call-requested': 5,
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
  if (target.kind !== 'question' && target.kind !== 'call-requested') return true;
  return events.some((event) => event.horseId === target.horseId && event.kind === 'seller-response' && timeValue(event.at) >= timeValue(target.at));
}

export function openBuyerQuestions(events: BuyerRoomEvent[]) {
  return sortBuyerRoomEvents(events).filter((event) => (event.kind === 'question' || event.kind === 'call-requested') && !hasSellerResponse(events, event));
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

function buildDealRoomAction(params: { openQuestions: number; highestOffer: number; latestStatus: DealStatus | 'quiet'; lead?: SalesLead }): BuyerDealRoomAction {
  if (params.latestStatus === 'closed-won') return { label: 'Closed won', tone: 'emerald', reason: 'Buyer room has a won deal status.' };
  if (params.latestStatus === 'closed-lost') return { label: 'Closed lost', tone: 'slate', reason: 'Buyer room has a lost deal status.' };
  if (params.openQuestions > 0) return { label: 'Answer buyer', tone: 'amber', reason: `${params.openQuestions} buyer question or call request needs a seller response.` };
  if (params.highestOffer > 0) return { label: 'Work offer', tone: 'blue', reason: `Highest open offer is $${params.highestOffer.toLocaleString()}.` };
  if (params.lead?.nextFollowUp) return { label: 'Follow up', tone: 'blue', reason: 'Lead has a scheduled next follow-up.' };
  return { label: 'Create movement', tone: 'slate', reason: 'No active buyer-room pressure yet.' };
}

export function buildBuyerDealRoomSummaries(params: { horses: HorseRecord[]; leads: SalesLead[]; events: BuyerRoomEvent[] }) {
  return params.horses
    .filter((horse) => horse.sale.askPrice > 0 || params.leads.some((lead) => lead.horseId === horse.id) || params.events.some((event) => event.horseId === horse.id))
    .map((horse): BuyerDealRoomHorseSummary => {
      const horseEvents = params.events.filter((event) => event.horseId === horse.id);
      const horseLeads = params.leads.filter((lead) => lead.horseId === horse.id && lead.stage !== 'Closed');
      const openQuestions = openBuyerQuestions(horseEvents).length;
      const highestOffer = Math.max(highestBuyerOffer(horseEvents), ...horseLeads.map((lead) => lead.offerAmount ?? 0));
      const latestStatus = latestDealStatus(horseEvents);
      return {
        horseId: horse.id,
        horseName: horse.name,
        askPrice: horse.sale.askPrice || horse.insuredValue,
        eventCount: horseEvents.length,
        openQuestions,
        offers: horseEvents.filter((event) => event.kind === 'offer').length + horseLeads.filter((lead) => (lead.offerAmount ?? 0) > 0).length,
        highestOffer,
        latestActivityAt: sortBuyerRoomEvents(horseEvents)[0]?.at ?? horseLeads.map((lead) => lead.lastTouch).sort().at(-1),
        status: latestStatus,
        action: buildDealRoomAction({ openQuestions, highestOffer, latestStatus, lead: horseLeads[0] }),
      };
    })
    .sort((a, b) => {
      const priority = (item: BuyerDealRoomHorseSummary) =>
        item.openQuestions * 100 +
        item.highestOffer / 1000 +
        (item.status === 'offer' ? 25 : 0) +
        (item.status === 'open' ? 5 : 0);
      return priority(b) - priority(a) || timeValue(b.latestActivityAt) - timeValue(a.latestActivityAt);
    });
}
