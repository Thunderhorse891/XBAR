import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Execute the actual Login effect, not a copied implementation or source-shape
// assertion. Isolate only the React scheduling, store, storage and navigation
// boundaries. The browser suite separately drives the whole mounted screen.
const source = ts.createSourceFile(
  'Login.tsx',
  readFileSync('src/routes/Login.tsx', 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const effects = [];
function containsWelcomeRequest(node) {
  if (ts.isPropertyAccessExpression(node) && node.name.text === 'requestWelcomeEmail') return true;
  return ts.forEachChild(node, containsWelcomeRequest) ?? false;
}
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'useEffect' &&
    node.arguments[0] &&
    containsWelcomeRequest(node.arguments[0])
  ) {
    effects.push(node.arguments[0].getText(source));
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(effects.length, 1, 'find exactly one real signup welcome/redirect effect');
const script = ts.transpileModule(`(${effects[0]})();`, {
  compilerOptions: { target: ts.ScriptTarget.ES2021 },
}).outputText;

function harness({
  storageFailure = '',
  authMode = 'signup',
  callbackFailed = false,
  status = 'signed-in',
  userId = 'new-account',
  session = true,
  sent = true,
  entries = [],
  checkOwnerArrival = false,
  ownerAccess = 'denied',
} = {}) {
  const stored = new Map(entries);
  const navigations = [];
  const writes = [];
  let requests = 0;
  const storage = {
    getItem(key) {
      if (storageFailure === 'read') throw new Error('storage read blocked');
      return stored.get(key) ?? null;
    },
    setItem(key, value) {
      if (storageFailure === 'write') throw new Error('quota exceeded');
      writes.push([key, value]);
      stored.set(key, value);
    },
  };
  const context = {
    authMode,
    callbackFailed,
    checkOwnerArrival,
    ownerAccess,
    redirectTarget: '/setup?plan=Professional',
    cloud: {
      status,
      session: session ? { user: { id: userId } } : null,
      requestWelcomeEmail() {
        requests += 1;
        return Promise.resolve(sent);
      },
    },
    navigate(path, options) {
      navigations.push([path, options.replace]);
    },
  };
  if (storageFailure !== 'absent')
    Object.defineProperty(context, 'sessionStorage', {
      get() {
        if (storageFailure === 'getter') throw new Error('site data blocked');
        return storage;
      },
    });
  return {
    context,
    stored,
    writes,
    navigations,
    requests: () => requests,
    run: () => runInNewContext(script, context),
  };
}

test('owner arrival waits for a server grant and preserves explicit return and failed callback paths', () => {
  for (const [options, destination] of [
    [{ checkOwnerArrival: true, ownerAccess: 'checking' }, null],
    [{ checkOwnerArrival: true, ownerAccess: 'allowed' }, '/owner'],
    [{ checkOwnerArrival: true, ownerAccess: 'denied' }, '/setup?plan=Professional'],
    [{ checkOwnerArrival: true, ownerAccess: 'unavailable' }, '/setup?plan=Professional'],
    [{ checkOwnerArrival: false, ownerAccess: 'allowed' }, '/setup?plan=Professional'],
    [{ checkOwnerArrival: true, ownerAccess: 'allowed', callbackFailed: true }, null],
  ]) {
    const h = harness({ authMode: 'signin', ...options });
    h.run();
    assert.deepEqual(h.navigations, destination ? [[destination, true]] : []);
    assert.equal(h.requests(), 0);
  }
});

for (const storageFailure of ['getter', 'read', 'write', 'absent']) {
  test(`signup still reaches its requested setup route when session storage fails at ${storageFailure}`, async () => {
    const h = harness({ storageFailure });
    assert.doesNotThrow(h.run);
    assert.deepEqual(h.navigations, [['/setup?plan=Professional', true]]);
    assert.equal(h.requests(), 1);
    await Promise.resolve();
    if (storageFailure === 'write' || storageFailure === 'getter' || storageFailure === 'absent')
      assert.deepEqual(h.writes, []);
  });
}

test('a confirmed welcome is marked per account and suppresses a later request', async () => {
  const h = harness();
  h.run();
  await Promise.resolve();
  assert.deepEqual(h.writes, [['xbar-welcome-sent:new-account', '1']]);
  h.run();
  assert.equal(h.requests(), 1);
  assert.equal(h.navigations.length, 2);
});

test('a different account marker does not suppress this signup welcome', () => {
  const h = harness({ entries: [['xbar-welcome-sent:another-account', '1']] });
  h.run();
  assert.equal(h.requests(), 1);
});

test('failed welcome requests remain retryable at the next session establishment', async () => {
  const h = harness({ sent: false });
  h.run();
  await Promise.resolve();
  assert.deepEqual(h.writes, []);
  h.run();
  assert.equal(h.requests(), 2);
});

test('navigation never waits for the optional welcome response', async () => {
  let finish;
  const h = harness({
    sent: new Promise((resolve) => {
      finish = resolve;
    }),
  });
  h.run();
  assert.equal(h.navigations.length, 1);
  assert.deepEqual(h.writes, []);
  finish(true);
  await Promise.resolve();
  assert.equal(h.writes.length, 1);
});

for (const options of [
  { authMode: 'signin' },
  { callbackFailed: true },
  { status: 'loading' },
  { session: false },
  { userId: '' },
]) {
  test(`welcome storage does not change other arrival guards: ${JSON.stringify(options)}`, () => {
    const h = harness({ storageFailure: 'getter', ...options });
    assert.doesNotThrow(h.run);
    assert.equal(h.requests(), 0);
    const shouldNavigate = !options.callbackFailed && !options.status && options.session !== false;
    assert.equal(h.navigations.length, shouldNavigate ? 1 : 0);
  });
}
