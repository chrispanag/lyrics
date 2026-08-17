import { expect, test } from "@playwright/test";

/*
 * End-to-end smoke suite.
 *
 * Split in two deliberately. The browsing half needs nothing but a running
 * stack, so it guards the guest experience on every run. The signed-in half
 * needs a real Prelude application, because `loginWithPassword` goes straight
 * from the browser to the session domain and cannot be stubbed from the app
 * side. Rather than fail CI over a missing secret, that half skips itself and
 * says why.
 */

const hasPreludeCredentials = Boolean(
  process.env.VITE_PRELUDE_APP_ID && process.env.E2E_USER_EMAIL && process.env.E2E_USER_PASSWORD,
);

test.describe("browsing as a guest", () => {
  test("can search the catalog and open a song", async ({ page }) => {
    await page.goto("/");

    // The seeded catalog is the fixture; `make seed` must have run.
    await expect(page.getByRole("searchbox", { name: /search songs/i })).toBeVisible();

    await page.getByRole("searchbox", { name: /search songs/i }).fill("θάλασσα");

    const firstResult = page.getByRole("link").filter({ hasText: "Θάλασσα" }).first();
    await expect(firstResult).toBeVisible({ timeout: 10_000 });

    await firstResult.click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Θάλασσα");
    await expect(page.getByRole("heading", { name: /lyrics/i })).toBeVisible();
  });

  test("an unaccented query finds the accented song", async ({ page }) => {
    await page.goto("/?q=θαλασσα");
    await expect(page.getByRole("link").filter({ hasText: "Θάλασσα" }).first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test("guests are asked to sign in before reaching lists", async ({ page }) => {
    await page.goto("/lists");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the mobile layout has no horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.getByRole("searchbox", { name: /search songs/i })).toBeVisible();

    // A page wider than its viewport is the classic mobile layout bug.
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, "page scrolls horizontally on a 390px viewport").toBe(false);
  });
});

test.describe("signed in", () => {
  test.skip(
    !hasPreludeCredentials,
    "Set VITE_PRELUDE_APP_ID, E2E_USER_EMAIL, and E2E_USER_PASSWORD to run the " +
      "signed-in flow against a real Prelude application.",
  );

  test("can sign in, create a list, and save a song to it", async ({ page }) => {
    const listName = `E2E ${Date.now()}`;

    await page.goto("/login");
    await page.getByLabel("Email").fill(process.env.E2E_USER_EMAIL!);
    await page.getByLabel("Password").fill(process.env.E2E_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL("/", { timeout: 15_000 });

    await page.goto("/lists");
    await page.getByRole("button", { name: /new list/i }).click();
    await page.getByLabel("Name").fill(listName);
    await page.getByRole("button", { name: /create list/i }).click();
    await expect(page.getByText(listName)).toBeVisible();

    await page.goto("/");
    await page.getByRole("link").filter({ hasText: "Θάλασσα" }).first().click();
    await page.getByRole("button", { name: /save/i }).click();

    const listToggle = page.getByRole("button", { name: new RegExp(listName) });
    await listToggle.click();
    await expect(listToggle).toHaveAttribute("aria-pressed", "true");
  });
});
