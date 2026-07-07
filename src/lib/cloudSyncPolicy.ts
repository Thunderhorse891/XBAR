export type CloudReconciliation =
  'import-remote' | 'push-local' | 'connected' | 'conflict-lock' | 'empty-ready' | 'error-lock';

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function getWorkspacePayload(backup: unknown) {
  const record = asRecord(backup);
  if (!record) return null;
  return asRecord(record.workspace) ?? record;
}

export function hasMeaningfulWorkspace(backup: unknown) {
  const workspace = getWorkspacePayload(backup);
  if (!workspace) return false;
  const profile = asRecord(workspace.workspaceProfile);
  const hasProfile = ['setupCompleteAt', 'businessName', 'ranchName', 'defaultOwnerName', 'operationsEmail'].some(
    (key) => typeof profile?.[key] === 'string' && String(profile[key]).trim(),
  );
  return (
    hasProfile ||
    [
      'horses',
      'documents',
      'intakeBatches',
      'expenseReceipts',
      'ranchAssets',
      'salesLeads',
      'sharedListings',
      'workspaceMembers',
      'workspaceInvitations',
    ].some((key) => Array.isArray(workspace[key]) && workspace[key].length > 0)
  );
}

export function serializeWorkspaceBackup(backup: unknown) {
  const workspace = getWorkspacePayload(backup);
  if (!workspace) return '';
  return JSON.stringify(workspace);
}

export function isMissingCloudWorkspaceMessage(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('no cloud workspace') ||
    normalized.includes('no relational workspace') ||
    normalized.includes('no relational workspace records')
  );
}

export function decideCloudReconciliation(params: {
  local: unknown;
  remote?: unknown;
  remoteError?: string;
}): CloudReconciliation {
  const localMeaningful = hasMeaningfulWorkspace(params.local);
  if (params.remote !== undefined) {
    const remoteMeaningful = hasMeaningfulWorkspace(params.remote);
    if (remoteMeaningful && !localMeaningful) return 'import-remote';
    if (!remoteMeaningful && localMeaningful) return 'push-local';
    if (!remoteMeaningful && !localMeaningful) return 'empty-ready';
    return serializeWorkspaceBackup(params.local) === serializeWorkspaceBackup(params.remote)
      ? 'connected'
      : 'conflict-lock';
  }
  if (localMeaningful && params.remoteError && isMissingCloudWorkspaceMessage(params.remoteError)) return 'push-local';
  return localMeaningful ? 'error-lock' : 'empty-ready';
}
