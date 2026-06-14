import { test, expect } from "@playwright/test";

/**
 * Auth flows for the Growth app (Next.js on port 3014).
 */

test.describe("login page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
  });

  test("renders with non-error title", async ({ page }) => {
    const title = await page.title();
    expect(title).not.toBe("");
    expect(title.toLowerCase()).not.toContain("error");
  });

  test("shows email input and sign-in button", async ({ page }) => {
    const emailInput = page.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|magic link|send/i })).toBeVisible();
  });

  test("empty form submission stays on /login", async ({ page }) => {
    await page.getByRole("button", { name: /sign in|magic link|send/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("does not reveal user existence on unknown email", async ({ page }) => {
    await page.locator('input[type="email"]').first().fill("e2e-unknown@growth.test");
    await page.getByRole("button", { name: /sign in|magic link|send/i }).first().click();
    await expect(page.getByText(/not found|no account/i)).not.toBeVisible({ timeout: 4_000 });
  });
});

test.describe("verify page", () => {
  test("renders without crashing on direct load", async ({ page }) => {
    const res = await page.goto("/login/verify");
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText("Application error");
  });

  test("shows error for invalid token", async ({ page }) => {
    await page.goto("/login/verify?token=bad-token-e2e");
    await expect(page.getByText(/invalid|expired|error|try again/i)).toBeVisible({ timeout: 8_000 });
  });
});

test.describe("NextAuth session", () => {
  test("GET /api/auth/providers responds without 500", async ({ request }) => {
    const res = await request.get("/api/auth/providers");
    expect(res.status()).toBeLessThan(500);
  });

  test("GET /api/auth/session returns empty for unauthenticated", async ({ request }) => {
    const res = await request.get("/api/auth/session");
    expect(res.status()).toBe(200);
  });
});
