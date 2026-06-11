import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useWorkspaceHydrated, useWorkspaceReady } from '@/store/useXbarStore';

export function RequireWorkspaceSetup({ children }: { children: ReactNode }) {
  const location = useLocation();
  const workspaceHydrated = useWorkspaceHydrated();
  const workspaceReady = useWorkspaceReady();

  if (!workspaceHydrated) {
    return <div className="app-loading-shell">Loading ranch workspace...</div>;
  }

  if (!workspaceReady) {
    return <Navigate to="/setup" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}
