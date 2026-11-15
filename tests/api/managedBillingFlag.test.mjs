import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clientManagedBillingEnabled, serverManagedBillingEnabled } from '../../api/_lib/managed-billing.js';
import { dedicatedCheckoutScope, scopedEventMatchesOwnership } from '../../scripts/lib/dedicated-stripe-scope.mjs';

/*
 * Two conventions for one switch.
 *
 * `/api/health` accepted the ordinary truthy set — 1, true, yes, on — while
 * the checkout endpoint required the literal string `true`. A deployment
 * configured with `MANAGED_BILLING_ENABLED=1` therefore had a readiness probe
 * reporting healthy, a client offering checkout, and a server rejecting every
 * request as paused: green, and unable to sell, with every variable set so
 * nothing else could notice.
 */

test('the server enables billing only on the value it documents', () => {
  assert.equal(serverManagedBillingEnabled({ MANAGED_BILLING_ENABLED: 'true' }), true);
  assert.equal(serverManagedBillingEnabled({ MANAGED_BILLING_ENABLED: '  TRUE  ' }), true, 'trimmed and case-folded');

  /*
   * The strict reading wins because it is the one that ACTS. Widening it
   * would turn real billing on for any deployment that wrote 1 and has been
   * safely inert until now, which a parser cleanup does not get to do.
   */
  for (const value of ['1', 'yes', 'on', 'false', '', undefined]) {
    assert.equal(
      serverManagedBillingEnabled({ MANAGED_BILLING_ENABLED: value }),
      false,
      `${JSON.stringify(value)} must not create Stripe sessions`,
    );
  }
});

test('the client flag is modelled the way the client actually reads it', () => {
  /*
   * Not the same rule, deliberately. `platformConfig` uses a generic reader
   * shared with every other VITE_ flag, so it accepts the broad set — and a
   * probe that pretended otherwise would report a client that does not exist.
   */
  for (const value of ['1', 'true', 'yes', 'on', 'ON']) {
    assert.equal(clientManagedBillingEnabled({ VITE_MANAGED_BILLING_ENABLED: value }), true, value);
  }
  for (const value of ['false', 'off', '', undefined]) {
    assert.equal(clientManagedBillingEnabled({ VITE_MANAGED_BILLING_ENABLED: value }), false, String(value));
  }

  // And that claim is checked against the client rather than asserted.
  const platform = readFileSync('src/lib/platformConfig.ts', 'utf8');
  assert.match(platform, /\['1', 'true', 'yes', 'on'\]\.includes\(normalized\)/, 'the client truthy set must match');
});

test('the checkout endpoint and the probe answer from the same function', () => {
  /*
   * A choke point rather than two parsers kept in step by hand — keeping them
   * in step by hand is exactly what failed. A second literal comparison
   * anywhere here is the defect coming back.
   */
  for (const file of ['api/health.js', 'api/stripe/checkout.js']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /serverManagedBillingEnabled\(\)/, `${file} must ask the shared function`);
    assert.doesNotMatch(
      source.replace(/\/\*[\s\S]*?\*\//g, ''),
      /MANAGED_BILLING_ENABLED\?\.trim\(\)/,
      `${file} must not parse the flag itself`,
    );
  }
});

test('a client that offers checkout the server will refuse is reported', () => {
  /*
   * The mismatch is not a missing value — every variable is set — so none of
   * the other readiness checks can see it, and it is the one shape that fails
   * for the customer at the moment they try to pay.
   */
  const health = readFileSync('api/health.js', 'utf8');
  assert.match(
    health,
    /if \(subsystems\.clientManagedBilling && !subsystems\.managedBilling\) \{/,
    'the probe must name the mismatch itself',
  );
  assert.match(health, /offers checkout the server will refuse/);
});

const legacyAccountId = 'acct_LegacyFixture';
const dedicated = { accountId: 'acct_DedicatedFixture', livemode: false };
const workspaceId = '11111111-1111-4111-8111-111111111111';
const fresh = { kind: 'verified-new', workspaceId };
const bound = { ...dedicated, kind: 'bound', workspaceId, customerId: 'cus_DedicatedFixture' };
const dedicatedContext = { enabled: 'true', legacyAccountId, dedicated, verified: dedicated, workspaceId };

test('dedicated checkout is off by default and never changes the legacy flag', () => {
  for (const enabled of [undefined, false, true, 'false', '1', 'yes', 'TRUE']) {
    assert.deepEqual(dedicatedCheckoutScope({ ...dedicatedContext, enabled, ownership: fresh }), { route: 'off' });
  }
  assert.equal(serverManagedBillingEnabled({ XBAR_DEDICATED_CHECKOUT_ENABLED: 'true' }), false);
  assert.equal(
    serverManagedBillingEnabled({ MANAGED_BILLING_ENABLED: 'true', XBAR_DEDICATED_CHECKOUT_ENABLED: 'false' }),
    true,
  );
});

test('dedicated checkout requires independently verified, distinct account and mode', () => {
  for (const override of [
    { legacyAccountId: undefined },
    { legacyAccountId: dedicated.accountId },
    { dedicated: undefined },
    { dedicated: { ...dedicated, accountId: 'invalid' } },
    { dedicated: { accountId: dedicated.accountId } },
    { verified: undefined },
    { verified: { ...dedicated, accountId: legacyAccountId } },
    { verified: { ...dedicated, livemode: true } },
  ]) {
    assert.deepEqual(dedicatedCheckoutScope({ ...dedicatedContext, ...override, ownership: fresh }), {
      route: 'blocked',
      reason: 'account_unverified',
    });
  }
});

test('dedicated checkout only admits a proven new workspace or reuses its own bound customer', () => {
  for (const ownership of [
    undefined,
    {},
    { kind: 'unverified', workspaceId },
    { ...fresh, workspaceId: 'another-workspace' },
    { ...fresh, customerId: 'cus_NotFresh' },
    { ...bound, accountId: legacyAccountId },
    { ...bound, livemode: true },
    { ...bound, customerId: '' },
  ]) {
    assert.deepEqual(dedicatedCheckoutScope({ ...dedicatedContext, ownership }), {
      route: 'blocked',
      reason: 'ownership_unverified',
    });
  }
  assert.deepEqual(dedicatedCheckoutScope({ ...dedicatedContext, ownership: fresh }), {
    route: 'dedicated',
    accountId: dedicated.accountId,
    customerId: null,
  });
  assert.deepEqual(dedicatedCheckoutScope({ ...dedicatedContext, ownership: bound }), {
    route: 'dedicated',
    accountId: dedicated.accountId,
    customerId: bound.customerId,
  });
});

test('webhook scope permits a write only for the exact account, mode, workspace and customer', () => {
  const event = { source: dedicated, workspaceId, ownership: bound, customerId: bound.customerId };
  const writes = [];
  for (const override of [
    { source: undefined },
    { source: { accountId: dedicated.accountId } },
    { source: { ...dedicated, accountId: legacyAccountId } },
    { source: { ...dedicated, livemode: true } },
    { workspaceId: 'another-workspace' },
    { ownership: fresh },
    { ownership: { ...bound, accountId: undefined } },
    { customerId: 'cus_Different' },
    { customerId: undefined },
  ]) {
    if (scopedEventMatchesOwnership({ ...event, ...override })) writes.push(override);
  }
  assert.deepEqual(writes, []);
  assert.equal(scopedEventMatchesOwnership(event), true);
});
