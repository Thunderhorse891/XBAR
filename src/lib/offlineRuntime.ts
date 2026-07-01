export type OfflineRuntimeStatus = 'unsupported' | 'ready' | 'registered' | 'failed';

const SERVICE_WORKER_URL = '/xbar-service-worker.js?v=20260630-vercel-freshness';
let refreshQueued = false;

export async function registerOfflineRuntime(): Promise<OfflineRuntimeStatus> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }

  try {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshQueued) return;
      refreshQueued = true;
      window.location.reload();
    });

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { updateViaCache: 'none' });
    await registration.update();
    return registration.active || registration.waiting || registration.installing ? 'registered' : 'ready';
  } catch {
    return 'failed';
  }
}

export function isBrowserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
