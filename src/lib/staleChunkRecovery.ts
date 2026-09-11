import { urlCarriesAuthCallback } from './offlineRuntime.js';

/*
 * Recovering a route whose code no longer exists on the server.
 *
 * Routes are lazy (35 of them, 94 built chunks), so a document fetches route
 * code for as long as it stays open. Chunk filenames are content-hashed, so a
 * deploy replaces them -- and `public/xbar-service-worker.js` is network-first
 * for `/assets/`, returning whatever the network says. A 404 for a chunk the
 * running document still believes in is returned AS IS: the handler only
 * consults the cache in its `.catch`, which a 404 response does not reach. The
 * dynamic import then fails and the route renders nothing.
 *
 * The service worker's `controllerchange` reload is the usual cure, and
 * `offlineRuntime.ts` withholds it from a document that arrived on an auth
 * callback, because a reload there can land between auth-js clearing the URL
 * fragment and the session being saved, destroying a one-time link.
 *
 * TWO CONDITIONS GATE THE RELOAD HERE, and an earlier version of this file had
 * neither. Both were found in review and both were right:
 *
 *   1. The loop marker must be RETAINABLE. Where sessionStorage throws -- a
 *      private window, blocked site data -- the write silently failed and the
 *      read always said "not yet reloaded", so a chunk that was genuinely
 *      missing reloaded every fresh document forever. The earlier comment
 *      claimed losing the marker "only costs one extra reload"; that was simply
 *      wrong, and an unbounded reload loop is worse than the staleness this
 *      exists to cure. The marker is now written and READ BACK, and a marker
 *      that cannot be retained refuses the reload outright.
 *
 *   2. The callback must have SETTLED. The earlier version argued that a reload
 *      here "cannot be premature by construction, because the route has already
 *      failed". That reasoning only considered the UI: the reset route is itself
 *      lazy, so its chunk can fail while auth-js is still consuming an
 *      implicit-flow fragment, and a reload in that window leaves the token in
 *      neither the URL nor storage and burns the link. A failed route is not
 *      evidence that nothing else is in flight.
 */

/* Every engine words this differently; all of them mean the module never arrived. */
const CHUNK_FAILURE_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /chunkloaderror/i, // bundler-generated
];

export function isChunkLoadFailure(error: unknown): boolean {
  if (error === null || error === undefined) return false;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return CHUNK_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

export type StaleChunkDecision = 'reload' | 'rethrow' | 'wait';

/**
 * Whether to reload, kept pure so every rule can be tested without a browser.
 *
 * Order is the meaning. A non-chunk error is never ours. A document that has
 * already reloaded does not reload again -- if the fresh one still cannot fetch
 * the chunk, staleness was not the cause and looping would never show the
 * customer an error they could act on. A marker that cannot be retained is the
 * same risk with no way to count, so it refuses rather than gambles. Only then
 * does an unsettled callback hold the reload back, and that one is 'wait'
 * rather than 'rethrow' because it resolves on its own in a moment.
 */
export function decideStaleChunkReload(input: {
  error: unknown;
  alreadyReloaded: boolean;
  markerRetainable: boolean;
  authCallbackSettled: boolean;
}): StaleChunkDecision {
  if (!isChunkLoadFailure(input.error)) return 'rethrow';
  if (input.alreadyReloaded) return 'rethrow';
  if (!input.markerRetainable) return 'rethrow';
  if (!input.authCallbackSettled) return 'wait';
  return 'reload';
}

const RELOAD_MARKER = 'xbar-stale-chunk-reload';

/* How long a chunk failure will wait for an auth callback to finish persisting
 * before giving the customer the error instead. Generous: the callback is one
 * network round trip and a synchronous write. */
export const AUTH_SETTLE_ATTEMPTS = 20;
export const AUTH_SETTLE_INTERVAL_MS = 250;

function hasReloaded(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(RELOAD_MARKER) === 'yes';
  } catch {
    return false;
  }
}

