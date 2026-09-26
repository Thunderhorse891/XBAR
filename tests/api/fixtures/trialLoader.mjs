/*
 * ESM loader for the trial endpoint behavioral tests.
 *
 * The Supabase admin boundary is module-private inside
 * api/_lib/account-trial-start.js and api/_lib/reminders-trial.js (both reach
 * it through ./supabase-admin.js), so the tests cannot swap in a fake without
 * redirecting the import. This loader redirects the './supabase-admin.js'
 * specifier to the fixture stub in this directory, which hands each handler a
 * scripted boundary chosen by the test.
 *
 * What is NOT stubbed: the trial policy itself (api/_lib/trial-status.js),
 * request validation, rate limiting, CORS, and the lifecycle email
 * orchestration — those run for real against the scripted database boundary,
 * which is exactly the contract under test.
 *
 * Register from the test file before dynamically importing the handler:
 *
 *   import { register } from 'node:module';
 *   register(new URL('./fixtures/trialLoader.mjs', import.meta.url));
 *   const { default: handler } = await import('../../api/_lib/account-trial-start.js');
 *
 * Static imports in the test file are linked before register() runs, so the
 * handler itself must be imported dynamically.
 */

export async function resolve(specifier, context, nextResolve) {
  if (specifier === './supabase-admin.js') {
    return {
      url: new URL('./trialSupabaseAdminStub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
