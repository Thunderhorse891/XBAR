import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { readRecordsOwner } from '@/lib/recordsOwner';
import { workspaceWriteBlockReason } from '@/lib/workspaceWriteGate';
import { useCloudStore } from '@/store/useCloudStore';
import '@/routes/cleanEntryExperience.css';

export function RequireWorkspaceWrites({ children }: { children: ReactNode }) {
  const cloud = useCloudStore();
  const location = useLocation();
  const reason = workspaceWriteBlockReason(cloud, readRecordsOwner());
  // Keep the existing recovery/export and account controls reachable. Store
  // action guards also protect the global create drawer on these routes.
  if (!reason || location.pathname === '/settings' || location.pathname === '/billing') return <>{children}</>;
  const pending = cloud.status === 'loading' || (Boolean(cloud.workspaceId) && !cloud.autosaveReady);
  return (
    <main className="clean-entry-shell">
      <section className="clean-auth-card" aria-labelledby="ranch-connection-title">
        <XbarMark tone="mono" />
        <h1 id="ranch-connection-title">
          {pending ? 'Checking ranch connection' : 'Connect your ranch before adding records'}
        </h1>
        <p role={pending ? 'status' : 'alert'}>{reason}</p>
        <p>Opening Settings does not replace or upload records. Review both copies before choosing a sync action.</p>
        <div className="clean-action-stack">
          {!cloud.workspaceId && cloud.status !== 'loading' ? (
            <Link className="clean-primary-button" to="/setup">
              Finish ranch setup
            </Link>
          ) : null}
          <Link className="clean-secondary-button" to="/settings">
            Open Settings
          </Link>
          <Link className="clean-secondary-button" to="/login">
            Sign-in options
          </Link>
        </div>
      </section>
    </main>
  );
}
