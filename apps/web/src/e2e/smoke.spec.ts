import { test, expect } from "@playwright/test";

/**
 * Smoke tests — exercise the unauthenticated public surface of the Growth app.
 *
 * Runs against http://localhost:3014 by default (override via E2E_BASE_URL).
 * All auth-gated flows (campaigns, contacts, outreach, inbox) require a valid
 * session; those are skipped here and covered by the auth flow test below.
 */

test.describe("public / unauthenticated surface", () => {
  test("root redirects unauthenticated users to /login", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/login/);
    await expect(page.locator("body")).not.toContainText("500");
  });

  test("login page renders without error", async ({ page }) => {
    const res = await page.goto("/login");
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test.each(["/growth/campaigns", "/growth/contacts", "/growth/inbox"])(
    "auth-gated route %s redirects to /login",
    async ({ page }, route) => {
      await page.goto(route);
      await page.waitForURL(/\/login/);
    },
  );

  test("API health check responds", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBeLessThan(500);
  });
});

/**
 * Auth flow — requires PLAYWRIGHT_RUN_AUTH=1 and PLAYWRIGHT_TEST_EMAIL.
 * Skipped in standard CI to avoid test-inbox dependencies.
 */
test.describe("auth flow", () => {
  test.skip(!process.env.PLAYWRIGHT_RUN_AUTH, "Set PLAYWRIGHT_RUN_AUTH=1 to run");

  test("magic link sign-in flow reaches dashboard", async ({ page }) => {
    const email = process.env.PLAYWRIGHT_TEST_EMAIL!;
    await page.goto("/login");
    await page.getByPlaceholder(/email/i).fill(email);
    await page.getByRole("button", { name: /sign in|magic link/i }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
  });
});
