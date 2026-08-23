import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * These specs sign in for real, which means the browser talks directly to the
 * Prelude session domain — there is no way to fake that from the app side,
 * because the SDK owns the session and never routes through our API. So
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

  // `npm run dev` is `next dev`, which answers this URL before it has compiled
  // the page — the first request is what triggers that, and it is slower than
  // anything Vite did here. So the wait is longer than the 60s it was, and it
  // covers a cold .next as well: point E2E_BASE_URL at an already-running
  // server to skip all of it.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
