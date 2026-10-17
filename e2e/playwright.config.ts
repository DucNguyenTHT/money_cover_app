import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against a running app (dev servers or the production stack).
 * They create their own dishes / ingredients with unique codes, so use a throwaway database.
 *   E2E_USER / E2E_PASS — an ADMIN account with PIN set and password already changed
 *   BASE_URL            — default http://localhost:5173
 */
export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    // The production stack uses Caddy's local CA, which the test browser does not trust.
    ignoreHTTPSErrors: true,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
});
