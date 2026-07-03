export const buyersPath = '/buyers';
export const legacyBuyerDealRoomPath = '/buyer-deal-room';

export function buyerFollowUpPath(leadId?: string) {
  return leadId ? `${buyersPath}/${encodeURIComponent(leadId)}` : buyersPath;
}
