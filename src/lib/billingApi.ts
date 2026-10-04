import { apiConfig } from './platformConfig.js';
import type { SubscriptionTier } from '../types/xbar.js';

type CheckoutResult =
  | {
      ok: true;
      url: string;
    }
  | {
      ok: false;
      message: string;
      /** The server's refusal code, when the server is what refused. */
      code?: string;
    };

/**
 * The one failure that legitimately ends at a Stripe Payment Link: there is no
 * managed identity to check a billing row against.
 *
 * Without a workspace id and access token the endpoint cannot be called at all,
 * so no subscription can be found — and therefore none can be duplicated. That
 * is how a local-only workspace buys a plan, and it must keep working.
 */
export const NO_MANAGED_IDENTITY = 'no_managed_identity';

/**
 * Whether a failed managed checkout may fall back to the unguarded payment link.
 *
 * Reads as an allowlist, and that direction is the point. Blocking a list of
 * known refusal CODES left every *uncoded* failure falling through — and `fetch`
 * rejecting, or a malformed response body, produces exactly that. Those are the
 * cases where the endpoint's guard never got to run, so a workspace whose
 * billing row holds an active or recoverable subscription would be handed a
 * `mode: 'subscription'` payment link that consults no billing row at all, and
 * charged a second time. A network error is not evidence that a customer has no
 * subscription; it is the absence of evidence either way.
 *
 * So: fall back only when we affirmatively know there was no identity to check.
 * Everything else — server refusals, transport failures, unparseable responses —
 * stops and tells the customer, because none of them establish that a second
 * subscription is safe to create.
 */
export function canUsePaymentLinkFallback(code?: string): boolean {
  return code === NO_MANAGED_IDENTITY;
}

/**
 * Which checkout route a purchase takes before any request is made.
 *
 * 'payment_link' here is NOT the fallback below — it is the primary and only
 * route a hosted-link-only deployment has. The two are decided by different
 * facts and must not be collapsed: this one reads configuration BEFORE the
 * endpoint is called, the fallback reads a refusal code AFTER it answered.
 *
 * When managed billing is off, api/stripe/checkout.js returns 503 before it
 * reads a billing row — before the access check, before the duplicate-
 * subscription lookup — and that refusal carries no code because nothing was
 * found. The allowlist then correctly declines to follow it, which suppressed
 * the configured payment link and left every purchase in that deployment
 * ending in an error.
 *
 * Skipping the request gives up no protection: the guard it would have run is
 * unreachable in this mode by construction. A workspace that already has a
 * subscription is refused earlier, by `getCheckoutReadiness`.
 *
 * The condition is the managed-billing flag, never a failure code. With
 * managed billing on, the endpoint is always called and the strict allowlist
 * still governs the fallback, so an uncoded failure still blocks the link.
 */
export function checkoutRouteFor(params: {
  managedBillingEnabled: boolean;
  paymentLink: string;
}): 'managed' | 'payment_link' {
  return !params.managedBillingEnabled && params.paymentLink ? 'payment_link' : 'managed';
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

const BILLING_REQUEST_TIMEOUT_MS = 30_000;
class BillingRequestTimeout extends Error {}

// Bound both response headers and body consumption. Aborting a request cannot
// undo a server write, so the caller must report uncertainty, not failure to pay.
async function readBillingResponse(path: string, init: RequestInit) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new BillingRequestTimeout());
      controller.abort();
    }, BILLING_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(buildApiUrl(path), { ...init, signal: controller.signal });
        const payload: unknown = await response.json();
        return { response, payload };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function startManagedCheckout(params: {
  tier: SubscriptionTier;
  workspaceId: string;
  accessToken: string;
  billingPeriod?: 'monthly' | 'annual';
}): Promise<CheckoutResult> {
  if (!params.workspaceId || !params.accessToken) {
    return {
      ok: false,
      // Coded, because this is the ONLY failure a payment link may follow. It
      // has to be told apart from a fetch that threw, which looks identical
      // from the caller's side and is not safe to fall back on.
      code: NO_MANAGED_IDENTITY,
      message: 'Sign in to continue to secure checkout.',
    };
  }

  try {
    const result = await readBillingResponse('/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({
        tier: params.tier,
        workspaceId: params.workspaceId,
        billingPeriod: params.billingPeriod === 'annual' ? 'annual' : 'monthly',
        returnUrl: typeof window !== 'undefined' ? window.location.href : '',
      }),
    });

    const { response } = result;
    const payload = result.payload as { ok?: boolean; message?: string; url?: string; code?: string };
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
  } catch (error) {
    return {
      ok: false,
      code: error instanceof BillingRequestTimeout ? 'request_timeout' : undefined,
      message:
        'We could not confirm the checkout request. Check billing before trying again; a session may already exist.',
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
    const result = await readBillingResponse('/api/account/trial-start', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      },
      body: JSON.stringify({ workspaceId: params.workspaceId }),
    });

    const { response } = result;
    const payload = result.payload as { ok?: boolean; message?: string; trial?: TrialRecord; code?: string };
    if (!response.ok || !payload.ok || !payload.trial) {
      return {
        ok: false,
        message: payload.message ?? 'The trial could not be started.',
        code: payload.code,
      };
    }

    return { ok: true, trial: payload.trial };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof BillingRequestTimeout ? 'request_timeout' : undefined,
      message:
        'We could not confirm whether the trial started. Reload billing to check its status before trying again.',
    };
  }
}
