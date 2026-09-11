import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CloudBootstrap } from './components/CloudBootstrap';
import ErrorBoundary from './components/ErrorBoundary';
import { InteractionBootstrap } from './components/InteractionBootstrap';
import { registerGlobalErrorHandlers } from './lib/globalErrorHandlers';
import { registerOfflineRuntime } from './lib/offlineRuntime';
import { setAuthCallbackSettledProbe } from './lib/staleChunkRecovery';
import { readAuthStorage } from './lib/authStorage';
import { authStorageKey } from './lib/supabaseClient';
import { appBasePath, browserAuthFailureSearch, hashAuthFailureRoute, usesHashRouting } from './lib/routeCanon';
import './index.css';
import './styles/motion.css';
import './mobilePolish.css';

// The application router lives under /app (see routeCanon.appBasePath). In
// production the app shell is only ever served on /app/* (vercel.json), but
// the dev server serves it on every path — normalize so deep links like
// /horses/123 opened against the dev server land on /app/horses/123 instead
// of a blank screen. Hash routing (GitHub Pages previews) is exempt.
if (!usesHashRouting() && !window.location.pathname.startsWith(appBasePath)) {
  const { pathname, search, hash } = window.location;
  window.location.replace(`${appBasePath}${pathname === '/' ? '' : pathname}${search}${hash}`);
}

/*
 * A rejected callback -- an expired link, a cancelled OAuth consent -- comes
 * back as `#error=...`, which auth-js leaves in place while emitting nothing.
 * Both routers need it moved somewhere a screen can read, for different
 * reasons, and both are done BEFORE the router is created.
 *
 * Under the HASH router the fragment IS the route, so it is replaced outright
 * or the customer meets the not-found screen. Under the BROWSER router nothing
 * is unreachable -- but nothing reads the fragment either, so the customer got
 * an ordinary sign-in form with no hint that anything had failed. There the
 * PATH is left exactly where Supabase sent them and only the reason moves, so
 * a failed recovery link still lands on the reset screen with its own
 * expired-link guidance.
 *
 * Both helpers leave a SUCCESSFUL callback's fragment untouched.
 */
if (usesHashRouting()) {
  const failureRoute = hashAuthFailureRoute(window.location.hash);
  if (failureRoute) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${failureRoute}`);
  }
} else {
  const failureSearch = browserAuthFailureSearch(window.location.hash, window.location.search);
  if (failureSearch) {
    window.history.replaceState(null, '', `${window.location.pathname}${failureSearch}`);
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found.');

/*
 * Tells the lazy-route recovery when a credential this document arrived with is
 * safely stored. Installed here because the Supabase client lives here, not in
 * the recovery module, and BEFORE the first route can fail.
 */
setAuthCallbackSettledProbe(() => {
  const key = authStorageKey();
  // Supabase unconfigured: there is no credential in flight to lose.
  if (!key) return true;
  return Boolean(readAuthStorage(key));
});

registerGlobalErrorHandlers();
void registerOfflineRuntime();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CloudBootstrap />
      <InteractionBootstrap />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
