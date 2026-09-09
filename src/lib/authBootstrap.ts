/**
 * What to do with an auth event that arrives before the first sync has run.
 *
 * `initialize` subscribes to onAuthStateChange BEFORE awaiting anything, because
 * PASSWORD_RECOVERY is a one-shot notification and a late subscriber misses it.
 * That leaves a window: getSession() and then a workspace network round trip run
 * while events can already be arriving, and every one of them used to be
 * dropped so the first sync would not be done twice.
 *
 * Dropping them is wrong for anything that CHANGES the answer. If another tab
 * signs out during that window, the SIGNED_OUT arrives, is discarded, and then
 * the in-flight getSession result lands and writes the stale signed-in session
 * and its workspace back into the store -- with no later event to correct it,
 * so the app keeps showing a workspace the customer has signed out of until
 * they reload.
 *
 * INITIAL_SESSION is the exception, and not an arbitrary one: it reports the
 * same fact getSession() is about to report, so replaying it would reload the
 * workspace a second time on every single startup, which is exactly what the
 * original guard existed to avoid.
 */
export type BootstrapEventInput = {
  bootstrapped: boolean;
  event: string;
};

export type BootstrapEventDisposition =
  | 'apply' // Bootstrap is done; sync it now.
  | 'queue' // Bootstrap is still running; replay this once it finishes.
  | 'ignore'; // Says nothing the first sync is not already about to say.

export function bootstrapEventDisposition(input: BootstrapEventInput): BootstrapEventDisposition {
  if (input.bootstrapped) return 'apply';
  return input.event === 'INITIAL_SESSION' ? 'ignore' : 'queue';
}

/**
 * Lets only the most recently started write commit.
 *
 * Syncing a session is not atomic: a signed-in one waits on a workspace
 * network round trip before it writes, while a signed-out one writes at once.
 * The auth listener starts these without awaiting them, so two can be in
 * flight together and the LAST TO FINISH wins rather than the last to happen.
 * A sign-out therefore lands, and the sign-in it replaced finishes afterwards
 * and puts the old session and workspace back -- with no further event coming,
 * so the app shows a workspace the customer has left until they reload.
 *
 * Ordering by arrival instead of by latency is the whole job. Each write takes
 * a ticket on the way in and checks it on the way out; a write that has been
 * overtaken drops itself instead of committing stale state.
 */
export type LatestWriteGate = {
  /** Start a write; the returned check says whether it may still commit. */
  begin: () => () => boolean;
  /**
   * Retire every write currently in flight WITHOUT starting one.
   *
   * Needed the moment a newer event is merely queued rather than applied: the
   * bootstrap sync is still loading a workspace for a session that has already
   * been superseded, and without this it commits that obsolete session and
   * workspace before the replay even starts -- long enough for reconciliation
   * to begin against the wrong account.
   */
  retireInFlight: () => void;
};

export function createLatestWriteGate(): LatestWriteGate {
  let issued = 0;
  return {
    begin() {
      const ticket = ++issued;
      return function isStillLatest() {
        return ticket === issued;
      };
    },
    retireInFlight() {
      issued += 1;
    },
  };
}

/**
 * What publishing a newly observed identity must change in the store.
 *
 * Who is signed in is published before their workspace is fetched, so the
 * reset screen does not wait on a network round trip it has no use for. That
 * is safe for a re-sync of the SAME account -- a token refresh, a replayed
 * event -- where the workspace already on file still belongs to the session.
 *
 * It is not safe when the account CHANGES. Publishing the new session while
 * leaving `status: 'signed-in'` and the previous account's workspace in place
 * produces a hybrid the app has no honest reading of: the guard that holds the
 * app only holds on 'loading', so the old account's records stay interactive
 * under the new identity, and a workspace-scoped write carries the old
 * workspace id with the new access token. If the profile request then hangs,
 * that state persists for as long as the hang does.
 *
 * So an identity change retires the workspace with it and says the one true
 * thing: who is here is known, what they can see is not yet.
 *
 * A previously signed-out browser has no previous id, which counts as a change
 * -- there is nothing to keep.
 */
export type IdentityPublication = {
  workspaceReady: false;
  status?: 'loading';
  workspaceId?: '';
  workspaceRole?: 'Owner';
};

export function identityPublication(previousUserId: string, nextUserId: string): IdentityPublication {
  if (previousUserId && previousUserId === nextUserId) return { workspaceReady: false };
  return { workspaceReady: false, status: 'loading', workspaceId: '', workspaceRole: 'Owner' };
}
