import { defineConfig } from '@playwright/test';

// Dedicated config that runs the PRODUCTION build (vite preview serving `dist`),
// NOT the dev server. This catches production-only Rollup/Vite failures — e.g.
// the blank-white-screen bug where `react` and `react-dom` were split into
// separate chunks and never mounted. The build is produced by the
// `test:prod-smoke` npm script before this config runs; the webServer only
// serves the already-built `dist` output.
export default defineConfig({
  testDir: './tests/prod-smoke',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  // A real blank-screen/bundle regression fails every attempt; retries only
  // absorb cold-start flake when vite preview has just booted in CI.
  retries: process.env.CI ? 2 : 1,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Point at a preinstalled Chromium when the bundled browser is unavailable
    // (e.g. restricted CI/sandbox). Set XBAR_CHROME=/path/to/chrome.
    ...(process.env.XBAR_CHROME ? { launchOptions: { executablePath: process.env.XBAR_CHROME } } : {}),
  },
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js preview --host 0.0.0.0 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
