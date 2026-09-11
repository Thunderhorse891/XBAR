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
 * Nor may such an event merely be HELD until the bootstrap finishes, which is
 * what this used to say. The bootstrap is waiting on a workspace request for
 * an account that has already been replaced, and that request can hang: the
 * new session's own profile would not even be REQUESTED until the obsolete one
 * settled, so the app sat on its loading screen for as long as a request
 * nobody needed took. It supersedes instead -- the bootstrap's in-flight write
 * is retired and this event is applied at once.
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
  | 'supersede' // Bootstrap is still running and this replaces it: retire its write and apply this now.
  | 'ignore'; // Says nothing the first sync is not already about to say.

export function bootstrapEventDisposition(input: BootstrapEventInput): BootstrapEventDisposition {
  if (input.bootstrapped) return 'apply';
  return input.event === 'INITIAL_SESSION' ? 'ignore' : 'supersede';
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

type AuthSessionLike = { access_token?: string } | null;

/*
 * Does this tab's OWN session store agree with what an auth event says?
 *
 * Only asked when the store is not shared between tabs. auth-js picks its
 * storage once: shared when it can, otherwise one private to the tab. With a
 * private store the tabs still share a BroadcastChannel but NOT a session, and
 * the receiving tab's handler is `_notifyAllSubscribers(event, session, false)`
 * -- it notifies, it does not save. So the payload describes the tab that SENT
 * it, and this tab's own store is the only authority on this tab.
 *
 * Believing the payload had two consequences that pull in opposite directions,
 * which is why one rule replaced two guesses:
 *
 *   - a sign-in broadcast for account B replaced account A in the store while
 *     every request from that tab still carried A's token -- B's identity over
 *     A's workspace, and writes aimed at the wrong account;
 *   - and ignoring every sign-out to avoid that left the store signed in and
 *     autosaving after auth-js had discarded the session itself, which it does
 *     on a refresh it cannot complete.
 *
 * The stored record answers both. A sign-out is this tab's only if the store
 * really holds no session; a session-bearing event is this tab's only if the
 * store holds that same session. Sessions are compared by GENERATION rather
 * than by credential, because auth-js rotates the access token underneath a
 * session that has not otherwise changed.
 *
 * Deliberately SYNCHRONOUS, and reading rather than asking. `getSession()` from
 * inside an auth callback deadlocks: the operation holding auth-js's lock is
 * pushed into the same `pendingInLock` queue that a nested `_acquireLock`
 * awaits, so the nested call waits on the operation that is waiting for the
 * callback to return. `lib/authStorage.ts` exists so the record can simply be
 * read instead.
 */
export function liveSessionAgrees(
  storedSession: string | null,
  eventSession: AuthSessionLike,
  generationOf: (session: AuthSessionLike) => string,
): boolean {
  let stored: AuthSessionLike = null;
  if (storedSession) {
    try {
      const parsed: unknown = JSON.parse(storedSession);
      if (parsed && typeof parsed === 'object') {
        const record = parsed as { access_token?: unknown; currentSession?: { access_token?: unknown } };
        const token = record.currentSession?.access_token ?? record.access_token;
        if (typeof token === 'string' && token) stored = { access_token: token };
      }
    } catch {
      // An unparseable record names no session, which is not agreement with one.
      stored = null;
    }
  }
  if (!eventSession) return !stored;
  if (!stored) return false;
  const storedGeneration = generationOf(stored);
  const eventGeneration = generationOf(eventSession);
  if (storedGeneration && eventGeneration) return storedGeneration === eventGeneration;
  return Boolean(stored.access_token) && stored.access_token === eventSession.access_token;
}

/*
 * How many times, and how often, a disagreeing session-bearing event is
 * re-checked before it is finally treated as stale. A cross-process storage
 * write becomes visible in well under a tick; this is deliberately generous
 * and still bounded.
 */
export const STORAGE_CATCH_UP_ATTEMPTS = 5;
export const STORAGE_CATCH_UP_INTERVAL_MS = 50;

export type StorageCatchUp = {
  /** Stop every re-check still pending. Safe to call more than once. */
  cancel: () => void;
};

/**
 * Wait for this tab's view of storage to catch up before dropping an event.
 *
 * The auth listener decides whether an event is stale by asking whether the
 * session auth-js has STORED agrees with it. That is the right question and it
 * has one wrong answer: localStorage is NOT synchronously coherent across
 * renderer processes, so another tab's `SIGNED_IN` BroadcastChannel message can
 * arrive here BEFORE the write it describes is visible to this renderer. The
 * read then reports the previous account, the perfectly good newer event is
 * dropped, and the tab never switches accounts or hydrates until it reloads.
 *
 * Reproduced 2 times in 120 instrumented runs, with the same trace both times:
 *
 *   STORE     sub=0001
 *   BROADCAST event=SIGNED_IN eventSub=0002 storedSub=0001
 *
 * A stale read can only ever show something OLDER than reality -- it cannot
 * invent a session that was never stored. So disagreement means either "this
 * event is stale" or "this read is behind", and only time tells them apart.
 * Re-reading a few times costs nothing and decides it.
 *
 * This never widens what is accepted: an event that is genuinely superseded
 * disagrees on every attempt, because storage really does hold the newer
 * session, and it is dropped exactly as before. Ordering is unaffected too --
 * a late replay still takes its ticket from the same write gate, so a newer
 * event that arrived meanwhile retires it.
 */
export function waitForStorageCatchUp(
  agrees: () => boolean,
  apply: () => void,
  schedule: (run: () => void, delayMs: number) => unknown,
  cancelScheduled: (handle: unknown) => void,
  attempts: number = STORAGE_CATCH_UP_ATTEMPTS,
  intervalMs: number = STORAGE_CATCH_UP_INTERVAL_MS,
): StorageCatchUp {
  let handle: unknown = null;
  let remaining = attempts;
  let done = false;

  const attempt = () => {
    handle = null;
    if (done) return;
    if (agrees()) {
      done = true;
      apply();
      return;
    }
    remaining -= 1;
    if (remaining <= 0) {
      // Storage never caught up, so the event really had been superseded.
      done = true;
      return;
    }
    handle = schedule(attempt, intervalMs);
  };

  handle = schedule(attempt, intervalMs);

  return {
    cancel: () => {
      done = true;
      if (handle !== null) {
        cancelScheduled(handle);
        handle = null;
      }
    },
  };
}
