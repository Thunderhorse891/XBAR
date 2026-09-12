import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bootstrapEventDisposition,
  createLatestWriteGate,
  identityPublication,
  liveSessionAgrees,
  waitForStorageCatchUp,
  reconcilePublishedSession,
} from '../src/lib/authBootstrap.js';
import { createRecoveryCallbackNavigationIntent, isRecoveryCallbackUrl } from '../src/lib/authCallbackArrival.js';

/*
 * Two decisions that both exist because auth-js broadcasts to every tab, and
 * both were reported as defects on this branch.
 */

test('an auth event after bootstrap is applied', () => {
  for (const event of ['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED', 'INITIAL_SESSION']) {
    assert.equal(bootstrapEventDisposition({ bootstrapped: true, event }), 'apply', event);
  }
});

test('an event that contradicts the in-flight bootstrap is kept, not dropped', () => {
  /*
   * The defect: every pre-bootstrap event was discarded so the first sync would
   * not run twice. If another tab signed out during that window the SIGNED_OUT
   * went in the bin, then the in-flight getSession result wrote the stale
   * signed-in session and its workspace back -- with nothing left to correct
   * it, so the app kept showing a workspace the customer had signed out of.
   */
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'SIGNED_OUT' }), 'supersede');
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'SIGNED_IN' }), 'supersede');
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'USER_UPDATED' }), 'supersede');
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'TOKEN_REFRESHED' }), 'supersede');
});

test('INITIAL_SESSION during bootstrap is ignored rather than queued', () => {
  /*
   * Not an arbitrary exception: it reports the same fact getSession() is about
   * to report. Queueing it would reload the workspace a second time on every
   * startup, which is what the original drop-everything guard existed to avoid
   * -- so replacing that guard must not cost it.
   */
  assert.equal(bootstrapEventDisposition({ bootstrapped: false, event: 'INITIAL_SESSION' }), 'ignore');
});

test('a recovery callback is recognised in the fragment and the query', () => {
  // Implicit flow: the session comes back in the fragment.
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#access_token=abc&type=recovery'), true);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#type=recovery&access_token=abc'), true);
  // PKCE and older links put it in the query.
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/reset-password?type=recovery'), true);
});

test('an ordinary URL is not a recovery callback', () => {
  /*
   * This decides which tab NAVIGATES. Matching loosely would put every open tab
   * back to yanking itself to the reset screen, which is the defect it exists
   * to fix.
   */
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/horses'), false);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#access_token=abc&type=signup'), false);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/#/reset-password'), false);
  // Not a bare substring match: `type=recovery` has to be its own parameter.
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/?prototype=recovery-plan'), false);
  assert.equal(isRecoveryCallbackUrl('https://x.test/app/?type=recovery-lite'), false);
});

test('recovery callback navigation is consumed after one use', () => {
  /*
   * A tab that opened one recovery link must not stay permanently classified as
   * the callback tab. Otherwise the next link opened in another tab can pull
   * this old tab back to reset-password.
   */
  const consume = createRecoveryCallbackNavigationIntent('https://x.test/app/#access_token=abc&type=recovery');
  assert.equal(consume(), true);
  assert.equal(consume(), false);
});

test('non-callback tabs never get a recovery navigation intent', () => {
  const consume = createRecoveryCallbackNavigationIntent('https://x.test/app/horses');
  assert.equal(consume(), false);
  assert.equal(consume(), false);
});

test('a single write commits', () => {
  const gate = createLatestWriteGate();
  const isStillLatest = gate.begin();
  assert.equal(isStillLatest(), true);
});

test('a write that has been overtaken must not commit', () => {
  /*
   * The defect: syncing a signed-in session waits on a workspace round trip
   * before it writes, while a signed-out one writes at once, and the auth
   * listener starts them without awaiting. So a sign-out landed and the
   * sign-in it replaced finished afterwards and put the old session and
   * workspace back -- with no further event coming to correct it.
   */
  const gate = createLatestWriteGate();
  const older = gate.begin();
  const newer = gate.begin();
  assert.equal(older(), false, 'the overtaken write must drop itself');
  assert.equal(newer(), true, 'the newest write owns the state');
});

