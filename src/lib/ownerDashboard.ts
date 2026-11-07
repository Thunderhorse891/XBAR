import { buildApiUrl } from './backendApi';

export class OwnerRequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function ownerRequest<T>(action: string, token: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(buildApiUrl(`/api/account/${action}`), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    credentials: 'omit',
    signal,
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) {
    throw new OwnerRequestError(response.status, body.message || 'The owner service is unavailable.');
  }
  return body as T;
}

export type OwnerSubscription = {
  id: string;
  customerId: string;
  name: string | null;
  email: string | null;
  status: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: number | null;
  trialEnd: number | null;
  collectionPaused: boolean;
  createdAt: number | null;
  morePrices: boolean;
  prices: {
    id: string | null;
    amount: number | null;
    currency: string | null;
    interval: string | null;
    intervalCount: number;
    quantity: number | null;
    periodEnd: number | null;
  }[];
  workspaces: {
    id: string;
    name: string | null;
    tier: string | null;
    billingState: string | null;
    syncedAt: string | null;
  }[];
  subscriptionUrl: string;
  customerUrl: string | null;
};

export type OwnerDashboardData = {
  ok: true;
  fetchedAt: string;
  mode: 'live' | 'test';
  subscriptions: OwnerSubscription[];
  nextCursor: string | null;
  billingUrl: string;
  paymentsUrl: string;
  readiness: {
    ok: boolean;
    warnings?: string[];
    reasons?: string[];
    subsystems: { email: boolean; remindersCron: boolean };
    checks: { billingReady: boolean };
  };
};

export function priceLabel(price: OwnerSubscription['prices'][number]) {
  if (price.amount === null || !price.currency || !price.interval) return 'See price in Stripe';
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency: price.currency });
    const divisor = 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2);
    return `${formatter.format(price.amount / divisor)} / ${price.intervalCount > 1 ? `${price.intervalCount} ` : ''}${price.interval}${price.intervalCount > 1 ? 's' : ''}`;
  } catch {
    return 'See price in Stripe';
  }
}
