import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  outreach: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  outreachEmailDraft: { findUnique: vi.fn() },
  emailMessage: { create: vi.fn() },
  auditLog: { create: vi.fn() },
  contact: { update: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockCheckSendEligibility = vi.fn();
vi.mock("@/lib/sending/eligibility", () => ({
  checkSendEligibility: mockCheckSendEligibility,
}));

const mockRenderTemplate = vi.fn((tpl: string) => tpl);
vi.mock("@/lib/sending/template-renderer", () => ({
  renderTemplate: mockRenderTemplate,
}));

const mockGenerateUnsubscribeToken = vi.fn(() => "tok_abc");
vi.mock("@/lib/sending/unsubscribe-token", () => ({
  generateUnsubscribeToken: mockGenerateUnsubscribeToken,
}));

const mockScheduleNextStep = vi.fn();
const mockStopOutreachSequence = vi.fn();
vi.mock("@/lib/sending/sequence-scheduler", () => ({
  scheduleNextStep: mockScheduleNextStep,
  stopOutreachSequence: mockStopOutreachSequence,
}));

const mockInjectUtm = vi.fn((text: string) => text);
vi.mock("@/lib/utm", () => ({ injectUtmIntoText: mockInjectUtm }));

const mockVerifyEmail = vi.fn();
vi.mock("@/lib/import/email-verifier", () => ({ verifyEmail: mockVerifyEmail }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

function makeOutreach(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "out_1",
    contact: {
      id: "con_1",
      email: "lead@company.com",
      firstName: "Jane",
      lastName: "Doe",
      title: "CEO",
      suppressedAt: null,
    },
    company: { id: "co_1", name: "Acme Inc", domain: "acme.com" },
    campaign: {
      id: "camp_1",
      product: "TRUST",
      testMode: false,
      fromName: null,
      fromEmail: null,
      replyForwardTo: null,
      client: null,
      sequenceSteps: [],
    },
    ...overrides,
  };
}

function makeDraft(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    outreachId: "out_1",
    stepNumber: 1,
    subject: "Quick question",
    body: "Hey {{firstName}}, let me show you something...",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.GROWTH_FROM_NAME = "Ashish from Korrali";
  process.env.GROWTH_FROM_EMAIL = "outreach@korrali.com";
  process.env.RESEND_INBOUND_DOMAIN = "reply.outreach.korrali.com";

  mockCheckSendEligibility.mockResolvedValue({ eligible: true });
  mockPrisma.outreach.findUniqueOrThrow.mockResolvedValue(makeOutreach());
  mockPrisma.outreachEmailDraft.findUnique.mockResolvedValue(makeDraft());
  mockPrisma.emailMessage.create.mockResolvedValue({});
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.contact.update.mockResolvedValue({});
  mockPrisma.outreach.update.mockResolvedValue({});
  mockScheduleNextStep.mockResolvedValue(undefined);
  mockStopOutreachSequence.mockResolvedValue(undefined);
  mockVerifyEmail.mockResolvedValue("deliverable");
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ id: "resend_msg_123" }),
    text: async () => "",
  });
});

async function importSender() {
  return import("@/lib/sending/sender");
}

// ---------------------------------------------------------------------------
// Eligibility gate
// ---------------------------------------------------------------------------

