import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '*.spec.ts',
  outputDir: process.env.NAMI_TEST_RESULTS ?? '/tmp/nami-playwright-results',
  fullyParallel: true,
  workers: 2,
  reporter: 'list',
  use: { baseURL: process.env.NAMI_TEST_URL ?? 'http://127.0.0.1:3100', trace: 'off' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'ipad-webkit', use: { ...devices['iPad (gen 7)'], browserName: 'webkit' } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: process.env.NAMI_TEST_URL ? undefined : {
    command: 'node --import tsx tests/start-server.ts',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
