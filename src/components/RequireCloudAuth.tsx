import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isCloudAuthRequired, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';

export function RequireCloudAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);

  if (isCloudAuthRequired()) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}`, reason: 'cloud-required' }} />;
  }

  if (!isSupabaseConfigured()) {
    return <>{children}</>;
  }

  if (status === 'loading') {
    return <div className="app-loading-shell">Checking access...</div>;
  }

  if (!session || status === 'signed-out') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}
