import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CloudBootstrap } from './components/CloudBootstrap';
import ErrorBoundary from './components/ErrorBoundary';
import { InteractionBootstrap } from './components/InteractionBootstrap';
import { registerGlobalErrorHandlers } from './lib/globalErrorHandlers';
import { registerOfflineRuntime } from './lib/offlineRuntime';
import { appBasePath, hashAuthFailureRoute, usesHashRouting } from './lib/routeCanon';
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
 * A rejected recovery link under the hash router comes back as `#error=...`,
 * which the router would read as a path and answer with the not-found screen.
 * Put the reset route there instead, BEFORE the router is created, so the
 * customer gets the expired-link guidance and a way back to sign-in.
 * `hashAuthFailureRoute` leaves a successful callback's fragment untouched.
 */
if (usesHashRouting()) {
  const failureRoute = hashAuthFailureRoute(window.location.hash);
  if (failureRoute) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${failureRoute}`);
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found.');

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
