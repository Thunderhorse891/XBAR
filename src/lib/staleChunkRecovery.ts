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
 * `offlineRuntime.ts` deliberately withholds it from a document that arrived on
 * an auth callback -- a reload there can land between auth-js clearing the URL
 * fragment and the session being saved, destroying a one-time link. That
 * protection is right and stays; the consequence Codex identified is that such
 * a document opts out of staleness recovery for the rest of its life.
 *
 * So recovery moves to where the damage actually shows up. Reloading because a
 * chunk 404'd cannot be premature by construction: the route has already failed,
 * so there is nothing left to interrupt -- unlike a speculative reload, which on
 * the reset screen would throw away a password the customer was typing.
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

/**
 * Whether to reload, kept pure so the rule can be tested without a browser.
 *
 * One reload per attempt, and no more. If the fresh document ALSO cannot load
 * the chunk the cause is not staleness -- the asset is genuinely missing, or the
 * network is failing -- and reloading again would spin the customer in a loop
 * that never renders an error. The second failure is rethrown so the error
 * boundary can say something true instead.
 */
export function decideStaleChunkReload(input: { error: unknown; alreadyReloaded: boolean }): 'reload' | 'rethrow' {
  if (!isChunkLoadFailure(input.error)) return 'rethrow';
  return input.alreadyReloaded ? 'rethrow' : 'reload';
}

const RELOAD_MARKER = 'xbar-stale-chunk-reload';

/*
 * sessionStorage, because the marker has to survive the very reload it
 * describes and must not outlive the tab. Blocked site data throws on access
 * rather than returning null, and losing the marker only costs one extra
 * reload, so every path here swallows.
 */
function hasReloaded(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(RELOAD_MARKER) === 'yes';
  } catch {
    return false;
  }
}

function markReloaded() {
  try {
    sessionStorage?.setItem(RELOAD_MARKER, 'yes');
  } catch {
    // Non-fatal: without the marker a second failure reloads once more.
  }
}

function clearReloaded() {
  try {
    sessionStorage?.removeItem(RELOAD_MARKER);
  } catch {
    // Non-fatal.
  }
}

export type StaleChunkEnvironment = {
  hasReloaded: () => boolean;
  markReloaded: () => void;
  clearReloaded: () => void;
  reload: () => void;
};

const browserEnvironment: StaleChunkEnvironment = {
  hasReloaded,
  markReloaded,
  clearReloaded,
  reload: () => window.location.reload(),
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
): () => Promise<T> {
  return () =>
    factory().then(
      (loaded) => {
        environment.clearReloaded();
        return loaded;
      },
      (error: unknown) => {
        if (decideStaleChunkReload({ error, alreadyReloaded: environment.hasReloaded() }) === 'rethrow') {
          throw error;
        }
        environment.markReloaded();
        environment.reload();
        /*
         * Never settles on purpose. The document is being replaced, and
         * resolving or rejecting here would render a flash of the error screen
         * over a page that is already on its way out.
         */
        return new Promise<T>(() => {});
      },
    );
}
