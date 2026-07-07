import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before imports
vi.mock("@/lib/db", () => ({
  prisma: {
    growthSettings: { findUnique: vi.fn() },
    outreach: { findUnique: vi.fn() },
    emailMessage: { count: vi.fn(), findFirst: vi.fn() },
    contact: { findMany: vi.fn() },
    emailGenerationRun: { findFirst: vi.fn() },
    auditLog: { create: vi.fn() },
    suppression: { findUnique: vi.fn(), findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { checkSendEligibility } from "@/lib/sending/eligibility";

const ACTIVE_CAMPAIGN = {
  product: "REVENUE",
  status: "ACTIVE",
  dailyLimit: 20,
  perDomainLimit: 1,
  maxFollowUps: 3,
  sendWindowStart: 0,
  sendWindowEnd: 23,
  timezone: "UTC",
  testMode: false,
  sequenceSteps: [],
};

const ACTIVE_CONTACT = {
  id: "contact-1",
  email: "alice@acme.com",
  emailStatus: "UNVERIFIED",
  suppressedAt: null,
  isBuyer: true,
};

const BASE_OUTREACH = {
  id: "outreach-1",
  status: "ACTIVE",
  currentStep: 1,
  contactId: "contact-1",
  contact: ACTIVE_CONTACT,
  campaign: ACTIVE_CAMPAIGN,
  company: { fitScore: 8, domain: "acme.com" },
};

function mockAll() {
  vi.mocked(prisma.growthSettings.findUnique).mockResolvedValue({
    id: "global",
    globalEmergencyStop: false,
    defaultDailyLimit: 20,
    defaultPerDomainLimit: 1,
    updatedAt: new Date(),
  } as never);
  vi.mocked(prisma.outreach.findUnique).mockResolvedValue(BASE_OUTREACH as never);
  vi.mocked(prisma.suppression.findUnique).mockResolvedValue(null);
  vi.mocked(prisma.suppression.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.emailMessage.findFirst).mockResolvedValue(null);
  vi.mocked(prisma.emailMessage.count).mockResolvedValue(0);
  vi.mocked(prisma.contact.findMany).mockResolvedValue([]);
  vi.mocked(prisma.emailGenerationRun.findFirst).mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  // 0–0 → isInQuietHours(0,0) is always false — tests must be wall-clock-independent
  process.env.QUIET_HOURS_START = "0";
  process.env.QUIET_HOURS_END = "0";
  mockAll();
});

describe("checkSendEligibility", () => {
  it("returns eligible when all gates pass", async () => {
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(true);
  });

  it("Gate 1: blocks on global emergency stop", async () => {
    vi.mocked(prisma.growthSettings.findUnique).mockResolvedValue({
      id: "global",
      globalEmergencyStop: true,
      defaultDailyLimit: 20,
      defaultPerDomainLimit: 1,
      updatedAt: new Date(),
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("global_emergency_stop");
  });

  it("Gate 2: blocks when campaign is PAUSED", async () => {
    vi.mocked(prisma.outreach.findUnique).mockResolvedValue({
      ...BASE_OUTREACH,
      campaign: { ...ACTIVE_CAMPAIGN, status: "PAUSED" },
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("campaign_not_active");
  });

  it("Gate 1.5: blocks when the campaign's product is not outbound-viable (MedScan)", async () => {
    vi.mocked(prisma.outreach.findUnique).mockResolvedValue({
      ...BASE_OUTREACH,
      campaign: { ...ACTIVE_CAMPAIGN, product: "MEDSCAN" },
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("product_not_outbound_viable");
  });

  it("Gate 3: blocks when contact is suppressed", async () => {
    vi.mocked(prisma.outreach.findUnique).mockResolvedValue({
      ...BASE_OUTREACH,
      contact: { ...ACTIVE_CONTACT, suppressedAt: new Date() },
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("contact_suppressed");
  });

  it("Gate 3.6: blocks when contact is not a buyer", async () => {
    vi.mocked(prisma.outreach.findUnique).mockResolvedValue({
      ...BASE_OUTREACH,
      contact: { ...ACTIVE_CONTACT, isBuyer: false },
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("contact_not_buyer");
  });

  it("Gate 3: blocks when emailStatus is INVALID", async () => {
    vi.mocked(prisma.outreach.findUnique).mockResolvedValue({
      ...BASE_OUTREACH,
      contact: { ...ACTIVE_CONTACT, emailStatus: "INVALID" },
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("email_invalid");
  });

  it("Gate 4: blocks when email is in suppression list", async () => {
    vi.mocked(prisma.suppression.findUnique).mockResolvedValue({ id: "s1" } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("email_in_suppression_list");
  });

  it("Gate 4: blocks when domain is suppressed", async () => {
    vi.mocked(prisma.suppression.findFirst).mockResolvedValue({ id: "s1" } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("domain_suppressed");
  });

  it("Gate 5: blocks when outreach is STOPPED", async () => {
    vi.mocked(prisma.outreach.findUnique).mockResolvedValue({
      ...BASE_OUTREACH,
      status: "STOPPED",
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("outreach_not_active");
  });

  it("Gate 6: blocks on double-send — email already sent for this step", async () => {
    vi.mocked(prisma.emailMessage.findFirst).mockResolvedValue({ id: "msg-1" } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("already_sent_this_step");
  });

  it("Gate 7: blocks when daily send limit is reached", async () => {
    vi.mocked(prisma.emailMessage.count).mockResolvedValue(20 as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("daily_limit_reached");
  });

  it("Gate 8: blocks when per-domain limit is reached", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "c1" }] as never);
    // First count (daily total) = 0; second count (domain) = 1
    vi.mocked(prisma.emailMessage.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("per_domain_limit_reached");
  });

  it("Gate 9: blocks when max follow-ups are exceeded", async () => {
    vi.mocked(prisma.emailMessage.count)
      .mockResolvedValueOnce(0)  // daily
      .mockResolvedValueOnce(0)  // domain
      .mockResolvedValueOnce(4); // sent steps
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("max_followups_exceeded");
  });

  it("Gate 12: blocks when fitScore is below 6", async () => {
    vi.mocked(prisma.outreach.findUnique).mockResolvedValue({
      ...BASE_OUTREACH,
      company: { fitScore: 4, domain: "acme.com" },
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("fit_score_too_low");
  });

  it("Gate 13: blocks when quality gate is failed for this step", async () => {
    vi.mocked(prisma.emailGenerationRun.findFirst).mockResolvedValue({
      qualityGates: { "1": { passed: false, blockedReasons: ["riskScore 7 > 4"] } },
    } as never);
    const result = await checkSendEligibility("outreach-1", 1);
    expect(result.eligible).toBe(false);
    expect(result.reason).toContain("quality_gate_blocked");
  });
});
