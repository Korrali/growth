import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPrisma = {
  emailMessage: { findFirst: vi.fn(), count: vi.fn() },
  campaign: { findMany: vi.fn() },
  outreach: { count: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { warmupCap, campaignShare, checkSendBudget, globalDailyCap } = await import("@/lib/sending/send-budget");

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

describe("one-off day totals and audit-firm batches", () => {
  const BATCH_DAY = new Date("2026-10-06T15:00:00Z");
  const withAuditor = [
    { id: "rev", dailyLimit: 60, audience: "DIRECT" },
    { id: "trust", dailyLimit: 40, audience: "DIRECT" },
    { id: "revFirm", dailyLimit: 60, audience: "FIRM" },
    { id: "trustFirm", dailyLimit: 40, audience: "FIRM" },
    { id: "cpa", dailyLimit: 100, audience: "AUDITOR" },
  ];

  it("raises the total on the batch and follow-up days only", async () => {
    mockPrisma.emailMessage.findFirst.mockResolvedValue({ sentAt: new Date("2026-09-25T08:00:00Z") });
    expect(await globalDailyCap(BATCH_DAY)).toBe(60);
    expect(await globalDailyCap(new Date("2026-10-13T15:00:00Z"))).toBe(60);
    expect(await globalDailyCap(new Date("2026-10-07T15:00:00Z"))).toBe(40);
    expect(await globalDailyCap(new Date("2026-10-12T15:00:00Z"))).toBe(75);
    expect(await globalDailyCap(new Date("2026-10-19T15:00:00Z"))).toBe(90);
    expect(await globalDailyCap(new Date("2026-10-20T15:00:00Z"))).toBe(60);
  });

  it("gives the audit-firm batch 20 of the 60 and leaves the others their 40", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue(withAuditor);
    mockPrisma.emailMessage.findFirst.mockResolvedValue({ sentAt: new Date("2026-09-25T08:00:00Z") });
    mockPrisma.outreach.count.mockResolvedValue(20);
    mockPrisma.emailMessage.count.mockResolvedValueOnce(20).mockResolvedValueOnce(20);
    expect(await checkSendBudget("cpa", BATCH_DAY)).toEqual({ allowed: false, reason: "daily_limit_reached:campaign:20/20" });
    mockPrisma.emailMessage.count.mockResolvedValueOnce(20).mockResolvedValueOnce(12);
    expect(await checkSendBudget("rev", BATCH_DAY)).toEqual({ allowed: false, reason: "daily_limit_reached:campaign:12/12" });
  });

  it("gives an idle audit-firm campaign no share", async () => {
    mockPrisma.campaign.findMany.mockResolvedValue(withAuditor);
    mockPrisma.emailMessage.findFirst.mockResolvedValue({ sentAt: new Date("2026-09-25T08:00:00Z") });
    mockPrisma.outreach.count.mockResolvedValue(0);
    // 7 Oct: total 40, Revenue's share is 40 * 60/200 = 12, as if the campaign weren't there.
    mockPrisma.emailMessage.count.mockResolvedValueOnce(11).mockResolvedValueOnce(11);
    expect(await checkSendBudget("rev", new Date("2026-10-07T15:00:00Z"))).toEqual({ allowed: true });
    mockPrisma.emailMessage.count.mockResolvedValueOnce(12).mockResolvedValueOnce(12);
    expect(await checkSendBudget("rev", new Date("2026-10-07T15:00:00Z"))).toEqual({ allowed: false, reason: "daily_limit_reached:campaign:12/12" });
  });
});
