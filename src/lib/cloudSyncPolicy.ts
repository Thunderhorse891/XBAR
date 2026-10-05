import { stableStringify } from './relationalDiff.js';
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
      'ownershipRecords',
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
  return stableStringify(
    Object.fromEntries(
      Object.entries(workspace).map(([key, value]) => [
        key,
        Array.isArray(value) && value.every((item) => typeof asRecord(item)?.id === 'string')
          ? [...value].sort((a, b) => String(a.id).localeCompare(String(b.id)))
          : value,
      ]),
    ),
  );
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
  remoteAuthoritativeEmpty?: boolean;
}): CloudReconciliation {
  const localMeaningful = hasMeaningfulWorkspace(params.local);
  if (params.remoteAuthoritativeEmpty) return localMeaningful ? 'conflict-lock' : 'empty-ready';
  if (params.remote !== undefined) {
    const remoteMeaningful = hasMeaningfulWorkspace(params.remote);
    if (remoteMeaningful && !localMeaningful) return 'import-remote';
    if (!remoteMeaningful && localMeaningful) return 'push-local';
    if (!remoteMeaningful && !localMeaningful) return 'empty-ready';
    return serializeWorkspaceBackup(params.local) === serializeWorkspaceBackup(params.remote)
      ? 'connected'
      : 'conflict-lock';
  }
  if (params.remoteError && isMissingCloudWorkspaceMessage(params.remoteError))
    return localMeaningful ? 'push-local' : 'empty-ready';
  if (params.remoteError) return 'error-lock';
  return localMeaningful ? 'error-lock' : 'empty-ready';
}
