import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CloudBootstrap } from './components/CloudBootstrap';
import ErrorBoundary from './components/ErrorBoundary';
import { InteractionBootstrap } from './components/InteractionBootstrap';
import { registerOfflineRuntime } from './lib/offlineRuntime';
import { initScrollReveal } from './lib/scrollReveal';
import './index.css';
import './premiumCommandCenter.css';
import './mobilePolish.css';
import './linearConcept.css';
import './revolutionaryExperience.css';
// XBAR design system — imported last so it is the final authority for the app shell.
import './styles/xbarSystem.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error("Root element not found.");

void registerOfflineRuntime();

if (typeof window !== 'undefined') {
  const startReveal = () => initScrollReveal();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startReveal, { once: true });
  } else {
    startReveal();
  }
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <CloudBootstrap />
      <InteractionBootstrap />
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
