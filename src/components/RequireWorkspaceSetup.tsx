import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useWorkspaceReady } from '@/store/useXbarStore';

export function RequireWorkspaceSetup({ children }: { children: ReactNode }) {
  const location = useLocation();
  const workspaceReady = useWorkspaceReady();

  if (!workspaceReady) {
    return <Navigate to="/setup" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}
