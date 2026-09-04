import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clientManagedBillingEnabled, serverManagedBillingEnabled } from '../../api/_lib/managed-billing.js';

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