test('only the newest of several writes survives', () => {
  const gate = createLatestWriteGate();
  const first = gate.begin();
  const second = gate.begin();
  const third = gate.begin();
  assert.deepEqual([first(), second(), third()], [false, false, true]);
});

test('the newest write stays valid however long it takes', () => {
  // It is not a timeout: a slow write still commits, as long as nothing newer
  // has started. Expiring on duration would drop legitimate slow syncs.
  const gate = createLatestWriteGate();
  const only = gate.begin();
  assert.equal(only(), true);
  assert.equal(only(), true);
});

test('gates are independent of one another', () => {
  // One gate per store initialization, so a second one must not retire the
  // first one's in-flight write.
  const gateA = createLatestWriteGate();
  const gateB = createLatestWriteGate();
  const a = gateA.begin();
  gateB.begin();
  assert.equal(a(), true);
});

test('retiring in flight writes stops them committing, and starts nothing', () => {
  /*
   * Queueing an event during bootstrap does not start a sync -- the replay
   * comes later -- but the bootstrap sync in flight is already writing about a
   * session that has been superseded. Without this it commits the obsolete
   * session and workspace first, and reconciliation can begin against the
   * wrong account in the gap before the replay lands.
   */
  const gate = createLatestWriteGate();
  const inFlight = gate.begin();
  gate.retireInFlight();
  assert.equal(inFlight(), false, 'the superseded write must not commit');

  // And no write was started, so the next one to begin is still the latest.
  const replay = gate.begin();
  assert.equal(replay(), true);
});

test('a re-sync of the same account does not put the app back into loading', () => {
  // A token refresh publishes the same identity again. Treating that as a
  // change would drop the app into a loading screen roughly hourly, and clear
  // a workspace id that is still correct.
  assert.deepEqual(identityPublication('user-a', 'user-a'), { workspaceReady: false });
});

test('a staged storage reservation does not follow one account into another', () => {
  /*
   * The reservation counts bytes THIS account put in the document bucket and
   * has not yet persisted as rows. Carried across an account change it is added
   * to the next account's authoritative server total, refusing uploads that
   * would have fit, until that account happens to complete a relational save.
   * It belongs to the identity that made it.
   */
  assert.equal(identityPublication('user-a', 'user-b').stagedStorageBytes, 0);
  assert.equal(identityPublication('', 'user-b').stagedStorageBytes, 0);

  // A token refresh is the same account and must not discard a live reservation.
  assert.equal(identityPublication('user-a', 'user-a').stagedStorageBytes, undefined);
});

test('an account change retires the previous account workspace with it', () => {
  /*
   * The regression this exists for: publishing the new session while leaving
   * `status: 'signed-in'` and the old `workspaceId` in place left the previous
   * account's records interactive under the new identity, and a
   * workspace-scoped write would have carried the old workspace id with the
   * new access token.
   */
  const patch = identityPublication('user-a', 'user-b');
  assert.equal(patch.status, 'loading', 'the app must not stay signed-in through an account change');
  assert.equal(patch.workspaceId, '', 'the previous workspace must not survive the account that owned it');
  assert.equal(patch.workspaceRole, 'Owner', 'nor may its role');
  assert.equal(patch.workspaceReady, false);
});

test('a first sign-in counts as a change, having nothing to keep', () => {
  const patch = identityPublication('', 'user-b');
  assert.equal(patch.status, 'loading');
  assert.equal(patch.workspaceId, '');
});

/*
 * The rule that decides whether a broadcast auth event is about THIS tab, for
 * the configuration where the tabs share a channel but not a session. Tested
 * here rather than in a browser because that is where it is decidable: with a
 * per-tab session store there is no way, from inside the page, to make auth-js
 * discard its own in-memory session, so a browser case for the sign-out half
 * would pass whether or not the rule were present.
 */
