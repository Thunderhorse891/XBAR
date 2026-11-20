import React from 'react';
import { createRoot } from 'react-dom/client';
import CopilotDemo from './routes/CopilotDemo';
import './styles/brandTokens.css';
import './index.css';
import './styles/xbarSaas.css';

// Standalone synthetic preview: deliberately no App, cloud bootstrap, stores, APIs or billing.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CopilotDemo />
  </React.StrictMode>,
);
