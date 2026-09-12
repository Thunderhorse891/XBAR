import { defineConfig } from '@playwright/test';

/*
 * The reset flow with relational sync ON and the workspace API held open.
 *
 * The auth-smoke bundle pins relational sync OFF, so nothing in that suite
 * ever waits on the PostgREST queries the store makes against `workspaces`
 * before it publishes a session. That is exactly the wait a validated recovery
 * used to sit behind, so reproducing it needs a second bundle -- built by
 * scripts/build-auth-slow-workspace.mjs on its own port, so the two dist
 * outputs never serve each other.
 */
export default defineConfig({
  testDir: './tests/auth-slow-workspace',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? 'github' : 'line',
  use: {
    // Same origin the bundle was compiled with (see build-auth-smoke.mjs):
    // the Supabase client points here too, so auth calls stay same-origin and
    // are interceptable rather than leaving the machine.
    baseURL: 'http://127.0.0.1:4179',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Point at a preinstalled Chromium when the bundled browser is unavailable
    // (e.g. restricted CI/sandbox). Set XBAR_CHROME=/path/to/chrome.
    ...(process.env.XBAR_CHROME ? { launchOptions: { executablePath: process.env.XBAR_CHROME } } : {}),
  },
  webServer: {
    command: 'node ./scripts/serve-dist.mjs --port 4179',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