const generationOf = (session: { access_token?: string } | null) => (session?.access_token ?? '').split(':')[0] ?? '';
const held = (token: string) => JSON.stringify({ access_token: token });

test("a sign-out is this tab's only when this tab's store really holds no session", () => {
  assert.equal(liveSessionAgrees(null, null, generationOf), true);
});

test("another tab's sign-out is refused while this tab still holds a session", () => {
  assert.equal(liveSessionAgrees(held('A:one'), null, generationOf), false);
});

test("another account's sign-in never replaces the session this tab actually has", () => {
  /*
   * The costly half. Applying the payload put account B's identity over account
   * A's workspace while every request still carried A's token.
   */
  assert.equal(liveSessionAgrees(held('A:one'), { access_token: 'B:one' }, generationOf), false);
});

test('a refreshed token for the same session still agrees', () => {
  // The generation survives a refresh; the credential does not.
  assert.equal(liveSessionAgrees(held('A:two'), { access_token: 'A:one' }, generationOf), true);
});

test('a sign-in is refused when this tab holds no session at all', () => {
  assert.equal(liveSessionAgrees(null, { access_token: 'B:one' }, generationOf), false);
});

test('a record that cannot be parsed names no session', () => {
  assert.equal(liveSessionAgrees('not json', { access_token: 'B:one' }, generationOf), false);
  assert.equal(liveSessionAgrees('not json', null, generationOf), true);
});

test('the session is found under currentSession as well as at the top level', () => {
  const nested = JSON.stringify({ currentSession: { access_token: 'A:one' } });
  assert.equal(liveSessionAgrees(nested, { access_token: 'A:two' }, generationOf), true);
});

test('unnamed generations fall back to comparing the credential', () => {
  const unnamed = () => '';
  assert.equal(liveSessionAgrees(held('x'), { access_token: 'x' }, unnamed), true);
  assert.equal(liveSessionAgrees(held('x'), { access_token: 'y' }, unnamed), false);
});

// A scheduler with no real timers: every pending run is explicit, so a test
// says exactly how many re-reads happened rather than waiting on a clock.
function fakeScheduler() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    schedule(run: () => void) {
      const handle = next++;
      pending.set(handle, run);
      return handle;
    },
    cancel(handle: unknown) {
      pending.delete(handle as number);
    },
    get pendingCount() {
      return pending.size;
    },
    /** Run every currently pending callback, once. */
    tick() {
      const due = [...pending.entries()];
      pending.clear();
      for (const [, run] of due) run();
    },
  };
}

test('an event is applied as soon as this tab can see the write it describes', () => {
  const scheduler = fakeScheduler();
  let visible = false;
  let applied = 0;
  waitForStorageCatchUp(
    () => visible,
    () => {
      applied += 1;
    },
    scheduler.schedule,
    scheduler.cancel,
  );
  scheduler.tick();
  assert.equal(applied, 0, 'storage has not caught up yet, so nothing may be applied');
  // The other renderer's write becomes visible here.
  visible = true;
  scheduler.tick();
  assert.equal(applied, 1, 'once the write is visible the event belongs to this tab');
  scheduler.tick();
  assert.equal(applied, 1, 'and it is applied once, not once per attempt');
});

test('an event storage never agrees with is dropped, and stops re-reading', () => {
  const scheduler = fakeScheduler();
  let applied = 0;
  waitForStorageCatchUp(
    () => false,
    () => {
      applied += 1;
    },
    scheduler.schedule,
    scheduler.cancel,
    3,
  );
  for (let round = 0; round < 10; round += 1) scheduler.tick();
  assert.equal(applied, 0, 'a genuinely superseded event must still be dropped');
  assert.equal(scheduler.pendingCount, 0, 'the re-reads must stop rather than run forever');
});

