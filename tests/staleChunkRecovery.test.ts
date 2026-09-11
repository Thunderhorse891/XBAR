import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideStaleChunkReload,
  isChunkLoadFailure,
  withStaleChunkRecovery,
  type StaleChunkEnvironment,
} from '../src/lib/staleChunkRecovery.js';

/*
 * A document that arrived on an auth callback never takes the service worker's
 * `controllerchange` reload -- offlineRuntime withholds it so a reload cannot
 * land between auth-js clearing the URL fragment and the session being saved.
 * That document therefore keeps running old code, and its lazy route chunks are
 * content-hashed: after a deploy their URLs 404, and the service worker returns
 * that 404 as-is rather than falling back to cache, so the route renders
 * nothing at all.
 */

function environment(options: { reloaded?: boolean; markerRetainable?: boolean; settled?: boolean } = {}) {
  const calls = { reloads: 0, marked: 0, cleared: 0, waits: 0 };
  let reloaded = options.reloaded ?? false;
  const retainable = options.markerRetainable ?? true;
  let settled = options.settled ?? true;
  const env: StaleChunkEnvironment = {
    hasReloaded: () => reloaded,
    markReloaded: () => {
      calls.marked += 1;
      if (!retainable) return false;
      reloaded = true;
      return true;
    },
    clearReloaded: () => {
      reloaded = false;
      calls.cleared += 1;
    },
    reload: () => {
      calls.reloads += 1;
    },
    authCallbackSettled: () => settled,
    wait: async () => {
      calls.waits += 1;
    },
  };
  return { env, calls, settle: () => (settled = true) };
}

const rule = (over: Partial<Parameters<typeof decideStaleChunkReload>[0]> = {}) =>
  decideStaleChunkReload({
    error: chromium(),
    alreadyReloaded: false,
    markerRetainable: true,
    authCallbackSettled: true,
    ...over,
  });

const chromium = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js');
const firefox = () => new TypeError('error loading dynamically imported module');
const safari = () => new TypeError('Importing a module script failed.');

test('every engine’s wording for a missing chunk is recognised', () => {
  // Each browser words this differently and all of them mean the same thing;
  // matching only Chromium would leave Safari and Firefox unrecovered.
  assert.equal(isChunkLoadFailure(chromium()), true);
  assert.equal(isChunkLoadFailure(firefox()), true);
  assert.equal(isChunkLoadFailure(safari()), true);
  assert.equal(isChunkLoadFailure(new Error('ChunkLoadError: loading chunk 42 failed')), true);
});

test('an ordinary module error is not a stale chunk', () => {
  // Reloading on a real bug in the route would hide it behind a refresh loop
  // instead of surfacing it.
  assert.equal(isChunkLoadFailure(new TypeError('x is not a function')), false);
  assert.equal(isChunkLoadFailure(new Error('Cannot read properties of undefined')), false);
  assert.equal(isChunkLoadFailure(null), false);
  assert.equal(isChunkLoadFailure(undefined), false);
});

test('a stale chunk reloads once', () => {
  assert.equal(rule(), 'reload');
});

test('a stale chunk in an already-reloaded document is not reloaded again', () => {
  /*
   * The loop guard. If a freshly loaded document still cannot fetch the chunk,
   * staleness was not the cause -- the asset is genuinely gone, or the network
   * is failing -- and reloading again would spin without ever rendering an
   * error the customer could act on.
   */
  assert.equal(rule({ alreadyReloaded: true }), 'rethrow');
});

test('a route that loads clears the marker so a later deploy can recover too', async () => {
  // Otherwise a tab gets exactly one recovery for its entire life.
  const { env, calls } = environment({ reloaded: true });
  const load = withStaleChunkRecovery(async () => 'route-module', env);
  assert.equal(await load(), 'route-module');
  assert.equal(calls.cleared, 1);
  assert.equal(env.hasReloaded(), false);
});

