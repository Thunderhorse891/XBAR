import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useStoreHydrated, useWorkspaceReady } from '@/store/useXbarStore';

export function RequireWorkspaceSetup({ children }: { children: ReactNode }) {
  const location = useLocation();
  const hydrated = useStoreHydrated();
  const workspaceReady = useWorkspaceReady();

  // Render nothing during the async IndexedDB hydration window to prevent
  // the empty seed state from triggering a premature redirect to /setup.
  if (!hydrated) {
    return null;
  }

  if (!workspaceReady) {
    return <Navigate to="/setup" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}
