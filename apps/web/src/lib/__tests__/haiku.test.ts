import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPrisma = { auditLog: { findMany: vi.fn(), create: vi.fn() } };
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { weekStartUtc, costUsd, haikuAvailable, weeklyBudgetUsd, openaiBackupAvailable, openaiCostUsd, openaiBackupModel } = await import("@/lib/ai/haiku");

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.OPENAI_API_KEY = "o";
  delete process.env.HAIKU_WEEKLY_BUDGET_USD;
  delete process.env.OPENAI_WEEKLY_BUDGET_USD;
  delete process.env.OPENAI_BACKUP_MODEL;
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

  it("counts each vendor's spend against its own $1 cap", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValue([{ metadata: { usd: 0.5 } }]);
    expect(await openaiBackupAvailable()).toBe(true);
    expect(mockPrisma.auditLog.findMany.mock.calls[0][0].where.entity).toBe("OpenAI");
    await haikuAvailable();
    expect(mockPrisma.auditLog.findMany.mock.calls[1][0].where.entity).toBe("Anthropic");
    mockPrisma.auditLog.findMany.mockResolvedValue([{ metadata: { usd: 1.01 } }]);
    expect(await openaiBackupAvailable()).toBe(false);
  });

  it("prices the OpenAI backup and lets the model be overridden", () => {
    expect(openaiCostUsd(1_000_000, 1_000_000)).toBe(2.25);
    expect(openaiBackupModel()).toBe("gpt-5-mini");
    process.env.OPENAI_BACKUP_MODEL = "gpt-x-mini";
    expect(openaiBackupModel()).toBe("gpt-x-mini");
  });

  it("OpenAI backup is unavailable without a key", async () => {
    delete process.env.OPENAI_API_KEY;
    expect(await openaiBackupAvailable()).toBe(false);
  });
});
