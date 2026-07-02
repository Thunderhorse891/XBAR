import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isCloudAuthRequired, isLocalModeEnabled, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';

function hasCommandCenterEntry() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('xbar-command-center-entry') === 'true';
}

export function RequireCloudAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);

  const localEntryStarted = hasCommandCenterEntry();

  if (localEntryStarted) {
    return <>{children}</>;
  }

  if (!isSupabaseConfigured() && isLocalModeEnabled()) {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}`, reason: 'local-entry-required' }} />;
  }

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
