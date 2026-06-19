import { apiConfig, isSupabaseConfigured, monitoringConfig } from '@/lib/platformConfig';
import { getSupabaseClient } from '@/lib/supabaseClient';

export type RuntimeEventSeverity = 'info' | 'warn' | 'error';

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

async function postRuntimeEventToApi(event: RuntimeEventInput) {
  if (typeof fetch === 'undefined') {
    return;
  }

  try {
    await fetch(buildApiUrl('/api/telemetry'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
      keepalive: true,
    });
  } catch (err) {
    if (process.env.NODE_ENV === 'development') {
      console.debug('[xbar telemetry] transport failed:', err);
    }
  }
}

export async function trackRuntimeEvent(event: RuntimeEventInput) {
  if (!monitoringConfig.enabled) {
    return;
  }

  try {
    if (isSupabaseConfigured()) {
      const client = getSupabaseClient();
      if (client) {
        const {
          data: { session },
        } = await client.auth.getSession();

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

  await postRuntimeEventToApi(event);
}
