export type OfflineRuntimeStatus = 'unsupported' | 'ready' | 'registered' | 'failed';

const SERVICE_WORKER_URL = '/xbar-service-worker.js?v=20260630-vercel-freshness';
let refreshQueued = false;

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

export function urlCarriesAuthCallback(href: string): boolean {
  let url: URL;
  try {
    url = new URL(href, 'http://localhost');
  } catch {
    // An unparseable URL is not evidence that a credential is present, and
    // refusing every refresh on it would be a worse answer than allowing one.
    return false;
  }
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  if (AUTH_CALLBACK_FRAGMENT_PARAMS.some((name) => fragment.has(name))) return true;
  return url.searchParams.has('code');
}

// Module state, so a test can put the latch back the way it found it.
export function resetOfflineRuntime() {
  refreshQueued = false;
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
    const hadController = Boolean(navigator.serviceWorker.controller);
    const beganOnAuthCallback = urlCarriesAuthCallback(window.location.href);

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshQueued) return;
      if (!hadController) return;
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
      if (beganOnAuthCallback || urlCarriesAuthCallback(window.location.href)) return;
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
