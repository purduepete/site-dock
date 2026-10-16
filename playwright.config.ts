import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'node tests/start-fixture.mjs',
    url: 'http://127.0.0.1:18790/',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  use: {
    channel: 'msedge',
    headless: true,
    baseURL: 'http://127.0.0.1:18790',
    trace: 'retain-on-failure',
  },
});
