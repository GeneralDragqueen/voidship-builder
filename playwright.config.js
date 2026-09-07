import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 4,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}/voidship-builder/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node tools/test-server.mjs',
    url: `http://127.0.0.1:${port}/voidship-builder/`,
    reuseExistingServer: false,
    timeout: 10_000,
  },
});
