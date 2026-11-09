import { useEffect, useState } from 'react';
import { OwnerRequestError, ownerRequest } from '@/lib/ownerDashboard';

type Result<T> = { key: string; data?: T; error?: string; denied?: boolean };

// Keep each section independent, but never retain a prior session's visible
// customer data during the render before effect cleanup. Nothing is persisted.
export function useOwnerResource<T>(action: string, token: string, revision: number) {
  const key = JSON.stringify([token, action, revision]);
  const [result, setResult] = useState<Result<T> | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    let active = true;
    void ownerRequest<T>(action, token, controller.signal)
      .then((data) => {
        if (active) setResult({ key, data });
      })
      .catch((error: unknown) => {
        if (active)
          setResult({
            key,
            denied: error instanceof OwnerRequestError && [401, 403].includes(error.status),
            error:
              error instanceof OwnerRequestError ? error.message : 'This section could not load. Refresh to try again.',
          });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [key, action, token]);
  return token && result?.key === key ? result : null;
}
