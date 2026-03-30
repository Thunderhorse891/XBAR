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
    };

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
      message: 'Sign in to start a managed billing session.',
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

    const payload = (await response.json()) as { ok?: boolean; message?: string; url?: string };
    if (!response.ok || !payload.ok || !payload.url) {
      return {
        ok: false,
        message: payload.message ?? 'Managed checkout is unavailable in this environment.',
      };
    }

    return {
      ok: true,
      url: payload.url,
    };
  } catch {
    return {
      ok: false,
      message: 'Managed checkout is unavailable in this environment.',
    };
  }
}
