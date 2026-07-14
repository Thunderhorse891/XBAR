import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // Real regressions fail every attempt; a single retry absorbs dev-server
  // cold-transform flake in constrained sandboxes (same policy as prod-smoke).
  retries: process.env.CI ? 2 : 1,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Allow pointing at a preinstalled Chromium when the bundled browser is
    // unavailable (e.g. restricted CI/sandbox). Set XBAR_CHROME=/path/to/chrome.
    ...(process.env.XBAR_CHROME ? { launchOptions: { executablePath: process.env.XBAR_CHROME } } : {}),
  },
  webServer: {
    command:
      'node ./scripts/prepare-ocr-assets.mjs && node ./node_modules/vite/bin/vite.js --mode e2e --host 0.0.0.0 --port 4174',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    env: {
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
      VITE_ALLOW_LOCAL_MODE: 'true',
      VITE_RUNTIME_MONITORING_ENABLED: 'false',
      VITE_ROUTER_MODE: 'browser',
      VITE_SUPABASE_RELATIONAL_SYNC: 'false',
      VITE_SUPABASE_SNAPSHOT_FALLBACK: 'false',
      VITE_STATIC_TARGET: 'web',
    },
  },
});
