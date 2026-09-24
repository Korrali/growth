import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = {
  emailMessage: { findFirst: vi.fn(), count: vi.fn() },
  campaign: { findMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { warmupCap, campaignShare, checkSendBudget } = await import("@/lib/sending/send-budget");

const NOW = new Date("2026-10-15T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SEND_CAP_CEILING;
  mockPrisma.campaign.findMany.mockResolvedValue([
    { id: "rev", dailyLimit: 60 },
    { id: "trust", dailyLimit: 40 },
  ]);
});
afterEach(() => { delete process.env.SEND_CAP_CEILING; });

describe("warmupCap", () => {
  it("starts at 30 and grows 10 a week up to the ceiling", () => {
    expect(warmupCap(null, NOW)).toBe(30);
    expect(warmupCap(daysAgo(6), NOW)).toBe(30);
    expect(warmupCap(daysAgo(7), NOW)).toBe(40);
    expect(warmupCap(daysAgo(21), NOW)).toBe(60);
    expect(warmupCap(daysAgo(200), NOW)).toBe(80);
  });

  it("respects SEND_CAP_CEILING", () => {
    process.env.SEND_CAP_CEILING = "45";
    expect(warmupCap(daysAgo(200), NOW)).toBe(45);
  });
});

describe("campaignShare", () => {
  it("splits the total by weight, never below 1 for an active campaign", () => {
    expect(campaignShare(30, 60, 100)).toBe(18);
    expect(campaignShare(30, 40, 100)).toBe(12);
    expect(campaignShare(80, 40, 100)).toBe(32);
    expect(campaignShare(5, 1, 100)).toBe(1);
    expect(campaignShare(30, 0, 100)).toBe(0);
  });
});

describe("checkSendBudget", () => {
  it("allows while both the total and the campaign share have room", async () => {
    mockPrisma.emailMessage.findFirst.mockResolvedValue(null);
    mockPrisma.emailMessage.count.mockResolvedValueOnce(10).mockResolvedValueOnce(5);
    expect(await checkSendBudget("trust", NOW)).toEqual({ allowed: true });
  });

  it("blocks a campaign that used its share even when the total has room", async () => {
    mockPrisma.emailMessage.findFirst.mockResolvedValue(null);
    mockPrisma.emailMessage.count.mockResolvedValueOnce(20).mockResolvedValueOnce(12);
    expect(await checkSendBudget("trust", NOW)).toEqual({
      allowed: false,
      reason: "daily_limit_reached:campaign:12/12",
    });
  });

  it("blocks everything once the warm-up total is reached", async () => {
    mockPrisma.emailMessage.findFirst.mockResolvedValue({ sentAt: daysAgo(8) });
    mockPrisma.emailMessage.count.mockResolvedValueOnce(40).mockResolvedValueOnce(0);
    expect(await checkSendBudget("rev", NOW)).toEqual({
      allowed: false,
      reason: "daily_limit_reached:total:40/40",
    });
  });
});
