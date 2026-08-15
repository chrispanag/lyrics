import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * These specs sign in for real, which means the browser talks directly to
 * `<app_id>.session.prelude.dev` — there is no way to fake that from the app
 * side, because the SDK owns the session and never routes through our API. So
 * the suite requires real Prelude credentials and skips itself without them
 * rather than failing in CI for a missing secret. See README → Running the
 * end-to-end tests.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    // Artifacts only for failures: a passing run should leave nothing behind.
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // The layout is mobile-first, so the mobile viewport is a first-class
    // target rather than an afterthought.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
