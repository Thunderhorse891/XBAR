import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { isQuickStartSentinel, sellerIdentity } from '../../api/_lib/workspace-identity.js';

/*
 * The quick-start sentinel policy is independently duplicated: the client
 * filters buyer-facing identity in src/lib/workspaceIdentity.ts (local sale
 * packets, share captions, report exports) and the server filters it in
 * api/_lib/workspace-identity.js (cloud packet sender identity, PDF cover,
 * sealed seller names) because API routes cannot import the client bundle.
 *
 * Two copies of a buyer-identity policy drift silently: adding or renaming a
 * quick-start placeholder on one side would leave cloud packets filtering a
 * different identity set from local packets while every other test stays
 * green. This extracts and compares both lists as text — the same approach
 * as the permissions parity test, because the client copy is TypeScript and
 * this suite runs on plain node — so the drift fails the build.
 */

function parseSentinelList(filePath) {
  const source = readFileSync(new URL(filePath, import.meta.url), 'utf8');
  const start = source.indexOf('const QUICK_START_IDENTITY_SENTINELS');
  assert.notEqual(start, -1, `${filePath} must declare QUICK_START_IDENTITY_SENTINELS`);
  const end = source.indexOf('];', start);
  assert.notEqual(end, -1, `${filePath} QUICK_START_IDENTITY_SENTINELS must be a closed array literal`);
  const entries = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.ok(entries.length > 0, `${filePath} sentinel list must not parse empty`);
  return entries.sort();
}

test('the client and server sentinel lists are identical', () => {
  const client = parseSentinelList('../../src/lib/workspaceIdentity.ts');
  const server = parseSentinelList('../../api/_lib/workspace-identity.js');
  assert.deepEqual(server, client, 'both copies must filter exactly the same quick-start placeholders');
});

test('the server filters the full observed quick-start set', () => {
  // handleQuickStart (src/routes/SetupWorkspace.tsx) invents these values;
  // every one of them must be filtered, not just the examples above.
  for (const sentinel of ['My Ranch LLC', 'Main Ranch', 'Operations Lead', 'owner@ranch.local']) {
    assert.ok(isQuickStartSentinel(sentinel), `${sentinel} must be treated as a placeholder`);
  }
  const identity = sellerIdentity({
    businessName: 'My Ranch LLC',
    ranchName: 'Main Ranch',
    operationsEmail: 'owner@ranch.local',
  });
  assert.deepEqual(
    identity,
    { business: '', ranch: '', email: '', display: '' },
    'a quick-start workspace must expose no invented sender identity',
  );
  const real = sellerIdentity({
    businessName: 'Rocking R LLC',
    ranchName: 'Rocking R Ranch',
    operationsEmail: 'ranch@rockingr.test',
  });
  assert.equal(real.business, 'Rocking R LLC');
  assert.equal(real.ranch, 'Rocking R Ranch');
  assert.equal(real.email, 'ranch@rockingr.test');
});
