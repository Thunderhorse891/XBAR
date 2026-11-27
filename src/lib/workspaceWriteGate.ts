import type { WorkspaceSetupCloudStatus } from './workspaceSetupGate';

export type WorkspaceWriteContext = {
  status: WorkspaceSetupCloudStatus;
  session: { user: { id: string } } | null;
  workspaceId: string;
  autosaveReady: boolean;
  autosaveUnlocked: boolean;
  workspaceRole: string;
};

// This is a device-write guard, not server authorization. A known, settled
// ranch can still accept offline edits; an unresolved identity/conflict cannot.
export function workspaceWriteBlockReason(cloud: WorkspaceWriteContext, recordsOwner: string): string | null {
  if (cloud.status === 'loading') return 'Please wait while XBAR checks this device’s ranch access.';
  if (!cloud.session)
    return cloud.status === 'signed-in'
      ? 'Ranch access is not verified. Open Settings or sign in again before adding records.'
      : null;
  if (cloud.workspaceRole === 'Pending access') return 'Please wait while XBAR verifies your ranch permissions.';
  if (!cloud.workspaceId)
    return 'Finish ranch setup before adding records. If setup already finished, open Settings to check the cloud connection.';
  if (!cloud.autosaveReady) return 'Please wait while XBAR checks this device’s records against your ranch.';
  if (!cloud.autosaveUnlocked || recordsOwner !== cloud.workspaceId)
    return 'New records and uploads are paused because this device’s ranch records are not connected to cloud saving. Existing work is unchanged. Open Settings to review the connection before adding more.';
  return null;
}
