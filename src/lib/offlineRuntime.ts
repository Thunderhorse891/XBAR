export type OfflineRuntimeStatus = 'unsupported' | 'ready' | 'registered' | 'failed';

const SERVICE_WORKER_URL = '/xbar-service-worker.js?v=20260630-vercel-freshness';
let refreshQueued = false;

/*
 * How long a page that began on an auth callback stays exempt from the
 * takeover reload.
 *
 * The exemption has to outlive the URL -- clearing the fragment is not evidence
 * that auth-js has finished persisting the session, which is why the flag
 * exists at all. But it was never given an end, so a tab that once opened a
 * recovery or confirmation link stayed exempt for the rest of its life: a
 * deployment shipped an hour later claimed the page, this guard skipped the
 * reload, and the tab kept running the old bundle until its next lazy import
 * asked for a chunk that deployment had removed.
 *
 * The true end of the risky window is the session reaching storage, and nothing
 * here can observe that, so this is a bound rather than a measurement. Sixty
 * seconds is roughly an order of magnitude more than the sequence needs -- one
 * network call, a fragment clear, a storage write -- and a deployment landing
 * inside that window simply misses one reload, which the next navigation
 * corrects.
 */
const AUTH_CALLBACK_EXEMPTION_MS = 60_000;

let clock: () => number = () => Date.now();

/*
 * The parameters Supabase puts in a redirect it sends a customer back on.
 *
 * The implicit flow returns them in the FRAGMENT and PKCE returns `code` in the
 * query, so both halves are checked. auth-js clears the fragment by assigning
 * `window.location.hash = ''`, which leaves a bare '#' and no parameters -- so
 * this stops being true the moment the credential is no longer in the URL.
 * The reload guard must retain that earlier callback state because URL cleanup
 * is not evidence that auth-js has finished persisting the session.
 */
const AUTH_CALLBACK_FRAGMENT_PARAMS = [
  'access_token',
  'refresh_token',
  'provider_token',
  'error',
  'error_code',
  'error_description',
];

/*
 * And the shape a REJECTED callback has by the time this runs.
 *
 * The parameters above are what Supabase sends, which is not what is in the URL
 * when `registerOfflineRuntime()` is called: `main.tsx` rewrites `#error=...`
 * into a readable `authError` FIRST, at module scope, and registers the worker
 * afterwards. So the fragment this looked for had already been replaced --
 * `/app/login?authError=otp_expired` under the browser router,
 * `/app/#/login?authError=otp_expired` under the hash one -- and both read as
 * "not a callback". Measured on the four shapes: the two Supabase sends match,
 * the two that actually exist at registration did not.
 *
 * A rejected callback holds no credential to destroy, so the reason to keep the
 * reload away from it is a different one -- the failure reason is the only
 * record of what went wrong, and it is consumed and removed from the URL as
 * soon as the screen shows it. A worker takeover reload landing after that
 * returns an ordinary sign-in form with no explanation at all, and nothing is
 * left anywhere to reconstruct one from.
 */
function carriesAuthFailureReason(params: URLSearchParams): boolean {
  return params.has('authError');
}

export function urlCarriesAuthCallback(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, 'http://localhost');
  } catch {
    // An unparseable URL is not evidence that a credential is present, and
    // refusing every refresh on it would be a worse answer than allowing one.
    return false;
  }
  const hash = url.hash.replace(/^#/, '');
  const fragment = new URLSearchParams(hash);
  if (AUTH_CALLBACK_FRAGMENT_PARAMS.some((name) => fragment.has(name))) return true;
  if (carriesAuthFailureReason(url.searchParams)) return true;
  /*
   * Under the hash router the fragment IS the route, so the rewritten reason
   * lives in a query string of its own INSIDE the hash (`#/login?authError=...`)
   * and the parse above sees one oddly named parameter rather than a query.
   */
  const hashQuery = hash.indexOf('?');
  if (hashQuery >= 0 && carriesAuthFailureReason(new URLSearchParams(hash.slice(hashQuery + 1)))) return true;
  return url.searchParams.has('code');
}

// Module state, so a test can put the latch back the way it found it.
export function resetOfflineRuntime(options?: { now?: () => number }) {
  refreshQueued = false;
  clock = options?.now ?? (() => Date.now());
}

export async function registerOfflineRuntime(): Promise<OfflineRuntimeStatus> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }

  try {
    /*
     * Whether this document was ALREADY being served by a worker, read BEFORE
     * the registration below can change the answer.
     *
     * This is what makes a 'controllerchange' meaningful. The worker installs
     * with skipWaiting() and activates with clients.claim(), so on every load
     * with no prior controller -- a first visit, a cleared cache, a private
     * window -- the brand new worker claims this page and the event fires.
     * Reloading on that is a reload of a document that is already current:
     * there is no older asset to replace, because there was no worker serving
     * it. Only a worker taking over FROM another one leaves this page running
     * code the worker no longer agrees with, and only that is worth a refresh.
     *
     * This was measured, not reasoned about. With the reload unconditional, a
     * first visit reloaded roughly 200ms in, and in 10 of 12 runs that reload
     * aborted the `GET /auth/v1/user` that auth-js makes from inside
     * `_getSessionFromURL` -- the single call that turns the token in a
     * recovery or magic link into a session.
     */
    let hadController = Boolean(navigator.serviceWorker.controller);
    const beganOnAuthCallback = urlCarriesAuthCallback(window.location.href);
    const authCallbackAt = beganOnAuthCallback ? clock() : 0;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshQueued) return;
      /*
       * The FIRST claim on an uncontrolled page, and only the first.
       *
       * A page that loaded without a controller cannot be served anything
       * staler than what it already has, so that claim is not a reason to
       * reload. Left false for the document's lifetime, though, this also
       * swallowed every genuine takeover afterwards: the tab stayed on the
       * runtime it booted with while a new deployment removed the chunks its
       * lazy routes were still going to ask for. The page is controlled now,
       * so say so.
       */
      if (!hadController) {
        hadController = true;
        return;
      }
      /*
       * Never reload a document that is still holding a one-time credential.
       *
       * auth-js consumes an implicit-flow link in this order: await
       * `_getUser(access_token)` over the network, build the session, clear the
       * fragment with `window.location.hash = ''`, and only THEN hand the
       * session back to be saved. A reload landing anywhere in that sequence
       * either aborts the network call or -- in the window after the fragment
       * is cleared and before the session is stored -- destroys the credential
       * outright: nothing left in the URL, nothing yet in storage. The link is
       * one-time, so the customer cannot retry it; they have to ask for another
       * email.
       *
       * Skipping the refresh costs nothing in comparison. The updated worker
       * still controls the next navigation.
       */
      if (urlCarriesAuthCallback(window.location.href)) return;
      if (beganOnAuthCallback && clock() - authCallbackAt < AUTH_CALLBACK_EXEMPTION_MS) return;
      refreshQueued = true;
      window.location.reload();
    });

    const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { updateViaCache: 'none' });
    await registration.update();
    return registration.active || registration.waiting || registration.installing ? 'registered' : 'ready';
  } catch {
    return 'failed';
  }
}

export function isBrowserOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}
