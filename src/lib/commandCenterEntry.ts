import { readBrowserStorage } from '@/lib/browserStorage';

/*
 * One rule, one place. This was written twice -- in RequireCloudAuth and in
 * InteractionSystem -- with the same key spelled out both times, which is how
 * a marker that gates navigation drifts from the one that gates the shell.
 */
const COMMAND_CENTER_ENTRY_KEY = 'xbar-command-center-entry';

export function hasCommandCenterEntry(): boolean {
  return readBrowserStorage(COMMAND_CENTER_ENTRY_KEY) === 'true';
}
