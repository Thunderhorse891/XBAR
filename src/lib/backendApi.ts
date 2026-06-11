import { apiConfig } from '@/lib/platformConfig';

/*
 * Client for the XBAR backend pipeline (Vercel serverless api/). These calls
 * produce real artifacts — watermarked sale packet PDFs and pre-filled
 * document PDFs — against the cloud workspace. Every result is typed so a
 * tier refusal can be converted into an upgrade moment instead of a dead end.
 */

export type TierBlock = {
  requiredPlan: string;
  currentPlan: string;
};

export type BackendResult<T> =
  | ({ ok: true } & T)
  | { ok: false; message: string; tierBlock?: TierBlock };

type AuthParams = {
  workspaceId: string;
  accessToken: string;
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

export function hasBackendIdentity(params: Partial<AuthParams>): params is AuthParams {
  return Boolean(params.workspaceId && params.accessToken);
}

async function postJson<T>(path: string, auth: AuthParams, body: Record<string, unknown>): Promise<BackendResult<T>> {
  try {
    const response = await fetch(buildApiUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ workspaceId: auth.workspaceId, ...body }),
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
      ok?: boolean;
      message?: string;
      code?: string;
      requiredPlan?: string;
      currentPlan?: string;
    };

    if (!response.ok || !payload.ok) {
      const result: BackendResult<T> = {
        ok: false,
        message: payload.message ?? `The workspace service returned ${response.status}.`,
      };
      if (payload.code === 'tier_required' && payload.requiredPlan) {
        result.tierBlock = {
          requiredPlan: String(payload.requiredPlan),
          currentPlan: String(payload.currentPlan ?? ''),
        };
      }
      return result;
    }

    return { ok: true, ...(payload as T) };
  } catch {
    return {
      ok: false,
      message: 'The workspace service is unreachable. Try again, or check your connection.',
    };
  }
}

export type RemoteSalePacket = {
  packetId: string;
  downloadUrl: string;
  expiresInSeconds: number;
  watermarkText: string;
  includedDocumentIds: string[];
  unavailableDocuments: string[];
  emailed: boolean;
};

export async function createSalePacketRemote(
  auth: AuthParams,
  input: {
    horseId: string;
    buyerName?: string;
    buyerEmail?: string;
    watermarkText?: string;
    documentIds?: string[];
  },
): Promise<BackendResult<RemoteSalePacket>> {
  return postJson<RemoteSalePacket>('/api/sale-packets', auth, input);
}

export type RemoteGeneratedDocument = {
  documentId: string;
  title: string;
  fileName: string;
  downloadUrl: string;
  expiresInSeconds: number;
  missingFields: string[];
};

export async function generateDocumentFromTemplateRemote(
  auth: AuthParams,
  input: {
    templateId: string;
    horseId: string;
    fields?: Record<string, string>;
  },
): Promise<BackendResult<RemoteGeneratedDocument>> {
  return postJson<RemoteGeneratedDocument>('/api/documents/generate-from-template', auth, input);
}
