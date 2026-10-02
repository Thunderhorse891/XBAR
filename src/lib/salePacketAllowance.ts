/*
 * The client's view of the sale packet allowance (audit F11): packets generated
 * in the last 30 days, the same window api/_lib/entitlements.js enforces. The
 * server's count is the one that decides; this one keeps the screen from
 * promising a packet the server will refuse, or refusing one it would allow.
 *
 * A packet whose date cannot be read is counted: an unknown date is not
 * evidence that the packet is old enough to stop counting.
 */
export const SALE_PACKET_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function salePacketsInWindow(builds: ReadonlyArray<{ createdAt?: string }>, now: Date = new Date()): number {
  const windowStart = now.getTime() - SALE_PACKET_WINDOW_DAYS * DAY_MS;
  return builds.filter((build) => {
    const created = Date.parse(build.createdAt ?? '');
    return Number.isNaN(created) || created >= windowStart;
  }).length;
}