test('a stale chunk reloads the document and never settles', async () => {
  /*
   * The promise is deliberately left pending: the document is being replaced,
   * and resolving or rejecting would flash the error screen over a page that is
   * already on its way out.
   */
  const { env, calls } = environment();
  const load = withStaleChunkRecovery(() => Promise.reject(chromium()), env);
  const settled = await Promise.race([load().then(() => 'settled'), Promise.resolve('still-pending')]);
  assert.equal(settled, 'still-pending');
  assert.equal(calls.reloads, 1);
  assert.equal(calls.marked, 1);
});

test('a genuine route error still reaches the error boundary', async () => {
  const { env, calls } = environment();
  const boom = new TypeError('render is not a function');
  const load = withStaleChunkRecovery(() => Promise.reject(boom), env);
  await assert.rejects(load(), (error: unknown) => error === boom);
  assert.equal(calls.reloads, 0, 'a real bug must not be hidden behind a refresh');
});

test('a second stale failure surfaces instead of reloading again', async () => {
  const { env, calls } = environment({ reloaded: true });
  const error = chromium();
  const load = withStaleChunkRecovery(() => Promise.reject(error), env);
  await assert.rejects(load(), (thrown: unknown) => thrown === error);
  assert.equal(calls.reloads, 0);
});

/*
 * Both of the rules below were missing from the first version of this module,
 * and both were found in review. They are the two ways a recovery reload can do
 * more harm than the staleness it cures.
 */

test('a marker that cannot be retained refuses the reload rather than looping', () => {
  /*
   * Where sessionStorage throws -- a private window, blocked site data -- the
   * write fails silently and the read always says "not yet reloaded". The first
   * version reloaded anyway, so a chunk that was genuinely missing reloaded
   * every fresh document forever. Its comment claimed losing the marker "only
   * costs one extra reload"; that was wrong, and an unbounded reload loop is
   * worse than the blank route it was trying to fix.
   */
  assert.equal(rule({ markerRetainable: false }), 'rethrow');
});

test('an unsettled auth callback holds the reload back rather than burning the link', () => {
  /*
   * The reset route is itself lazy, so its chunk can fail while auth-js is
   * still consuming an implicit-flow fragment. A reload landing between the
   * fragment being cleared and the session being saved leaves the token in
   * neither place and burns a one-time link.
   *
   * The first version argued this "cannot be premature by construction, because
   * the route has already failed". That only considered the UI: a failed route
   * is not evidence that nothing else is in flight.
   */
  assert.equal(rule({ authCallbackSettled: false }), 'wait');
});

test('an already-reloaded document rethrows even while the callback is unsettled', () => {
  // The loop guard outranks waiting: waiting on a document that has already
  // had its one reload can only delay the error, never avoid it.
  assert.equal(rule({ alreadyReloaded: true, authCallbackSettled: false }), 'rethrow');
});

test('a chunk failure waits for the callback and then reloads', async () => {
  const { env, calls, settle } = environment({ settled: false });
  const load = withStaleChunkRecovery(() => Promise.reject(chromium()), env, 5, 1);
  const pending = load();
  const settled = await Promise.race([pending.then(() => 'settled'), Promise.resolve('still-pending')]);
  assert.equal(settled, 'still-pending');
  assert.ok(calls.waits >= 1, 'it must wait rather than reload while the credential is in flight');
  assert.equal(calls.reloads, 0);
  settle();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(calls.reloads, 1, 'once the session is persisted the reload is safe');
});

test('a callback that never settles surfaces the error instead of reloading', async () => {
  // The conservative end: after the budget, showing the error beats a reload
  // that could still destroy the credential.
  const { env, calls } = environment({ settled: false });
  const error = chromium();
  const load = withStaleChunkRecovery(() => Promise.reject(error), env, 3, 1);
  await assert.rejects(load(), (thrown: unknown) => thrown === error);
  assert.equal(calls.reloads, 0);
  assert.equal(calls.waits, 3);
});

test('a blocked marker surfaces the error through the wrapper too', async () => {
  const { env, calls } = environment({ markerRetainable: false });
  const error = chromium();
  const load = withStaleChunkRecovery(() => Promise.reject(error), env, 3, 1);
  await assert.rejects(load(), (thrown: unknown) => thrown === error);
  assert.equal(calls.reloads, 0, 'a reload that cannot be counted must not happen');
});
