import test from 'node:test';
import assert from 'node:assert/strict';

test('outbound error events omit identity, tokens, bodies, breadcrumbs and raw error text', async () => {
  const { sanitizeEvent } = await import('../../api/_lib/monitoring-privacy.js');
  const event = sanitizeEvent({
    event_id: 'id',
    user: { email: 'secret@example.invalid' },
    request: { url: 'https://a/?token=secret' },
    extra: { secret: 'secret' },
    breadcrumbs: [{ message: 'secret' }],
    message: 'secret',
    exception: {
      values: [
        {
          type: 'Error',
          value: 'secret',
          stacktrace: { frames: [{ filename: 'https://x/app?token=secret', vars: { secret: 'secret' } }] },
        },
      ],
    },
  });
  assert.doesNotMatch(JSON.stringify(event), /secret|token|email/);
  assert.equal(event.exception.values[0].type, 'Error');
});
test('cron completion is recorded only for successful authorized handler outcomes', async () => {
  const { withCronHeartbeat } = await import('../../api/_lib/cron-heartbeat.js');
  let writes = 0;
  const write = async () => {
    writes++;
  };
  for (const status of [401, 403, 405, 500]) {
    const handler = withCronHeartbeat(
      'run',
      async (_req, res) => {
        res.statusCode = status;
        res.end('{"ok":false}');
      },
      write,
    );
    await handler({}, { end() {} });
  }
  assert.equal(writes, 0);
  await withCronHeartbeat(
    'run',
    async (_req, res) => {
      res.statusCode = 200;
      res.end('{"ok":true,"failures":[{}]}');
    },
    write,
  )({}, { end() {} });
  assert.equal(writes, 0);
  await withCronHeartbeat(
    'run',
    async (_req, res) => {
      res.statusCode = 200;
      res.end('{"ok":true,"failures":[]}');
    },
    write,
  )({}, { end() {} });
  assert.equal(writes, 1);
});
test('watchdog refuses missing, stale, future and failed cron records', async () => {
  const { healthyCron } = await import('../../scripts/production-monitor.mjs');
  const now = Date.now();
  assert.equal(healthyCron({ completedAt: now - 1000 }, now), true);
  for (const value of [
    null,
    {},
    { completedAt: now + 1 },
    { completedAt: now - 27 * 3600000 },
    { completedAt: 'bogus' },
  ])
    assert.equal(healthyCron(value, now), false);
});

test('both real cron routes retain method/auth gates; unknown routes cannot write a heartbeat', async () => {
  const { default: handler } = await import('../../api/reminders/[action].js');
  process.env.CRON_SECRET = 'fixture-secret';
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw Error('unauthorized route attempted external IO');
  };
  try {
    for (const action of ['run', 'trial-reminders'])
      for (const [method, status] of [
        ['GET', 401],
        ['DELETE', 405],
      ]) {
        const res = {
          setHeader() {},
          end(body) {
            this.body = JSON.parse(body);
          },
        };
        await handler({ method, headers: { authorization: 'Bearer incorrect' }, query: { action } }, res);
        assert.equal(res.statusCode, status);
      }
    const res = { setHeader() {}, end() {} };
    await handler(
      { method: 'GET', headers: { authorization: 'Bearer fixture-secret' }, query: { action: 'unknown' } },
      res,
    );
    assert.equal(res.statusCode, 404);
  } finally {
    globalThis.fetch = original;
    delete process.env.CRON_SECRET;
  }
});

test('real Sentry SDK emits sanitized server errors and preserves handled responses', async () => {
  const Sentry = await import('@sentry/node');
  const previousDsn = process.env.SENTRY_DSN;
  const previousClient = Sentry.getClient();
  process.env.SENTRY_DSN = 'https://fixture@example.invalid/1';
  const envelopes = [];
  try {
    const { withErrorTracking } = await import('../../api/_lib/error-tracking.js?transport-regression');
    const options = Sentry.getClient().getOptions();
    // Exercise the actual SDK and production privacy hook, substituting only
    // delivery. This test never contacts Sentry or needs an owner's DSN.
    Sentry.init({
      ...options,
      transport: () => ({
        send: async (envelope) => {
          envelopes.push(envelope);
          return { statusCode: 200 };
        },
        flush: async () => true,
      }),
    });
    const response = () => ({
      setHeader() {},
      end(body) {
        this.body = body;
        this.writableEnded = true;
      },
    });
    const denied = response();
    await withErrorTracking(async (_req, res) => {
      res.statusCode = 401;
      res.end('existing unauthorized response');
    }, 'fixture')({}, denied);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.body, 'existing unauthorized response');
    assert.equal(envelopes.length, 0);

    const thrown = response();
    await withErrorTracking(async () => {
      throw new Error('secret@example.invalid token=customer-secret');
    }, 'fixture')({}, thrown);
    assert.equal(thrown.statusCode, 500);
    assert.equal(JSON.parse(thrown.body).ok, false);
    assert.equal(envelopes.length, 1);
    assert.doesNotMatch(JSON.stringify(envelopes), /customer-secret|secret@example/);
    assert.match(JSON.stringify(envelopes), /Application error \(details omitted\)/);

    const failed = response();
    await withErrorTracking(async (_req, res) => {
      res.statusCode = 503;
      res.end('existing service unavailable response');
    }, 'fixture')({}, failed);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body, 'existing service unavailable response');
    assert.equal(envelopes.length, 2);
  } finally {
    await Sentry.close(1500);
    Sentry.getCurrentScope().setClient(previousClient);
    if (previousDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = previousDsn;
  }
});
