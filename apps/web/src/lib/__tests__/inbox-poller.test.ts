import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ParsedMail } from "mailparser";

const mockPrisma = {
  emailMessage: { findFirst: vi.fn(), create: vi.fn() },
  contact: { findUnique: vi.fn() },
  outreach: { updateMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const mockEnqueueReplyClassify = vi.fn();
vi.mock("@/lib/queue", () => ({ enqueueReplyClassify: mockEnqueueReplyClassify }));

const mockStopOutreachSequence = vi.fn();
vi.mock("@/lib/sending/sequence-scheduler", () => ({ stopOutreachSequence: mockStopOutreachSequence }));

const { stripQuotedReply, parseAddress, referencedIds, isBounceSender, processInboundMail } = await import(
  "@/lib/mail/inbox-poller"
);

const SELF = ["outreach@getkorrali.com", "ashish@getkorrali.com"];

function mail(overrides: Partial<Record<string, unknown>> = {}): ParsedMail {
  return {
    messageId: "<reply-1@acme.com>",
    from: { text: "Jane Doe <jane@acme.com>", value: [], html: "" },
    subject: "Re: stripe leaks",
    text: "Yes, send it over.\n\nOn Mon, Sep 21, 2026 at 9:00 AM The Korrali Team <outreach@getkorrali.com> wrote:\n> original",
    inReplyTo: "<sent-1@getkorrali.com>",
    references: ["<sent-1@getkorrali.com>"],
    date: new Date("2026-09-22T10:00:00Z"),
    headers: new Map(),
    ...overrides,
  } as unknown as ParsedMail;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.emailMessage.findFirst.mockResolvedValue(null);
  mockPrisma.emailMessage.create.mockResolvedValue({ id: "msg_in_1" });
  mockPrisma.contact.findUnique.mockResolvedValue(null);
});

describe("stripQuotedReply", () => {
  it("cuts at a one-line attribution", () => {
    expect(stripQuotedReply("Sounds good.\n\nOn Mon, Sep 21 Bob <b@x.com> wrote:\n> hi")).toBe("Sounds good.");
  });

  it("cuts at an attribution Gmail wrapped onto two lines", () => {
    expect(stripQuotedReply("Sure.\nOn Mon, Sep 21, 2026 at 9:00 AM The Korrali Team <\noutreach@getkorrali.com> wrote:\n> hi")).toBe("Sure.");
  });

  it("cuts at quoted lines and Outlook headers", () => {
    expect(stripQuotedReply("Not now.\n> quoted")).toBe("Not now.");
    expect(stripQuotedReply("Maybe later.\nFrom: Team <o@k.com>\nSent: Monday\nbody")).toBe("Maybe later.");
  });
});

describe("helpers", () => {
  it("parses addresses with and without display names", () => {
    expect(parseAddress("Jane <Jane@Acme.com>")).toBe("jane@acme.com");
    expect(parseAddress("jane@acme.com")).toBe("jane@acme.com");
    expect(parseAddress(null)).toBeNull();
  });

  it("lists referenced ids newest first without duplicates", () => {
    expect(referencedIds({ inReplyTo: "<b>", references: ["<a>", "<b>"] } as ParsedMail)).toEqual(["<b>", "<a>"]);
  });

  it("recognises bounce senders", () => {
    expect(isBounceSender("mailer-daemon@googlemail.com")).toBe(true);
    expect(isBounceSender("jane@acme.com")).toBe(false);
  });
});

describe("processInboundMail", () => {
  it("matches a reply by In-Reply-To, parks the outreach and queues classification", async () => {
    mockPrisma.emailMessage.findFirst
      .mockResolvedValueOnce(null) // not seen before
      .mockResolvedValueOnce({ outreachId: "out_1", contactId: "con_1" }); // quoted outbound

    const result = await processInboundMail(mail(), SELF);

    expect(result).toBe("captured");
    expect(mockPrisma.emailMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outreachId: "out_1",
        contactId: "con_1",
        direction: "INBOUND",
        body: "Yes, send it over.",
        rfcMessageId: "<reply-1@acme.com>",
      }),
    });
    expect(mockPrisma.outreach.updateMany).toHaveBeenCalledWith({
      where: { id: "out_1", status: { in: ["PENDING", "ACTIVE"] } },
      data: { status: "REPLIED" },
    });
    expect(mockEnqueueReplyClassify).toHaveBeenCalledWith({ messageId: "msg_in_1" });
  });

  it("falls back to the sender address when threading headers are missing", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "con_2", outreaches: [{ id: "out_2" }] });

    const result = await processInboundMail(mail({ inReplyTo: undefined, references: undefined }), SELF);

    expect(result).toBe("captured");
    expect(mockPrisma.emailMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outreachId: "out_2", contactId: "con_2" }),
    });
  });

  it("skips mail already stored", async () => {
    mockPrisma.emailMessage.findFirst.mockResolvedValueOnce({ id: "existing" });
    expect(await processInboundMail(mail(), SELF)).toBe("skipped");
    expect(mockPrisma.emailMessage.create).not.toHaveBeenCalled();
  });

  it("skips our own mail, including the send-as alias", async () => {
    const own = mail({ from: { text: "The Korrali Team <outreach@getkorrali.com>" } });
    expect(await processInboundMail(own, SELF)).toBe("skipped");
  });

  it("leaves unrelated mail alone", async () => {
    const result = await processInboundMail(mail({ inReplyTo: undefined, references: undefined }), SELF);
    expect(result).toBe("unmatched");
    expect(mockPrisma.emailMessage.create).not.toHaveBeenCalled();
    expect(mockPrisma.outreach.updateMany).not.toHaveBeenCalled();
  });

  it("records a bounce and stops (and suppresses) the sequence", async () => {
    mockPrisma.contact.findUnique.mockResolvedValue({ id: "con_3", outreaches: [{ id: "out_3" }] });
    const bounce = mail({
      from: { text: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
      headers: new Map([["x-failed-recipients", "gone@acme.com"]]),
    });

    const result = await processInboundMail(bounce, SELF);

    expect(result).toBe("bounce");
    expect(mockPrisma.contact.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { email: "gone@acme.com" } }));
    expect(mockPrisma.emailMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ contactId: "con_3", direction: "INBOUND", bouncedAt: expect.any(Date) }),
    });
    expect(mockStopOutreachSequence).toHaveBeenCalledWith("out_3", "bounce");
    expect(mockEnqueueReplyClassify).not.toHaveBeenCalled();
  });
});
