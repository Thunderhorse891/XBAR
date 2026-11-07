import { useEffect, useState } from 'react';
import { ownerRequest } from '@/lib/ownerDashboard';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';
import { useCloudStore } from '@/store/useCloudStore';

type Access = 'checking' | 'allowed' | 'denied' | 'unavailable';

export function useOwnerAccess(enabled = true): Access {
  enabled = enabled && canPresentPurchaseFlow();
  const token = useCloudStore((s) => s.session?.access_token) ?? '';
  const [result, setResult] = useState<{ token: string; access: Access } | null>(null);
  useEffect(() => {
    if (!enabled || !token) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let active = true;
    void ownerRequest<{ owner: boolean }>('owner-access', token, controller.signal)
      .then((body) => {
        if (active) setResult({ token, access: body.owner === true ? 'allowed' : 'denied' });
      })
      .catch(() => {
        if (active) setResult({ token, access: 'unavailable' });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, enabled]);
  // A new session can never render the old session's grant while its effect runs.
  if (!enabled || !token) return 'denied';
  return result?.token === token ? result.access : 'checking';
}
