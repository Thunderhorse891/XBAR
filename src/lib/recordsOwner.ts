// Which workspace the records currently in this browser belong to.
//
// The vault records an owner per file; the RECORD SET had no such marker, and
// that gap is a way to delete a rancher's documents.
//
// zustand persists one workspace under one key, so signing into a cloud
// workspace and importing its backup REPLACES the local-only records in place.
// Sign out — or let the session lapse, or fail to read it — and `vaultOwnerId()`
// drops back to `'local'` while those records still belong to the cloud
// workspace. The orphan sweep then deletes every `'local'`-owned file, because
// none of them is referenced by the records now on screen.
//
// Nothing in the store could answer "whose records are these?", so it is
// recorded here at the two points where the whole set is replaced.
//
// This lives in browser storage rather than in the persisted workspace payload
// on purpose: it describes THIS browser, not the workspace. Carried inside a
// backup it would travel to another device and assert something false there.

const RECORDS_OWNER_KEY = 'xbar-records-owner';

/** Record who owns the workspace records now installed in this browser. */
export function rememberRecordsOwner(owner: string): void {
  try {
    window.localStorage.setItem(RECORDS_OWNER_KEY, owner);
  } catch {
    // Private browsing, or storage disabled. An unwritten marker reads back as
    // unknown, and unknown withholds the sweep — the safe direction.
  }
}

/** Who owns them, or `''` when this browser has never recorded it. */
export function readRecordsOwner(): string {
  try {
    return window.localStorage.getItem(RECORDS_OWNER_KEY) ?? '';
  } catch {
    return '';
  }
}
