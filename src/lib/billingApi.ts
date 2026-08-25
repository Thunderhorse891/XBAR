import { apiConfig } from '@/lib/platformConfig';
import type { SubscriptionTier } from '@/types/xbar';

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

/*
 * Refusals that must never fall through to a Stripe Payment Link.
 *
 * The payment link is an unguarded `mode: 'subscription'` checkout — it does
 * not consult the workspace's billing row at all. So redirecting to it after
 * `api/stripe/checkout.js` refused reinstates the exact duplicate-charge path
 * the refusal exists to close, and does it silently: the customer sees a normal
 * Stripe page and pays.
 *
 * Scoped to server codes on purpose. An ordinary failure — no cloud session, a
 * network blip, checkout not configured — still falls back, because that is the
 * legitimate way a local-only workspace buys a plan.
 */
const POLICY_REFUSAL_CODES = new Set([
  'subscription_active',
  'subscription_recoverable',
  'subscription_unverified',
  // The billing row could not be read. Unknown is not permission to charge.
  'billing_unavailable',
]);

export function isBillingPolicyRefusal(code?: string): boolean {
  return Boolean(code && POLICY_REFUSAL_CODES.has(code));
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
}): Promise<CheckoutResult> {
  if (!params.workspaceId || !params.accessToken) {
    return {
      ok: false,
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
        returnUrl: typeof window !== 'undefined' ? window.location.href : '',
      }),
    });

    const payload = (await response.json()) as { ok?: boolean; message?: string; url?: string; code?: string };
    if (!response.ok || !payload.ok || !payload.url) {
      return {
        ok: false,
        message: payload.message ?? 'Secure checkout is not ready yet.',
        // Carried through so the caller can tell a policy refusal from a
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
