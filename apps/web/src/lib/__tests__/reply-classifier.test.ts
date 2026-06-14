import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = {
  emailMessage: { findUniqueOrThrow: vi.fn() },
  replyClassification: { upsert: vi.fn() },
  auditLog: { create: vi.fn() },
  outreach: { update: vi.fn() },
  contact: { update: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockCreate = vi.fn();
vi.mock("@/lib/ai/claude", () => ({ anthropic: { messages: { create: mockCreate } } }));

vi.mock("@/lib/ai/models", () => ({ BULK_MODEL: "claude-haiku-4-5" }));

// Prisma enums - replicate the values without importing the real module
vi.mock("@prisma/client", () => ({
  ReplyCategory: {
    INTERESTED: "INTERESTED",
    NOT_NOW: "NOT_NOW",
    WRONG_PERSON: "WRONG_PERSON",
    OBJECTION: "OBJECTION",
    UNSUBSCRIBE: "UNSUBSCRIBE",
    BOUNCE: "BOUNCE",
    AUTO_REPLY: "AUTO_REPLY",
    NEGATIVE: "NEGATIVE",
    OTHER: "OTHER",
  },
  SuppressionReason: {
    UNSUBSCRIBED: "UNSUBSCRIBED",
    BOUNCED: "BOUNCED",
    MANUAL: "MANUAL",
  },
}));

const mockAddEmailSuppression = vi.fn();
vi.mock("@/lib/sending/suppression", () => ({ addEmailSuppression: mockAddEmailSuppression }));

const mockEnqueueReplyAutoSend = vi.fn();
vi.mock("@/lib/queue", () => ({ enqueueReplyAutoSend: mockEnqueueReplyAutoSend }));

const mockFetch = vi.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "msg_1",
    outreachId: "out_1",
    contactId: "con_1",
    subject: "Re: your email",
    body: "Sounds interesting, let's talk.",
    contact: {
      id: "con_1",
      email: "lead@acme.com",
      firstName: "Jane",
      lastName: "Doe",
      title: "CEO",
      company: { id: "co_1", name: "Acme Inc", domain: "acme.com" },
    },
    outreach: {
      id: "out_1",
      campaign: { id: "camp_1", replyForwardTo: null },
    },
    ...overrides,
  };
}

function makeAnthropicResponse(category: string, priority: number, founderDraft: string) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ category, priority, founderDraft }),
      },
    ],
  };
}

function makeClassification(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "cls_1",
    messageId: "msg_1",
    category: "INTERESTED",
    priority: 9,
    founderDraft: "Great to hear from you — happy to set something up!",
    autoSendAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.EMAIL_FROM = "growth@korrali.com";

  mockPrisma.emailMessage.findUniqueOrThrow.mockResolvedValue(makeMessage());
  mockPrisma.replyClassification.upsert.mockResolvedValue(makeClassification());
  mockPrisma.auditLog.create.mockResolvedValue({});
  mockPrisma.outreach.update.mockResolvedValue({});
  mockPrisma.contact.update.mockResolvedValue({});
  mockAddEmailSuppression.mockResolvedValue(undefined);
  mockEnqueueReplyAutoSend.mockResolvedValue(undefined);
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

async function importClassifier() {
  return import("@/lib/ai/reply-classifier");
}

// ---------------------------------------------------------------------------
// Classification output
// ---------------------------------------------------------------------------

describe("classifyReply — classification", () => {
  it("calls Claude with the message subject and body", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("INTERESTED", 9, "Great to hear!"));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("Re: your email"),
          }),
        ],
      }),
    );
  });

  it("upserts a ReplyClassification with parsed category/priority/founderDraft", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("NOT_NOW", 4, "Understood, I'll check back."));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockPrisma.replyClassification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          messageId: "msg_1",
          category: "NOT_NOW",
          priority: 4,
          founderDraft: "Understood, I'll check back.",
        }),
      }),
    );
  });

  it("writes an audit log entry for the classification", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("INTERESTED", 8, "Let's set something up!"));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "reply.classified",
          entity: "EmailMessage",
          entityId: "msg_1",
        }),
      }),
    );
  });

  it("returns the upserted classification", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("INTERESTED", 9, "Let's talk!"));
    const cls = makeClassification();
    mockPrisma.replyClassification.upsert.mockResolvedValue(cls);

    const { classifyReply } = await importClassifier();
    const result = await classifyReply("msg_1");
    expect(result).toBe(cls);
  });

  it("throws when Claude returns no text block", async () => {
    mockCreate.mockResolvedValue({ content: [] });
    const { classifyReply } = await importClassifier();
    await expect(classifyReply("msg_1")).rejects.toThrow("No text block");
  });
});

// ---------------------------------------------------------------------------
// INTERESTED: auto-send scheduling + forwarding
// ---------------------------------------------------------------------------

