import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { decideWorkspaceSetupGate } from '@/lib/workspaceSetupGate';
import { useCloudStore } from '@/store/useCloudStore';
import { useWorkspaceHydrated, useWorkspaceReady } from '@/store/useXbarStore';

export function RequireWorkspaceSetup({ children }: { children: ReactNode }) {
  const location = useLocation();
  const workspaceHydrated = useWorkspaceHydrated();
  const workspaceReady = useWorkspaceReady();
  const cloudStatus = useCloudStore((state) => state.status);
  // "CloudBootstrap stopped hydrating", which is the signal for whether the
  // cloud still owes this page an answer. Not whether it liked the answer:
  // a conflict lock leaves this true, and a locked workspace is a workspace
  // that has been described, not one that needs setting up.
  const cloudSettled = useCloudStore((state) => state.autosaveReady);

  const decision = decideWorkspaceSetupGate({ workspaceHydrated, workspaceReady, cloudStatus, cloudSettled });

  if (decision === 'loading') {
    return <div className="app-loading-shell">Loading ranch workspace...</div>;
  }

  if (decision === 'setup') {
    return <Navigate to="/setup" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return <>{children}</>;
}
