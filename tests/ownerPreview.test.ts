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

  assert.equal(ownerPreviewReach({ authorized: false, reason: 'off' }, true), 'local-only');
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
 * The preview has to reach the gates that block actions, not only the ones that
 * render screens.
 *
 * RequireSubscriptionFeature reads useEffectiveSubscription, so an authorized
 * owner previewing Enterprise sees the screen. SubscriptionEnforcement wraps the
 * store's own actions and read the raw subscription, so the same owner was
 * refused by a local gate before the request reached the API — while the status
 * bar told them their session was `Cloud active` and the server would in fact
 * have granted the tier.
 *
 * The wiring is React store plumbing and cannot be exercised from this suite,
 * so the invariant is asserted against the source: both gate layers must read
 * the effective subscription, and neither may reach past it to the raw record.
 */
test('both gate layers read the effective subscription, not the raw record', async () => {
  const enforcement = await readFile(path.join(process.cwd(), 'src/components/SubscriptionEnforcement.tsx'), 'utf8');

  assert.match(
    enforcement,
    /effectiveSubscriptionSnapshot\(\)/,
    'the imperative action gates must use the same effective tier as the rendering gates',
  );
  assert.doesNotMatch(
    enforcement,
    /current\.subscription/,
    'reading the raw subscription here re-introduces a local refusal the account does not actually have',
  );

  // Every consumer resolves through one definition, which is what stops them
  // drifting apart again; separate copies of the authorization rule are how the
  // rendering gates and the action gates diverged in the first place.
  const lib = await readFile(path.join(process.cwd(), 'src/lib/ownerPreview.ts'), 'utf8');
  assert.equal(
    (lib.match(/export function overlayTier\(/g) ?? []).length,
    1,
    'overlayTier should be defined exactly once, in lib/ownerPreview',
  );

  // The three places that decide whether a preview applies: the React hook, the
  // imperative snapshot the action gates use, and the store's own feature gates.
  for (const consumer of ['src/hooks/useOwnerPreview.ts', 'src/store/useXbarStore.ts']) {
    const source = await readFile(path.join(process.cwd(), consumer), 'utf8');
    assert.match(source, /overlayTier\(/, `${consumer} should resolve previews through the shared overlayTier`);
    assert.doesNotMatch(
      source,
      /function overlayTier\(/,
      `${consumer} should import overlayTier, not keep its own copy of the rule`,
    );
  }
});

/*
 * The store's own feature gates run inside actions and cannot use the hook, so
 * they read the raw subscription and refused an authorized owner's previewed
 * tier before any request reached the API. There were four of them — the
 * reported one plus three more for buyer deal rooms — so the guard is on the
 * call shape rather than on the single site that was named.
 */
test('the store evaluates feature gates against the previewed tier', async () => {
  const store = await readFile(path.join(process.cwd(), 'src/store/useXbarStore.ts'), 'utf8');

  assert.doesNotMatch(
    store,
    /featureGate\(get\(\)\.subscription,/,
    'a feature gate reading the raw subscription re-introduces a local refusal a comped account does not have',
  );
  assert.ok(
    (store.match(/featureGate\(gateSubscription\(get\(\)\.subscription\),/g) ?? []).length >= 4,
    'every store feature gate should evaluate the previewed tier',
  );
});

/*
 * The preview has to reach the limit checks inside the actions too.
 *
 * Converting the wrapped gates in SubscriptionEnforcement was only half of it:
 * the checks *inside* those store actions still read the raw usage limits, so
 * an allowlisted owner previewing Enterprise passed the outer gate and was then
 * refused by the inner one against their real Starter allowance — "Seat limit
 * reached" on a preview the status bar called cloud-active.
 *
 * There were seven such reads across six actions, so the guard is on the shape
 * rather than the sites: no limit may be read straight off the raw
 * subscription, and every one goes through entitledUsage, which takes counts
 * from the real workspace and limits from the previewed tier.
 */
test('the store checks limits against the previewed tier, not the raw plan', async () => {
  const store = await readFile(path.join(process.cwd(), 'src/store/useXbarStore.ts'), 'utf8');

  assert.doesNotMatch(
    store,
    /state\.subscription\.usage\.\w*Limit/,
    'a raw limit read here refuses a preview the outer gate has already allowed',
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
