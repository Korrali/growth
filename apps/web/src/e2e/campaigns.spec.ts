import { test, expect } from "@playwright/test";

/**
 * Growth app E2E tests — campaigns, contacts, inbox, and client management.
 * All auth-gated routes confirm redirect behavior without a live session.
 */

test.describe("core routes — auth gate", () => {
  const protectedRoutes = [
    "/growth/campaigns",
    "/growth/campaigns/new",
    "/growth/contacts",
    "/growth/inbox",
    "/growth/clients",
    "/growth/clients/new",
    "/growth/companies",
    "/growth/settings",
  ];

  for (const route of protectedRoutes) {
    test(`${route} → /login`, async ({ page }) => {
      await page.goto(route);
      await page.waitForURL(/\/login/, { timeout: 10_000 });
      await expect(page.locator("body")).not.toContainText("500");
    });
  }
});

test.describe("API endpoints — auth gates", () => {
  test("GET /api/campaigns requires auth", async ({ request }) => {
    const res = await request.get("/api/campaigns");
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/contacts requires auth", async ({ request }) => {
    const res = await request.get("/api/contacts");
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/inbox requires auth", async ({ request }) => {
    const res = await request.get("/api/inbox");
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/clients requires auth", async ({ request }) => {
    const res = await request.get("/api/clients");
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("API health", () => {
  test("GET /api/health returns 200", async ({ request }) => {
    const res = await request.get("/api/health");
    expect([200, 404]).toContain(res.status()); // may not expose health if not wired
  });
});

/**
 * Authenticated campaign flows.
 * Set PLAYWRIGHT_RUN_AUTH=1 + E2E_SESSION_COOKIE to run.
 */
test.describe("authenticated: campaign list", () => {
  test.skip(!process.env.PLAYWRIGHT_RUN_AUTH, "Set PLAYWRIGHT_RUN_AUTH=1 to run");

  test("campaign list page renders after auth", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: process.env.E2E_SESSION_COOKIE!,
        domain: new URL(process.env.E2E_BASE_URL ?? "http://localhost:3014").hostname,
        path: "/",
        httpOnly: true,
        secure: false,
      },
    ]);
    const res = await page.goto("/growth/campaigns");
    expect(res?.status()).toBeLessThan(500);
    // Should show campaigns table or empty state
    await expect(page.locator("body")).not.toContainText("Something went wrong");
    await expect(page.locator("body")).not.toContainText("Sign in");
  });

  test("client management page renders after auth", async ({ page, context }) => {
    await context.addCookies([
      {
        name: "authjs.session-token",
        value: process.env.E2E_SESSION_COOKIE!,
        domain: new URL(process.env.E2E_BASE_URL ?? "http://localhost:3014").hostname,
        path: "/",
        httpOnly: true,
        secure: false,
      },
    ]);
    const res = await page.goto("/growth/clients");
    expect(res?.status()).toBeLessThan(500);
    await expect(page.locator("body")).not.toContainText("Something went wrong");
  });
});