describe("classifyReply — INTERESTED handling", () => {
  it("schedules auto-send job when INTERESTED and founderDraft is non-empty", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("INTERESTED", 9, "Let's talk!"));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockEnqueueReplyAutoSend).toHaveBeenCalledWith(
      { classificationId: "cls_1" },
      expect.any(Date),
    );
  });

  it("does NOT schedule auto-send when founderDraft is empty string", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("INTERESTED", 9, ""));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockEnqueueReplyAutoSend).not.toHaveBeenCalled();
  });

  it("does NOT schedule auto-send for non-INTERESTED categories", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("NOT_NOW", 4, "Got it, talk later."));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockEnqueueReplyAutoSend).not.toHaveBeenCalled();
  });

  it("forwards INTERESTED reply to campaign.replyForwardTo when set", async () => {
    mockPrisma.emailMessage.findUniqueOrThrow.mockResolvedValue(
      makeMessage({
        outreach: { id: "out_1", campaign: { id: "camp_1", replyForwardTo: "client@acme.com" } },
      }),
    );
    mockCreate.mockResolvedValue(makeAnthropicResponse("INTERESTED", 9, "Happy to help!"));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    // fetch is fire-and-forget, so we need to flush microtasks
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        body: expect.stringContaining("client@acme.com"),
      }),
    );
    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as { body: string }).body);
    expect(body.to).toContain("client@acme.com");
    expect(body.subject).toContain("INTERESTED");
    expect(body.text).toContain("lead@acme.com"); // contact email in forward body
    expect(body.text).toContain("Happy to help!"); // founderDraft
  });

  it("does NOT forward when replyForwardTo is null", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("INTERESTED", 9, "Let's talk!"));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT forward when category is NOT_NOW even if replyForwardTo is set", async () => {
    mockPrisma.emailMessage.findUniqueOrThrow.mockResolvedValue(
      makeMessage({
        outreach: { id: "out_1", campaign: { id: "camp_1", replyForwardTo: "client@acme.com" } },
      }),
    );
    mockCreate.mockResolvedValue(makeAnthropicResponse("NOT_NOW", 3, "Understood."));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    await new Promise((r) => setTimeout(r, 0));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// UNSUBSCRIBE: stop sequence + suppress
// ---------------------------------------------------------------------------

describe("classifyReply — UNSUBSCRIBE handling", () => {
  it("stops the outreach when UNSUBSCRIBE", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("UNSUBSCRIBE", 0, "Will do, I've removed you."));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockPrisma.outreach.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "STOPPED", stoppedReason: "UNSUBSCRIBE" }),
      }),
    );
  });

  it("suppresses the contact email when UNSUBSCRIBE", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("UNSUBSCRIBE", 0, "Will do, I've removed you."));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockAddEmailSuppression).toHaveBeenCalledWith("lead@acme.com", "UNSUBSCRIBED");
    expect(mockPrisma.contact.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ suppressedAt: expect.any(Date), suppressReason: "UNSUBSCRIBED" }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// NEGATIVE: stop sequence + suppress
// ---------------------------------------------------------------------------

describe("classifyReply — NEGATIVE handling", () => {
  it("stops outreach and suppresses contact for NEGATIVE replies", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("NEGATIVE", 0, ""));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockPrisma.outreach.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "STOPPED" }) }),
    );
    expect(mockAddEmailSuppression).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BOUNCE: stop sequence + suppress
// ---------------------------------------------------------------------------

describe("classifyReply — BOUNCE handling", () => {
  it("stops outreach and suppresses contact for BOUNCE replies", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("BOUNCE", 0, ""));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockPrisma.outreach.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "STOPPED" }) }),
    );
    expect(mockAddEmailSuppression).toHaveBeenCalledWith("lead@acme.com", "BOUNCED");
  });
});

// ---------------------------------------------------------------------------
// AUTO_REPLY: no side effects
// ---------------------------------------------------------------------------

describe("classifyReply — AUTO_REPLY handling", () => {
  it("does not stop outreach or suppress for AUTO_REPLY", async () => {
    mockCreate.mockResolvedValue(makeAnthropicResponse("AUTO_REPLY", 0, ""));
    const { classifyReply } = await importClassifier();
    await classifyReply("msg_1");

    expect(mockPrisma.outreach.update).not.toHaveBeenCalled();
    expect(mockAddEmailSuppression).not.toHaveBeenCalled();
    expect(mockEnqueueReplyAutoSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// NOT_NOW / OBJECTION: no sequence stop, no suppress
// ---------------------------------------------------------------------------

describe("classifyReply — non-terminal categories", () => {
  it.each(["NOT_NOW", "WRONG_PERSON", "OBJECTION", "OTHER"])(
    "does not stop or suppress for %s",
    async (category) => {
      mockCreate.mockResolvedValue(makeAnthropicResponse(category, 5, "Thanks for your note."));
      const { classifyReply } = await importClassifier();
      await classifyReply("msg_1");

      expect(mockPrisma.outreach.update).not.toHaveBeenCalled();
      expect(mockAddEmailSuppression).not.toHaveBeenCalled();
    },
  );
});
