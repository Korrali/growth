import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSendMail = vi.fn();
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

const { sendMail, mailTransportKind, makeMessageId } = await import("@/lib/mail/transport");

const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mailTransportKind", () => {
  it("uses Resend unless both Gmail credentials are set", () => {
    expect(mailTransportKind()).toBe("resend");
    process.env.GMAIL_USER = "ashish@getkorrali.com";
    expect(mailTransportKind()).toBe("resend");
    process.env.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
    expect(mailTransportKind()).toBe("gmail");
  });
});

describe("makeMessageId", () => {
  it("uses the sender's domain", () => {
    expect(makeMessageId("The Korrali Team <outreach@getkorrali.com>")).toMatch(/^<[0-9a-f-]+@getkorrali\.com>$/);
  });
});

describe("sendMail via Gmail", () => {
  beforeEach(() => {
    process.env.GMAIL_USER = "ashish@getkorrali.com";
    process.env.GMAIL_APP_PASSWORD = "pw";
  });

  it("sets its own Message-ID and returns it", async () => {
    const sent = await sendMail({
      from: "The Korrali Team <outreach@getkorrali.com>",
      to: "jane@acme.com",
      subject: "hi",
      text: "body",
    });

    const args = mockSendMail.mock.calls[0]![0];
    expect(args.messageId).toBe(sent.rfcMessageId);
    expect(sent.providerId).toBe(sent.rfcMessageId);
    expect(args.inReplyTo).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("threads when given a parent", async () => {
    await sendMail({
      from: "T <outreach@getkorrali.com>",
      to: "jane@acme.com",
      subject: "Re: hi",
      text: "body",
      inReplyTo: "<b@getkorrali.com>",
      references: ["<a@getkorrali.com>", "<b@getkorrali.com>"],
    });
    const args = mockSendMail.mock.calls[0]![0];
    expect(args.inReplyTo).toBe("<b@getkorrali.com>");
    expect(args.references).toEqual(["<a@getkorrali.com>", "<b@getkorrali.com>"]);
  });
});

describe("sendMail via Resend", () => {
  it("posts to Resend and maps threading into headers", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: "re_1" }) });

    const sent = await sendMail({
      from: "T <outreach@getkorrali.com>",
      to: "jane@acme.com",
      subject: "Re: hi",
      text: "body",
      inReplyTo: "<b@x>",
      references: ["<b@x>"],
    });

    expect(sent).toEqual({ providerId: "re_1", rfcMessageId: null });
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
    expect(body.to).toEqual(["jane@acme.com"]);
    expect(body.headers).toEqual({ "In-Reply-To": "<b@x>", References: "<b@x>" });
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("throws on a Resend error", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 422, text: async () => "bad" });
    await expect(
      sendMail({ from: "T <o@k.com>", to: "j@a.com", subject: "s", text: "t" }),
    ).rejects.toThrow("Resend API error 422: bad");
  });
});
