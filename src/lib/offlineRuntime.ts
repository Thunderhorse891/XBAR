export type OfflineRuntimeStatus = 'unsupported' | 'ready' | 'registered' | 'failed';

export async function registerOfflineRuntime(): Promise<OfflineRuntimeStatus> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }

  try {
    const registration = await navigator.serviceWorker.register('/xbar-service-worker.js');
    return registration.active || registration.waiting || registration.installing ? 'registered' : 'ready';
  } catch {
    return 'failed';
  }
}

export function isBrowserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
