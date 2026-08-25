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
      // Coded, because this is the ONLY failure a payment link may follow. It
      // has to be told apart from a fetch that threw, which looks identical
      // from the caller's side and is not safe to fall back on.
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
