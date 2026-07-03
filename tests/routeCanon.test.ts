import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalRoutes, legacyRouteRedirects } from '../src/lib/routeCanon.js';

const canonicalSet = new Set(Object.values(canonicalRoutes));

test('every legacy route redirects to a canonical product route', () => {
  for (const [from, to] of Object.entries(legacyRouteRedirects)) {
    assert.ok(canonicalSet.has(to as (typeof canonicalRoutes)[keyof typeof canonicalRoutes]), `${from} must redirect to a canonical route, got ${to}`);
    assert.ok(!canonicalSet.has(from as never), `${from} is legacy and must not also be canonical`);
  }
});

test('all known legacy paths stay in the redirect map so they never return as live routes', () => {
  const requiredLegacy = [
    '/animals',
    '/documents-vault',
    '/document-library',
    '/sales-pipeline',
    '/buyer-deal-room',
    '/buyer-follow-up',
    '/sale-packet-studio',
    '/plans',
    '/subscribe',
    '/subscriptions',
  ];
  for (const path of requiredLegacy) {
    assert.ok(legacyRouteRedirects[path], `missing redirect for legacy path ${path}`);
  }
});

test('canonical routes are one per product area', () => {
  assert.equal(canonicalRoutes.horses, '/horses');
  assert.equal(canonicalRoutes.documents, '/documents');
  assert.equal(canonicalRoutes.sales, '/sales');
  assert.equal(canonicalRoutes.buyers, '/buyers');
  assert.equal(canonicalRoutes.salePackets, '/sale-packets');
  assert.equal(canonicalRoutes.billing, '/billing');
  assert.equal(canonicalRoutes.settings, '/settings');
});
