export type WorkspaceSetupCloudStatus = 'unavailable' | 'loading' | 'signed-out' | 'signed-in';

export type WorkspaceSetupDecision = 'loading' | 'setup' | 'allow';

export type WorkspaceSetupGateInput = {
  /** The LOCAL persisted store has been read. Says nothing about the cloud. */
  workspaceHydrated: boolean;
  /** This workspace has a `setupCompleteAt`, from whichever copy is loaded. */
  workspaceReady: boolean;
  cloudStatus: WorkspaceSetupCloudStatus;
  /** CloudBootstrap has finished its first reconciliation for this session. */
  cloudSettled: boolean;
};

/*
 * Whether a route behind setup may render, must wait, or should send the
 * customer to the setup screen.
 *
 * The distinction this exists for is between "this workspace is not set up"
 * and "nobody has asked the cloud yet". They were the same answer, and the
 * second one is not true: `workspaceHydrated` only means zustand has read
 * LOCAL storage, which on a device this account has never used resolves
 * immediately with an empty profile. So a rancher signing in on a new phone
 * and opening a link to their settings was told their ranch needed setting up,
 * shown the onboarding wizard, and then bounced to the dashboard once the
 * cloud profile arrived a moment later -- their link lost, and a workspace
 * they finished months ago described as unfinished.
 *
 * Waiting is only ever entered when the workspace does NOT look set up. Once
 * `workspaceReady` is true the route renders immediately and never waits on
 * the cloud again, so the re-sync that flips `cloudSettled` false on an
 * ordinary token refresh cannot blank a working screen.
 */
export function decideWorkspaceSetupGate(input: WorkspaceSetupGateInput): WorkspaceSetupDecision {
  if (!input.workspaceHydrated) return 'loading';
  if (input.workspaceReady) return 'allow';

  /*
   * Signed in, and the cloud copy of this workspace has not arrived yet.
   *
   * 'loading' is the cloud store before it knows who is here, which is equally
   * not an answer about the workspace. Every other status is settled: signed
   * out or no project configured means the local copy is the only copy there
   * will ever be, and an empty one really does mean setup is unfinished.
   */
  const cloudMayStillAnswer =
    input.cloudStatus === 'loading' || (input.cloudStatus === 'signed-in' && !input.cloudSettled);
  return cloudMayStillAnswer ? 'loading' : 'setup';
}
