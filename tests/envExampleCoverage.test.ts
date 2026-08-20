import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();

/*
 * .env.example is the only place that explains what each variable does, whether
 * it is safe in the browser, and what happens when it is missing. It is also
 * exactly the kind of file that silently falls behind the code: a variable gets
 * read in platformConfig.ts, nobody adds it here, and the next person
 * configuring a deployment has no way to discover it.
 *
 * These tests keep the two in step, in both directions.
 */

function read(file: string) {
  return readFileSync(path.join(repoRoot, file), 'utf8');
}

const envExample = read('.env.example');

function documentedKeys(): Set<string> {
  const keys = new Set<string>();
  for (const line of envExample.split('\n')) {
    // Assignments only; mentions inside prose do not count as documented.
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

test('every client variable the app reads is documented', () => {
  const config = read('src/lib/platformConfig.ts');
  const used = new Set([...config.matchAll(/env\.(VITE_[A-Z0-9_]+)/g)].map((match) => match[1]));
  const documented = documentedKeys();

  const missing = [...used].filter((key) => !envExample.includes(key)).sort();
  assert.deepEqual(missing, [], `read by platformConfig.ts but absent from .env.example: ${missing.join(', ')}`);

  // Each one must also appear as an assignment, not only in a comment, so it
  // can be copied straight into a .env.local.
  const mentionedOnly = [...used].filter((key) => !documented.has(key) && envExample.includes(key)).sort();
  assert.deepEqual(
    mentionedOnly,
    ['VITE_SUPABASE_RELATIONAL_MIRROR'],
    'only the deprecated relational-mirror alias may be described without an assignment line',
  );
});

test('the owner access and comp variables are documented', () => {
  // These decide who can see tier-gated screens, so an undocumented one is a
  // setting nobody knows to check when access looks wrong.
  for (const key of ['XBAR_COMP_EMAILS', 'VITE_XBAR_COMP_EMAILS', 'VITE_XBAR_LOCAL_OWNER_MODE']) {
    assert.ok(documentedKeys().has(key), `${key} is missing from .env.example`);
  }
});

test('the local owner flag is documented as off and unavailable in production', () => {
  assert.match(envExample, /VITE_XBAR_LOCAL_OWNER_MODE=false/, 'the example must ship it disabled');
  assert.match(envExample, /UNAVAILABLE IN PRODUCTION/);
});

test('no secret is documented with a client prefix', () => {
  // A VITE_ prefixed value is compiled into the browser bundle, so this is the
  // difference between a publishable key and a leaked one.
  const clientAssignments = [...envExample.matchAll(/^(VITE_[A-Z0-9_]+)=/gm)].map((match) => match[1]);

  for (const key of clientAssignments) {
    assert.doesNotMatch(
      key,
      /SERVICE_ROLE|SECRET|PRIVATE_KEY|_PASSWORD/,
      `${key} looks like a secret but is exposed to the browser`,
    );
  }
});

test('every documented server secret stays server-side in the code', () => {
  // The inverse mistake: a value documented as [server] but actually read from
  // import.meta.env, which would mean it never reaches the API at all.
  const config = read('src/lib/platformConfig.ts');

  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CRON_SECRET']) {
    assert.ok(documentedKeys().has(key), `${key} is missing from .env.example`);
    assert.doesNotMatch(config, new RegExp(`env\\.${key}\\b`), `${key} must not be read into the client bundle`);
  }
});

test('the billing section states what happens with Stripe absent', () => {
  // The behaviour this branch exists to guarantee, written where an operator
  // will actually look for it.
  assert.match(envExample, /Billing not configured yet/);
  assert.match(envExample, /No checkout opens, no subscription record is created/);
});
