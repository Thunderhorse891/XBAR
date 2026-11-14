import { apiConfig } from './platformConfig.js';
import type { SubscriptionTier } from '../types/xbar.js';
import { isPublicPaidPlan } from './publicPlanCatalog.js';

type CheckoutResult =
  | {
      ok: true;
      url: string;
    }
  | {
      ok: false;
      message: string;
      code?: string;
    };

/** Explicit missing-identity refusal, never permission for a static-link fallback. */
export const NO_MANAGED_IDENTITY = 'no_managed_identity';

/** Static links cannot verify the advertised price and are not new-sale routes. */
export function canUsePaymentLinkFallback(_code?: string): boolean {
  return false;
}

/** Retain the call contract for existing recovery code; all new sales are managed. */
export function checkoutRouteFor(_params: {
  managedBillingEnabled: boolean;
  paymentLink: string;
}): 'managed' | 'payment_link' {
  return 'managed';
}

function buildApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (apiConfig.baseUrl) {
    return `${apiConfig.baseUrl.replace(/\/$/, '')}${normalizedPath}`;
  }

  if (typeof window !== 'undefined') {
    return `${window.location.origin}${normalizedPath}`;
  }

  return normalizedPath;
}

export async function startManagedCheckout(params: {
  tier: SubscriptionTier;
  workspaceId: string;
  accessToken: string;
  billingPeriod?: 'monthly' | 'annual';
}): Promise<CheckoutResult> {
  if (!isPublicPaidPlan(params.tier) || params.billingPeriod === 'annual') {
    return {
      ok: false,
      code: 'plan_not_sellable',
      message: 'New paid subscriptions are Professional or Ranch Ops, billed monthly. Free needs no checkout.',
    };
  }
  if (!params.workspaceId || !params.accessToken) {
    return {
      ok: false,
      // A missing managed identity is a refusal, never a static-link fallback.
      code: NO_MANAGED_IDENTITY,
      message: 'Sign in to continue to secure checkout.',
    };
  }

  try {
    const response = await fetch(buildApiUrl('/api/stripe/checkout'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        tier: params.tier,
        workspaceId: params.workspaceId,
        billingPeriod: 'monthly',
        returnUrl: typeof window !== 'undefined' ? window.location.href : '',
      }),
    });

    const payload = (await response.json()) as { ok?: boolean; message?: string; url?: string; code?: string };
    if (!response.ok || !payload.ok || !payload.url) {
      return {
        ok: false,
        message: payload.message ?? 'Secure checkout is not ready yet.',
        // Carried through so the caller can tell a server refusal from a
        // transport failure. Flattening them together is what let a refused
        // checkout redirect to an unguarded payment link.
        code: payload.code,
      };
    }

    return {
      ok: true,
      url: payload.url,
    };
  } catch {
    return {
      ok: false,
      message: 'Secure checkout is not ready yet.',
    };
  }
}

/**
 * Which plan and cadence pairs the server can sell, keyed by tier.
 *
 * Read before a cadence is offered, so the billing screen never walks a buyer
 * to a checkout that refuses them. Every failure -- no response, a refusal, a
 * body of the wrong shape -- returns null, and null offers nothing beyond
 * monthly: guessing that annual works is the mistake this exists to stop.
 */
export type SellablePrices = {
  managed: boolean;
  monthly: Partial<Record<SubscriptionTier, boolean>>;
  annual: Partial<Record<SubscriptionTier, boolean>>;
};

function tierFlags(value: unknown): Partial<Record<SubscriptionTier, boolean>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const flags: Partial<Record<SubscriptionTier, boolean>> = {};
  for (const [tier, sellable] of Object.entries(value as Record<string, unknown>)) {
    flags[tier as SubscriptionTier] = sellable === true;
  }
  return flags;
}

export async function loadSellablePrices(): Promise<SellablePrices | null> {
  try {
    const response = await fetch(buildApiUrl('/api/stripe/checkout'), { method: 'GET' });
    if (!response.ok) return null;
    const payload = (await response.json()) as { ok?: unknown; managed?: unknown; sellable?: Record<string, unknown> };
    const monthly = tierFlags(payload?.sellable?.monthly);
    const annual = tierFlags(payload?.sellable?.annual);
    if (payload?.ok !== true || !monthly || !annual) return null;
    return { managed: payload.managed === true, monthly, annual };
  } catch {
    return null;
  }
}

export type TrialRecord = {
  startedAt: string;
  endsAt: string;
  plan: string;
};

export type TrialStartResult =
  | {
      ok: true;
      trial: TrialRecord;
    }
  | {
      ok: false;
      message: string;
      /** The server's refusal code, when the server is what refused. */
      code?: string;
    };

/**
 * Start the workspace's 14-day Professional trial.
 *
 * No card, no Stripe: the server records the trial on the subscription
 * profile and returns the window it wrote. The caller applies the returned
 * start time to the local subscription so Professional is visible
 * immediately; the next cloud load reads the same record back.
 */
export async function requestTrialStart(params: {
  workspaceId: string;
  accessToken: string;
}): Promise<TrialStartResult> {
  if (!params.workspaceId || !params.accessToken) {
    return {
      ok: false,
      code: NO_MANAGED_IDENTITY,
      message: 'Sign in to this workspace before starting the trial.',
    };
  }

  try {
    const response = await fetch(buildApiUrl('/api/account/trial-start'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    });

    const payload = (await response.json()) as { ok?: boolean; message?: string; trial?: TrialRecord; code?: string };
    if (!response.ok || !payload.ok || !payload.trial) {
      return {
        ok: false,
        message: payload.message ?? 'The trial could not be started.',
        code: payload.code,
      };
    }

    return { ok: true, trial: payload.trial };
  } catch {
    return {
      ok: false,
      message: 'The trial could not be started. Check your connection and try again.',
    };
  }
}
