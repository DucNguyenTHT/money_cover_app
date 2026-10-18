import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * Default (`pnpm e2e`): starts its OWN stack — API on :4100 and web on :5273 over a throwaway database
 * `ketoan_e2e` that is reset at every run — so the tests never write into the dev data.
 *
 * Against an app that is already running (CI, the production stack): set
 *   BASE_URL            — e.g. http://localhost:5173
 *   E2E_USER / E2E_PASS — an ADMIN account with PIN 2580 and the password already changed
 */
const external = !!process.env.BASE_URL;
const E2E_DB =
  process.env.E2E_DATABASE_URL ?? 'postgresql://ketoan:ketoan@localhost:5433/ketoan_e2e?schema=public';
if (!external) {
  process.env.E2E_USER ??= 'e2e_admin';
  process.env.E2E_PASS ??= 'E2e-pass-2026';
}

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5273',
    trace: 'retain-on-failure',
    // The production stack uses Caddy's local CA, which the test browser does not trust.
    ignoreHTTPSErrors: true,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: external
    ? undefined
    : [
        {
          command: 'node setup-db.mjs && pnpm --filter @ketoan/api exec tsx src/main.ts',
          url: 'http://localhost:4100/api/health',
          timeout: 180_000,
          reuseExistingServer: false,
          stdout: 'ignore',
          stderr: 'pipe',
          env: {
            DATABASE_URL: E2E_DB,
            PORT: '4100',
            CORS_ORIGIN: 'http://localhost:5273',
            UPLOAD_DIR: 'storage/e2e-documents',
            E2E_USER: process.env.E2E_USER!,
            E2E_PASS: process.env.E2E_PASS!,
          },
        },
        {
          command: 'pnpm --filter @ketoan/web exec vite --port 5273 --strictPort',
          url: 'http://localhost:5273',
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: 'ignore',
          env: { API_URL: 'http://localhost:4100' },
        },
      ],
});
