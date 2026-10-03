import * as Sentry from '@sentry/node';
import { sanitizeEvent } from './monitoring-privacy.js';
const enabled = Boolean(process.env.SENTRY_DSN);
if (enabled)
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
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
    environment: process.env.VERCEL_ENV || 'development',
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    defaultIntegrations: false,
    beforeSend: sanitizeEvent,
  });

export function withErrorTracking(handler, name) {
  return async (req, res) => {
    try {
      await handler(req, res);
      if (enabled && res.statusCode >= 500) Sentry.captureException(new Error(`API failure: ${name}`));
    } catch (error) {
      if (enabled) Sentry.captureException(error);
      if (!res.headersSent && !res.writableEnded) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, message: 'The request could not be completed.' }));
      }
    } finally {
      if (enabled) await Sentry.flush(1500);
    }
  };
}
