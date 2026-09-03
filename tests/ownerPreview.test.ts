import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  PREVIEWABLE_TIERS,
  featureUnavailableReason,
  isPreviewableTier,
  ownerPreviewReach,
  ownerPreviewReachLabel,
  resolveOwnerPreviewAuthorization,
  type OwnerPreviewEnvironment,
  ownerPreviewReachDetail,
} from '../src/lib/ownerPreview.js';

/*
 * Owner preview exists so the owner can look at a tier without buying it. The
 * thing that must never happen is anyone *else* being able to turn it on, so
 * these tests are mostly about the ways it stays off.
 *
 * Authorization is deliberately parameterized rather than read from
 * import.meta.env, because the branch that matters most — a production build
 * refusing the flag — cannot be exercised from a test otherwise. A production
 * guard that is never executed in CI is a guard nobody has checked.
 */

// A visitor with nothing special about them: no session, no flag, prod bundle.
const anonymousProduction: OwnerPreviewEnvironment = {
  sessionEmail: '',
  compEmails: [],
  localFlagEnabled: false,
  isDevBuild: false,
  isProdBuild: true,
};

const localDev: OwnerPreviewEnvironment = {
  sessionEmail: '',
  compEmails: [],
  localFlagEnabled: true,
  isDevBuild: true,
  isProdBuild: false,
};

test('a normal visitor is never authorized', () => {
  const result = resolveOwnerPreviewAuthorization(anonymousProduction);
  assert.equal(result.authorized, false);
});

test('a signed-in customer who is not on the allowlist is not authorized', () => {
  const result = resolveOwnerPreviewAuthorization({
    ...anonymousProduction,
    sessionEmail: 'customer@example.com',
    compEmails: ['owner@xbar.test'],
  });
  assert.equal(result.authorized, false);
});

/*
 * The refusal that used to lie.
 *
 * An allowlist compiled in with nobody signed in fell through to the local-flag
 * branch and reported "Owner test mode is off. It is enabled per build, not
 * from the app." — exactly backwards when the build DOES carry an allowlist.
 * The operator reads that, concludes the environment variable did not take, and
 * goes back to set a variable that was already set. The missing piece is a
 * session, and a paused Supabase project is a way to have every variable right
 * and still have no session at all.
 */
test('a configured build with no session says so, rather than blaming the build', () => {
  const result = resolveOwnerPreviewAuthorization({
    ...anonymousProduction,
    sessionEmail: '',
    compEmails: ['owner@xbar.test'],
  });

  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.configured, true, 'the operator must be told');
  const reason = result.authorized === false ? result.reason : '';
  assert.match(reason, /nobody is signed in/, 'the missing piece is the session');
  assert.doesNotMatch(reason, /Owner test mode is off/, 'the build is not off — that was the misleading answer');
});

test('a signed-in non-owner is told it is their account, not the build', () => {
  const result = resolveOwnerPreviewAuthorization({
    ...anonymousProduction,
    sessionEmail: 'customer@example.com',
    compEmails: ['owner@xbar.test'],
  });

  const reason = result.authorized === false ? result.reason : '';
  assert.match(reason, /customer@example\.com/, 'their own address is safe to show them');
  /*
   * The allowlist itself is NOT. Echoing it would hand the operator's email to
   * every visitor of a deployed build — a disclosure the diagnostic is not
   * worth.
   */
  assert.doesNotMatch(reason, /owner@xbar\.test/, "the operator's address must not be echoed to a visitor");
});

/*
 * And a build nobody configured stays silent. `configured` is what the bar uses
 * to decide whether to render the refusal at all: an ordinary customer's screen
 * must not carry a message about a feature that does not exist in their build.
 */
