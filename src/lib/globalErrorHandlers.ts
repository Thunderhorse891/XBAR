import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';

/*
 * Global crash visibility. The React ErrorBoundary only sees render-phase
 * errors; uncaught async errors and promise rejections would otherwise vanish
 * in production. Both handlers forward into the runtime-events telemetry
 * pipeline, capped per session so a crash loop cannot flood the endpoint.
 */

const MAX_REPORTS_PER_SESSION = 20;
let reportsSent = 0;
let registered = false;

function report(eventName: string, payload: Record<string, unknown>) {
  if (reportsSent >= MAX_REPORTS_PER_SESSION) {
    return;
  }
  reportsSent += 1;
  void trackRuntimeEvent({
    workspaceId: useCloudStore.getState().workspaceId,
    eventName,
    severity: 'error',
    payload,
  });
}

export function registerGlobalErrorHandlers() {
  if (registered || typeof window === 'undefined') {
    return;
  }
  registered = true;

  window.addEventListener('error', (event) => {
    report('ui.uncaught_error', {
      message: event.message || 'Unknown error',
      source: event.filename || '',
      line: event.lineno ?? 0,
      column: event.colno ?? 0,
      stack: event.error instanceof Error ? (event.error.stack ?? '') : '',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report('ui.unhandled_rejection', {
      message: reason instanceof Error ? reason.message : String(reason ?? 'Unknown rejection'),
      stack: reason instanceof Error ? (reason.stack ?? '') : '',
    });
  });
}