describe("sendOutreachStep — eligibility gate", () => {
  it("returns { sent: false } when not eligible", async () => {
    mockCheckSendEligibility.mockResolvedValue({ eligible: false, reason: "campaign_paused" });
    const { sendOutreachStep } = await importSender();
    const result = await sendOutreachStep("out_1", 1);
    expect(result.sent).toBe(false);
    expect(result.reason).toBe("campaign_paused");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("stops sequence for terminal eligibility reasons", async () => {
    mockCheckSendEligibility.mockResolvedValue({
      eligible: false,
      reason: "contact_suppressed",
    });
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);
    expect(mockStopOutreachSequence).toHaveBeenCalledWith("out_1", "contact_suppressed");
  });

  it("does NOT stop sequence for non-terminal reasons", async () => {
    mockCheckSendEligibility.mockResolvedValue({
      eligible: false,
      reason: "daily_limit_reached",
    });
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);
    expect(mockStopOutreachSequence).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test mode
// ---------------------------------------------------------------------------

describe("sendOutreachStep — test mode", () => {
  it("returns { sent: false, reason: 'test-mode' } without calling Resend", async () => {
    mockPrisma.outreach.findUniqueOrThrow.mockResolvedValue(
      makeOutreach({ campaign: { ...makeOutreach().campaign, testMode: true } }),
    );
    const { sendOutreachStep } = await importSender();
    const result = await sendOutreachStep("out_1", 1);
    expect(result).toEqual({ sent: false, reason: "test-mode" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockScheduleNextStep).toHaveBeenCalledWith("out_1");
  });
});

// ---------------------------------------------------------------------------
// No-draft abort
// ---------------------------------------------------------------------------

describe("sendOutreachStep — missing draft", () => {
  it("returns { sent: false, reason: 'no-draft' } when no AI draft exists", async () => {
    mockPrisma.outreachEmailDraft.findUnique.mockResolvedValue(null);
    const { sendOutreachStep } = await importSender();
    const result = await sendOutreachStep("out_1", 1);
    expect(result).toEqual({ sent: false, reason: "no-draft" });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Deliverability guard (step 1 only)
// ---------------------------------------------------------------------------

describe("sendOutreachStep — deliverability guard", () => {
  it("suppresses contact and stops sequence for undeliverable email", async () => {
    mockVerifyEmail.mockResolvedValue("undeliverable");
    const { sendOutreachStep } = await importSender();
    const result = await sendOutreachStep("out_1", 1);
    expect(result).toEqual({ sent: false, reason: "undeliverable" });
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ suppressedAt: expect.any(Date) }) }),
    );
    expect(mockStopOutreachSequence).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalledWith("https://api.resend.com/emails", expect.anything());
  });

  it("skips send for unknown verification result (fail-closed)", async () => {
    mockVerifyEmail.mockResolvedValue("unknown");
    const { sendOutreachStep } = await importSender();
    const result = await sendOutreachStep("out_1", 1);
    expect(result.sent).toBe(false);
    expect(result.reason).toMatch(/unverified/);
    expect(mockFetch).not.toHaveBeenCalledWith("https://api.resend.com/emails", expect.anything());
  });

  it("sends for 'risky' (catch-all) addresses", async () => {
    mockVerifyEmail.mockResolvedValue("risky");
    const { sendOutreachStep } = await importSender();
    const result = await sendOutreachStep("out_1", 1);
    expect(result.sent).toBe(true);
  });

  it("skips deliverability guard on step > 1", async () => {
    mockVerifyEmail.mockResolvedValue("undeliverable"); // would block step 1
    const { sendOutreachStep } = await importSender();
    // Step 2 should not call verifyEmail
    const result = await sendOutreachStep("out_1", 2);
    expect(mockVerifyEmail).not.toHaveBeenCalled();
    expect(result.sent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sender identity: per-campaign overrides
// ---------------------------------------------------------------------------

describe("sendOutreachStep — sender identity", () => {
  it("uses campaign.fromName and campaign.fromEmail when set", async () => {
    mockPrisma.outreach.findUniqueOrThrow.mockResolvedValue(
      makeOutreach({
        campaign: {
          ...makeOutreach().campaign,
          fromName: "John from Acme",
          fromEmail: "john@acme.com",
        },
      }),
    );
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.from).toBe("John from Acme <john@acme.com>");
  });

  it("falls back to GROWTH_FROM_NAME env var for Korrali brand", async () => {
    process.env.GROWTH_FROM_NAME = "Ashish from Korrali";
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.from).toContain("Korrali");
  });

  it("uses client.inboundDomain for reply-to when set", async () => {
    mockPrisma.outreach.findUniqueOrThrow.mockResolvedValue(
      makeOutreach({
        campaign: {
          ...makeOutreach().campaign,
          client: { inboundDomain: "reply.acme.com" },
        },
      }),
    );
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.reply_to).toMatch(/reply\.acme\.com/);
  });

  it("falls back to RESEND_INBOUND_DOMAIN env when no client domain", async () => {
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse((options as { body: string }).body);
    expect(body.reply_to).toContain("reply.outreach.korrali.com");
    expect(body.reply_to).toContain("out_1"); // includes outreach ID
  });
});

// ---------------------------------------------------------------------------
// Successful send
// ---------------------------------------------------------------------------

describe("sendOutreachStep — successful send", () => {
  it("returns { sent: true, messageId } on success", async () => {
    const { sendOutreachStep } = await importSender();
    const result = await sendOutreachStep("out_1", 1);
    expect(result).toEqual({ sent: true, messageId: "resend_msg_123" });
  });

  it("creates an EmailMessage record after send", async () => {
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);
    expect(mockPrisma.emailMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          outreachId: "out_1",
          direction: "OUTBOUND",
          resendMessageId: "resend_msg_123",
          stepNumber: 1,
        }),
      }),
    );
  });

  it("schedules next step after successful send", async () => {
    const { sendOutreachStep } = await importSender();
    await sendOutreachStep("out_1", 1);
    expect(mockScheduleNextStep).toHaveBeenCalledWith("out_1");
  });

  it("throws when Resend API returns non-ok status", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Unprocessable",
      json: async () => ({}),
    });
    const { sendOutreachStep } = await importSender();
    await expect(sendOutreachStep("out_1", 1)).rejects.toThrow("Resend API error 422");
  });
});