/*
 * Writes the marker and CONFIRMS it, because a silent failure here is what
 * turns one reload into an endless sequence of them. Blocked site data throws
 * on access; a full quota accepts the call and stores nothing.
 */
function markReloaded(): boolean {
  try {
    if (typeof sessionStorage === 'undefined') return false;
    sessionStorage.setItem(RELOAD_MARKER, 'yes');
    return sessionStorage.getItem(RELOAD_MARKER) === 'yes';
  } catch {
    return false;
  }
}

function clearReloaded() {
  try {
    sessionStorage?.removeItem(RELOAD_MARKER);
  } catch {
    // Non-fatal: at worst this tab forgoes a later recovery.
  }
}

/*
 * Whether a credential this document arrived with is safely on disk.
 *
 * Read once, at module evaluation: App.tsx imports this, and ES imports run
 * before main.tsx's own module body, so the URL still carries the original
 * fragment here -- before auth-js consumes it and before main.tsx rewrites a
 * rejected callback. That is exactly the instant the question is asked about.
 */
export const beganOnAuthCallback = typeof window !== 'undefined' && urlCarriesAuthCallback(window.location.href);

/*
 * Whether the credential is on disk yet, supplied from outside.
 *
 * Injected rather than imported so this module does not depend on the Supabase
 * client, which would pull the whole client chain into anything that loads a
 * route. `main.tsx` installs the real probe.
 *
 * The default REFUSES to call a callback settled, so a document that arrived on
 * one recovers only once something has actually vouched for the session. If the
 * probe is never installed, such a document simply keeps the behaviour it had
 * before any of this existed: no reload, and the error surfaces.
 */
let settledProbe: () => boolean = () => !beganOnAuthCallback;

export function setAuthCallbackSettledProbe(probe: () => boolean) {
  settledProbe = probe;
}

function authCallbackSettled(): boolean {
  return !beganOnAuthCallback || settledProbe();
}

export type StaleChunkEnvironment = {
  hasReloaded: () => boolean;
  markReloaded: () => boolean;
  clearReloaded: () => void;
  reload: () => void;
  authCallbackSettled: () => boolean;
  wait: (ms: number) => Promise<void>;
};

const browserEnvironment: StaleChunkEnvironment = {
  hasReloaded,
  markReloaded,
  clearReloaded,
  reload: () => window.location.reload(),
  authCallbackSettled,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Wraps a `lazy()` factory so a stale chunk reloads the document once.
 *
 * On success the marker is cleared, so a tab that recovered from one deploy can
 * recover from the next as well rather than being allowed a single reload for
 * its whole life.
 */
export function withStaleChunkRecovery<T>(
  factory: () => Promise<T>,
  environment: StaleChunkEnvironment = browserEnvironment,
  attempts: number = AUTH_SETTLE_ATTEMPTS,
  intervalMs: number = AUTH_SETTLE_INTERVAL_MS,
): () => Promise<T> {
  return () =>
    factory().then(
      (loaded) => {
        environment.clearReloaded();
        return loaded;
      },
      async (error: unknown) => {
        for (let remaining = attempts; remaining > 0; remaining -= 1) {
          const decision = decideStaleChunkReload({
            error,
            alreadyReloaded: environment.hasReloaded(),
            markerRetainable: true,
            authCallbackSettled: environment.authCallbackSettled(),
          });
          if (decision === 'rethrow') throw error;
          if (decision === 'reload') {
            // Retainability is proven by writing, not predicted, so the marker
            // is committed before the decision to reload is final.
            if (!environment.markReloaded()) throw error;
            environment.reload();
            /*
             * Never settles on purpose. The document is being replaced, and
             * resolving or rejecting here would render a flash of the error
             * screen over a page that is already on its way out.
             */
            return new Promise<T>(() => {});
          }
          await environment.wait(intervalMs);
        }
        // The callback never finished persisting. Showing the error is the
        // conservative end: a reload now could still burn the link.
        throw error;
      },
    );
}
