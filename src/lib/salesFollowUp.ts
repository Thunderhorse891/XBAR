import type { SalesLead } from '../types/xbar.js';

export type FollowUpTiming = 'Overdue' | 'Today' | 'Upcoming' | 'Unscheduled';

const dayMs = 24 * 60 * 60 * 1000;

function dateStamp(date: Date) { return date.toISOString().slice(0, 10); }
function startOfDay(date: Date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

export function followUpTiming(lead: SalesLead, now = new Date()): FollowUpTiming {
  if (!lead.nextFollowUp) return 'Unscheduled';
  const due = new Date(`${lead.nextFollowUp}T12:00:00`);
  const offset = Math.round((startOfDay(due).getTime() - startOfDay(now).getTime()) / dayMs);
  if (offset < 0) return 'Overdue';
  if (offset === 0) return 'Today';
  return 'Upcoming';
}

export function scheduleNextFollowUp(lead: SalesLead, days: number, now = new Date()) {
  const next = new Date(startOfDay(now).getTime() + days * dayMs);
  return { lastTouch: dateStamp(now), nextFollowUp: dateStamp(next), notes: lead.notes };
}

export function completeFollowUp(lead: SalesLead, now = new Date()) {
  const cadence = lead.stage === 'Offer' ? 2 : lead.stage === 'Qualified' ? 4 : 7;
  return scheduleNextFollowUp(lead, cadence, now);
}

export function sortFollowUps(leads: SalesLead[], now = new Date()) {
  const rank: Record<FollowUpTiming, number> = { Overdue: 0, Today: 1, Unscheduled: 2, Upcoming: 3 };
  return leads.filter((lead) => lead.stage !== 'Closed').sort((left, right) => rank[followUpTiming(left, now)] - rank[followUpTiming(right, now)] || Date.parse(left.nextFollowUp || '9999-12-31') - Date.parse(right.nextFollowUp || '9999-12-31'));
}
