import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CloudBootstrap } from './components/CloudBootstrap';
import ErrorBoundary from './components/ErrorBoundary';
import { InteractionBootstrap } from './components/InteractionBootstrap';
import { registerGlobalErrorHandlers } from './lib/globalErrorHandlers';
import { applyNativeShellFlags, isNativeApp } from './lib/nativeRuntime';
import { registerOfflineRuntime } from './lib/offlineRuntime';
import { appBasePath } from './lib/routeCanon';
import './index.css';
import './mobilePolish.css';
import './styles/nativeShell.css';

// Must run before the first paint so the shell is laid out inside the safe
// area on the very first frame instead of jumping once React mounts.
applyNativeShellFlags();

// The application router lives under /app (see routeCanon.appBasePath). In
// production the app shell is only ever served on /app/* (vercel.json), but
// the dev server serves it on every path — normalize so deep links like
// /horses/123 opened against the dev server land on /app/horses/123 instead
// of a blank screen. Hash routing (GitHub Pages previews) is exempt.
const usesHashRouting =
  import.meta.env.MODE !== 'e2e' &&
  (import.meta.env.VITE_ROUTER_MODE === 'hash' || window.location.hostname.endsWith('.github.io'));
if (!usesHashRouting && !window.location.pathname.startsWith(appBasePath)) {
  const { pathname, search, hash } = window.location;
  window.location.replace(`${appBasePath}${pathname === '/' ? '' : pathname}${search}${hash}`);
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found.');

registerGlobalErrorHandlers();
// The native binary already ships every asset inside the app bundle, and a
// service worker layered under Capacitor's local server is a known source of
// stale-asset bugs after an app update. The offline runtime is web-only.
if (!isNativeApp()) {
  void registerOfflineRuntime();
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CloudBootstrap />
      <InteractionBootstrap />
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
