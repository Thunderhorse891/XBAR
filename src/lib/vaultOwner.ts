// Which workspace owns a file written to the on-device vault.
//
// The vault is one IndexedDB database per browser ORIGIN; a workspace is not.
// The same browser can hold two cloud accounts, or a cloud workspace and a
// local-only one, so every write records who it belongs to and the orphan sweep
// only ever deletes files it can prove are its own.
//
// One function rather than the expression repeated at each call site: three
// copies of a rule is how the other drifts in this PR started, and the failure
// mode here is deleting a rancher's only copy of a document.

import { useCloudStore } from '@/store/useCloudStore';

/**
 * The cloud workspace id when signed in, and `'local'` otherwise.
 *
 * `'local'` is a correct owner rather than a placeholder: a browser profile has
 * exactly one local-only workspace, because zustand persists it under a single
 * key. Two local-only workspaces in one profile cannot exist to be confused.
 */
export function vaultOwnerId(): string {
  return useCloudStore.getState().workspaceId || 'local';
}
