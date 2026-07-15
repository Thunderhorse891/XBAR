import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CloudBootstrap } from './components/CloudBootstrap';
import ErrorBoundary from './components/ErrorBoundary';
import { InteractionBootstrap } from './components/InteractionBootstrap';
import { registerGlobalErrorHandlers } from './lib/globalErrorHandlers';
import { registerOfflineRuntime } from './lib/offlineRuntime';
import { appBasePath } from './lib/routeCanon';
import './index.css';
import './mobilePolish.css';

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