test('a build with no allowlist and no flag reports nothing to show', () => {
  const result = resolveOwnerPreviewAuthorization({
    ...anonymousProduction,
    sessionEmail: 'customer@example.com',
    compEmails: [],
    localFlagEnabled: false,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.configured, false, 'nothing to explain on a stock build');
});

test('the comp allowlist authorizes, and is case and whitespace tolerant', () => {
  for (const email of ['owner@xbar.test', 'OWNER@XBAR.TEST', '  Owner@Xbar.Test  ']) {
    const result = resolveOwnerPreviewAuthorization({
      ...anonymousProduction,
      sessionEmail: email.trim().toLowerCase(),
      compEmails: ['owner@xbar.test'],
    });
    assert.equal(result.authorized, true, `${email} should be authorized`);
    assert.equal(result.authorized && result.source, 'comp-allowlist');
  }
});

test('an empty allowlist authorizes nobody, including an empty session email', () => {
  // The default configuration. An empty email must not match an empty entry.
  const result = resolveOwnerPreviewAuthorization({
    ...anonymousProduction,
    sessionEmail: '',
    compEmails: [''],
  });
  assert.equal(result.authorized, false);
});

test('the local flag is off by default', () => {
  const result = resolveOwnerPreviewAuthorization({ ...localDev, localFlagEnabled: false });
  assert.equal(result.authorized, false);
  assert.equal(
    result.authorized === false && result.reason,
    'Owner test mode is off. It is enabled per build, not from the app.',
  );
});

test('the local flag authorizes in a dev build', () => {
  const result = resolveOwnerPreviewAuthorization(localDev);
  assert.equal(result.authorized, true);
  assert.equal(result.authorized && result.source, 'local-dev-flag');
});

test('a production build refuses the local flag even when it is set', () => {
  // The guarantee that makes this safe to ship: the flag is compiled in, so the
  // only remaining question is whether a production bundle would honour it.
  const result = resolveOwnerPreviewAuthorization({
    ...localDev,
    isDevBuild: false,
    isProdBuild: true,
  });

  assert.equal(result.authorized, false);
  assert.equal(result.authorized === false && result.reason, 'Owner test mode is disabled in production builds.');
  assert.equal(
    result.authorized === false && result.configured,
    false,
    'a dev-only flag must not render an owner-mode diagnostic in production',
  );
});

test('an environment that claims neither dev nor prod is treated as unsafe', () => {
  // Not a hypothetical: import.meta.env is an empty object under a bare node
  // runner, so "not prod" must not be read as "therefore dev".
  const result = resolveOwnerPreviewAuthorization({
    ...localDev,
    isDevBuild: false,
    isProdBuild: false,
  });
  assert.equal(result.authorized, false);
});

test('an allowlisted owner is still authorized in production', () => {
  // The allowlist is server-backed, so unlike the dev flag it is meaningful in
  // a deployed build.
  const result = resolveOwnerPreviewAuthorization({
    ...anonymousProduction,
    sessionEmail: 'owner@xbar.test',
    compEmails: ['owner@xbar.test'],
  });
  assert.equal(result.authorized, true);
});

test('reach separates a local preview from a server-backed one', () => {
  const local = resolveOwnerPreviewAuthorization(localDev);
  const comped = resolveOwnerPreviewAuthorization({
    ...anonymousProduction,
    sessionEmail: 'owner@xbar.test',
    compEmails: ['owner@xbar.test'],
  });

  // A dev-flag preview is never cloud-backed, session or not: the server knows
  // nothing about the flag, so cloud actions run at the real account's tier.
  assert.equal(ownerPreviewReach(local, false), 'local-only');
  assert.equal(ownerPreviewReach(local, true), 'local-only');

  assert.equal(ownerPreviewReach(comped, false), 'cloud-ready');
  assert.equal(ownerPreviewReach(comped, true), 'cloud-active');

  assert.equal(ownerPreviewReach({ authorized: false, reason: 'off', configured: false }, true), 'local-only');
});

test('reach labels are distinct so the indicator cannot be misread', () => {
  const labels = (['local-only', 'cloud-ready', 'cloud-active'] as const).map(ownerPreviewReachLabel);
  assert.equal(new Set(labels).size, labels.length);
});

test('the unavailable reason says which tier is needed and whether this is a preview', () => {
  const real = featureUnavailableReason({
    feature: 'Sale packets',
    requiredTier: 'Professional',
    effectiveTier: 'Starter',
    previewing: false,
    reach: 'local-only',
  });
  assert.match(real, /Sale packets/);
  assert.match(real, /Professional/);
  assert.match(real, /Your plan is Starter/);
  assert.doesNotMatch(real, /preview/i, 'a normal customer must not be told about preview mode');

  const previewLocal = featureUnavailableReason({
    feature: 'Sale packets',
    requiredTier: 'Professional',
    effectiveTier: 'Enterprise',
    previewing: true,
    reach: 'local-only',
  });
  // The honest part: a local preview shows the screen but cannot do the work.
  assert.match(previewLocal, /cloud actions behind it are not/);
});

test('every sellable tier is previewable, and nothing else is', () => {
  assert.deepEqual([...PREVIEWABLE_TIERS], ['Starter', 'Professional', 'Ranch Ops', 'Enterprise']);

  for (const tier of PREVIEWABLE_TIERS) {
    assert.equal(isPreviewableTier(tier), true);
  }
  for (const value of ['Platinum', '', null, undefined, 0, {}, 'starter']) {
    assert.equal(isPreviewableTier(value), false, `${String(value)} must not be previewable`);
  }
});

/*
 * A preview changes what an owner SEES. It must never change what they can
 * WRITE.
 *
 * These gates briefly read the previewed tier, on the reasoning that a preview
 * "only decides which local gate fires first, because every cloud write is
 * still authorized by the API against the real account". The ordinary
 * configuration falsifies that: with relational sync off,
 * `saveWorkspaceBackupToCloud` falls back to a direct `workspace_snapshots`
 * upsert whose RLS checks row ownership and nothing about entitlements. There
 * is no API in that path to refuse anything, so records created under a
 * previewed tier were persisted to the cloud and read back later — a preview
 * that promised to be local was not.
 *
 * Pausing sync while previewing would not have fixed it either: the over-limit
 * records still exist locally and sync the moment the preview is switched off.
 *
 * The wiring is React store plumbing and cannot be exercised from this suite,
 * so the invariant is asserted against the source.
 */
test('the gates that create records read the real plan, not the preview', async () => {
  const enforcement = await readFile(path.join(process.cwd(), 'src/components/SubscriptionEnforcement.tsx'), 'utf8');
  const hook = await readFile(path.join(process.cwd(), 'src/hooks/useOwnerPreview.ts'), 'utf8');
  const hookCode = hook.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /*
   * Every gate SubscriptionEnforcement wraps creates a persisted record — a
   * horse, a document intake, a sale packet, an invitation, a listing — so all
   * of them resolve through the real subscription.
   */
  assert.match(enforcement, /enforcedSubscriptionSnapshot\(\)/);
  assert.doesNotMatch(enforcement, /effectiveSubscriptionSnapshot/, 'the previewed tier must not authorize a write');
  assert.match(
    hookCode,
    /export function enforcedSubscriptionSnapshot\(\): SubscriptionProfile \{\s*return useXbarStore\.getState\(\)\.subscription;\s*\}/,
    'and it must be the raw subscription, with no overlay applied on the way through',
  );

  /*
   * The overlay still exists — losing it would defeat the preview entirely —
   * but only on the READ path the screens use.
   */
  assert.match(hookCode, /overlay \? buildSubscriptionForTier\(realSubscription, overlay\) : realSubscription/);
  assert.match(hookCode, /export function useEffectiveSubscription\(\)/);

  // One definition of the rule, which is what stops the layers drifting apart
  // again; separate copies are how they diverged in the first place.
  const lib = await readFile(path.join(process.cwd(), 'src/lib/ownerPreview.ts'), 'utf8');
  assert.equal(
    (lib.match(/export function overlayTier\(/g) ?? []).length,
    1,
    'overlayTier should be defined exactly once, in lib/ownerPreview',
  );
  assert.match(hook, /overlayTier\(/, 'the read path should resolve previews through the shared overlayTier');
  assert.doesNotMatch(hook, /function overlayTier\(/, 'and should import it, not keep its own copy of the rule');
});

/*
 * The store's own gates run inside actions that create records — buyer deal
 * rooms, breeding revenue entries — so they are write gates too, and the same
 * rule applies: the real plan decides, not the preview.
 *
 * `gateSubscription` is kept as a named function rather than inlined so this
 * stays a stated decision rather than reading as an oversight. Outer and inner
 * gates still agree, which was the point of routing them through one helper;
 * they now agree on the real plan.
 */
test('the store evaluates its own gates against the real plan', async () => {
  const store = await readFile(path.join(process.cwd(), 'src/store/useXbarStore.ts'), 'utf8');
  const code = store.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.match(
    code,
    /function gateSubscription\(subscription: SubscriptionProfile\): SubscriptionProfile \{\s*return subscription;\s*\}/,
    'the store gate must not overlay a previewed tier onto a write',
  );
  assert.doesNotMatch(code, /overlayTier\(/, 'and the store must not reach for the overlay at all');
  assert.ok(
    (code.match(/featureGate\(gateSubscription\(get\(\)\.subscription\),/g) ?? []).length >= 4,
    'every store feature gate should still resolve through the one helper',
  );
});

/*
 * Every inner limit check resolves through ONE helper.
 *
 * Seven reads across six actions, so the guard is on the shape rather than the
 * sites: no limit may be read straight off a subscription in passing. That
 * matters in both directions — scattered reads are how the outer and inner
 * gates disagreed when the overlay applied, and they are also how the overlay
 * would creep back into a write gate one call site at a time.
 *
 * The limits are the REAL plan's. Overlaying them let a previewed Enterprise
 * allowance authorize records that a Starter workspace then synced to the
 * cloud, where the snapshot path checks row ownership and nothing about
 * entitlements. Counts were always real, so only the limit half was ever in
 * question, and "23 of 5" still reads correctly.
 */
test('every inner limit check resolves through one helper, on the real plan', async () => {
  const store = await readFile(path.join(process.cwd(), 'src/store/useXbarStore.ts'), 'utf8');

  assert.doesNotMatch(
    store,
    /state\.subscription\.usage\.\w*Limit/,
    'a limit read in passing is how these drift apart, in either direction',
  );

  assert.ok(
    (store.match(/entitledUsage\(/g) ?? []).length >= 7,
    'every inner limit check should resolve through entitledUsage',
  );

  // Counts must stay real, or a downgrade would reset usage to zero instead of
  // showing "23 of 5".
  assert.match(store, /return gateSubscription\(subscription\)\.usage;/);
});

/*
 * The comp allowlist does not reach the database.
 *
 * XBAR_COMP_EMAILS is honoured by getWorkspaceEntitlements, so the API grants
 * the tier — but it is keyed on email and lives in the API, while the limit
 * triggers read workspace_subscription_profiles and see only the stored plan.
 * A seat, storage or resource cap can therefore refuse a write the API just
 * allowed. The reach copy is what a customer reads before trying, so it must
 * not promise that every cloud action works.
 */
test('the cloud-active copy does not promise writes the database will refuse', () => {
  const detail = ownerPreviewReachDetail('cloud-active');

  assert.doesNotMatch(
    detail,
    /cloud actions run at this tier/,
    'this claimed every cloud write succeeds, which the limit triggers do not honour',
  );
  assert.match(detail, /real plan|stored tier|stored plan/, 'the database boundary has to be stated, not implied');
});

test('the bar never claims a server grant the bundle cannot see', () => {
  /*
   * There are two allowlists. `VITE_XBAR_COMP_EMAILS` is compiled into the
   * bundle; `XBAR_COMP_EMAILS` lives on the server and is the one the API
   * actually honours. Setting only the client one is the normal way an owner
   * gets the tier switcher WITHOUT granting themselves real entitlements — and
   * in that configuration the old copy flatly asserted "the API grants this
   * tier", which was false.
   */
  const detail = ownerPreviewReachDetail('cloud-active');

  assert.doesNotMatch(
    detail,
    /allowlist, so the API grants this tier/,
    'the client cannot know the server allowlist agrees, so it must not assert it',
  );
  assert.match(detail, /only if/, 'the grant has to be stated as conditional');
  assert.match(detail, /XBAR_COMP_EMAILS/, 'and the condition has to name what to check');

  // The label is read on its own, without the tooltip, so it carries the same
  // burden: it reports that the client list matched, not that access is live.
  assert.equal(ownerPreviewReachLabel('cloud-active'), 'Cloud allowlisted');
});

test('each reach level says something different about what will work', () => {
  const details = (['local-only', 'cloud-ready', 'cloud-active'] as const).map(ownerPreviewReachDetail);
  assert.equal(new Set(details).size, 3, 'three levels exist because they behave differently');
});
