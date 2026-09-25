import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { auditLog: { findMany: vi.fn(), create: vi.fn() } };
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { weekStartUtc, costUsd, haikuAvailable, weeklyBudgetUsd } = await import("@/lib/ai/haiku");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "k";
  delete process.env.HAIKU_WEEKLY_BUDGET_USD;
});

describe("haiku budget", () => {
  it("weeks start Monday 00:00 UTC", () => {
    expect(weekStartUtc(new Date("2026-09-25T10:00:00Z")).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-09-21T00:00:01Z")).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-09-27T23:59:00Z")).toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("prices Haiku at $1 in / $5 out per million tokens", () => {
    expect(costUsd(1_000_000, 0)).toBe(1);
    expect(costUsd(1500, 200)).toBeCloseTo(0.0025, 6);
  });

  it("defaults to a $1 cap and stops at it", async () => {
    expect(weeklyBudgetUsd()).toBe(1);
    mockPrisma.auditLog.findMany.mockResolvedValue([{ metadata: { usd: 0.6 } }, { metadata: { usd: 0.3 } }]);
    expect(await haikuAvailable()).toBe(true);
    mockPrisma.auditLog.findMany.mockResolvedValue([{ metadata: { usd: 0.6 } }, { metadata: { usd: 0.41 } }]);
    expect(await haikuAvailable()).toBe(false);
  });

  it("is unavailable without a key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await haikuAvailable()).toBe(false);
  });
});
