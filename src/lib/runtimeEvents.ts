import { apiConfig, isSupabaseConfigured, monitoringConfig } from '@/lib/platformConfig';
import { getSupabaseClient } from '@/lib/supabaseClient';

export type RuntimeEventSeverity = 'info' | 'warning' | 'error';

type RuntimeEventInput = {
  workspaceId?: string;
  eventName: string;
  severity?: RuntimeEventSeverity;
  payload?: Record<string, unknown>;
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

async function postRuntimeEventToApi(event: RuntimeEventInput, accessToken?: string) {
  if (typeof fetch === 'undefined') {
    return;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  // Attach the caller's token so the server can verify workspace membership
  // before associating the event; without it the event is stored anonymously.
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  try {
    await fetch(buildApiUrl('/api/telemetry'), {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
      keepalive: true,
    });
  } catch {
    // Ignore telemetry transport failures.
  }
}

export async function trackRuntimeEvent(event: RuntimeEventInput) {
  if (!monitoringConfig.enabled) {
    return;
  }

  let accessToken: string | undefined;
  try {
    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      if (client) {
        const {
          data: { session },
        } = await client.auth.getSession();
        accessToken = session?.access_token;

        if (session?.user && event.workspaceId) {
          const { error } = await client.from('runtime_events').insert({
            workspace_id: event.workspaceId,
            user_id: session.user.id,
            channel: 'web',
            severity: event.severity ?? 'info',
            event_name: event.eventName,
            payload: event.payload ?? {},
          });

          if (!error) {
            return;
          }
        }
      }
    }
  } catch {
    // Ignore direct telemetry failures and fall back to the API path.
  }

  if (!monitoringConfig.apiFallbackEnabled) {
    return;
  }

  await postRuntimeEventToApi(event, accessToken);
}
