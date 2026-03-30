import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'node ./node_modules/vite/bin/vite.js --mode e2e --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174/setup',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