test('re-reading stops after the attempt budget, not before', () => {
  const scheduler = fakeScheduler();
  let reads = 0;
  waitForStorageCatchUp(
    () => {
      reads += 1;
      return false;
    },
    () => {},
    scheduler.schedule,
    scheduler.cancel,
    4,
  );
  for (let round = 0; round < 10; round += 1) scheduler.tick();
  assert.equal(reads, 4, 'exactly the budget, so a stale event cannot be retried indefinitely');
});

test('cancelling stops a pending re-read from applying anything', () => {
  const scheduler = fakeScheduler();
  let applied = 0;
  const catchUp = waitForStorageCatchUp(
    () => true,
    () => {
      applied += 1;
    },
    scheduler.schedule,
    scheduler.cancel,
  );
  catchUp.cancel();
  scheduler.tick();
  assert.equal(applied, 0, 'a torn-down subscription must not apply an event later');
  assert.equal(scheduler.pendingCount, 0);
});

/*
 * Agreement is decided by session GENERATION, because auth-js rotates the
 * access token underneath a session that has not otherwise changed. That is the
 * right test for identity and says nothing about freshness.
 *
 * Reuses the `generation:nonce` token shape and `generationOf` above, so these
 * cases and the agreement cases cannot drift apart on what a generation is.
 */

test('an older token of the same generation is replaced by the stored one', () => {
  /*
   * A broadcast delayed past another tab's refresh carries an older token with
   * the same generation, so it agrees and used to be published verbatim. The
   * store then held a credential that expires while the session is still live,
   * and checkout, sale packets and account deletion all read that token rather
   * than asking auth-js.
   */
  const stored = JSON.stringify({ access_token: 'gen-1:new', refresh_token: 'r-new', expires_at: 4242 });
  const published = reconcilePublishedSession(
    stored,
    { access_token: 'gen-1:old', user: { id: 'user-a' } },
    generationOf,
  );
  assert.equal(published?.access_token, 'gen-1:new', 'storage is settled: auth-js saves before it notifies');
  assert.equal((published as { refresh_token?: string }).refresh_token, 'r-new');
  assert.equal((published as { expires_at?: number }).expires_at, 4242);
  assert.deepEqual(
    (published as { user?: { id: string } }).user,
    { id: 'user-a' },
    'the event still supplies identity',
  );
});

test('a stored record of a DIFFERENT generation is never substituted', () => {
  // That record is not this event's session at all, and publishing it would put
  // an identity into the store that no event ever reported.
  const event = { access_token: 'gen-1:a' };
  assert.equal(reconcilePublishedSession(held('gen-2:b'), event, generationOf)?.access_token, 'gen-1:a');
});

test('a matching token is published unchanged', () => {
  const event = { access_token: 'gen-1:a', user: { id: 'user-a' } };
  assert.equal(reconcilePublishedSession(held('gen-1:a'), event, generationOf), event);
});

test('a sign-out and an unreadable store publish the event as it came', () => {
  assert.equal(reconcilePublishedSession(held('gen-1:a'), null, generationOf), null);
  const event = { access_token: 'gen-1:a' };
  assert.equal(reconcilePublishedSession('not json', event, generationOf), event);
  assert.equal(reconcilePublishedSession(null, event, generationOf), event);
});

test('the nested currentSession shape is read as well as the flat one', () => {
  // auth-js has written the record both ways over its life.
  const stored = JSON.stringify({ currentSession: { access_token: 'gen-1:new' } });
  assert.equal(
    reconcilePublishedSession(stored, { access_token: 'gen-1:old' }, generationOf)?.access_token,
    'gen-1:new',
  );
});

test('tokens carrying no generation are left alone', () => {
  /*
   * Without a generation on both sides nothing proves the two belong to the
   * same session, and swapping credentials between sessions is exactly what
   * this must never do.
   */
  const noGeneration = (session: { access_token?: string } | null) => (session?.access_token ? '' : '');
  const event = { access_token: 'opaque-old' };
  assert.equal(reconcilePublishedSession(held('opaque-new'), event, noGeneration)?.access_token, 'opaque-old');
});
