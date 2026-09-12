import { readBrowserStorage, writeBrowserStorage } from '@/lib/browserStorage';

/*
 * One rule, one place. This was written twice -- in RequireCloudAuth and in
 * InteractionSystem -- with the same key spelled out both times, which is how
 * a marker that gates navigation drifts from the one that gates the shell.
 */
const COMMAND_CENTER_ENTRY_KEY = 'xbar-command-center-entry';

/*
 * Also held in memory, because a browser that refuses the write still has to
 * be able to open a local workspace.
 *
 * Storage used to THROW here, which was at least loud. Routing it through a
 * reporting helper made the failure silent, and silent was worse: the entry
 * marker was never stored, the guard read no marker, and the customer was sent
 * straight back to the sign-in screen they had just left -- with a toast
 * saying their workspace had opened. A loop, announced as a success.
 *
 * The memory flag lasts as long as the page does. It does NOT survive a
 * reload, so with storage blocked a reload does return them to sign-in; that
 * is a limit of having nowhere durable to write, not something this hides.
 */
let entryHeldInMemory = false;

export function markCommandCenterEntry(): void {
  entryHeldInMemory = true;
  writeBrowserStorage(COMMAND_CENTER_ENTRY_KEY, 'true');
}

export function hasCommandCenterEntry(): boolean {
  return entryHeldInMemory || readBrowserStorage(COMMAND_CENTER_ENTRY_KEY) === 'true';
}
