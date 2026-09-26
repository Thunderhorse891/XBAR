import * as Sentry from '@sentry/react';
import { sanitizeEvent } from '../../api/_lib/monitoring-privacy.js';
const enabled = Boolean(import.meta.env.VITE_SENTRY_DSN);
if (enabled)
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
      frameContextLines: 0,
      databaseQueryData: false,
      queues: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
    },
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    beforeSend: sanitizeEvent,
  });
export function captureUiError(error: unknown) {
  if (enabled) Sentry.captureException(error);
}
