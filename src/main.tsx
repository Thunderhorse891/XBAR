import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CloudBootstrap } from './components/CloudBootstrap';
import ErrorBoundary from './components/ErrorBoundary';
import { InteractionBootstrap } from './components/InteractionBootstrap';
import { registerOfflineRuntime } from './lib/offlineRuntime';
import './index.css';
import './mobilePolish.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found.');

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
