import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/mail/transport", () => ({ sendMail: vi.fn() }));

const { digestWarnings, renderDigest } = await import("@/lib/digest/daily-digest");
type DigestData = Parameters<typeof renderDigest>[0];

const WEDNESDAY = new Date("2026-09-23T02:30:00Z");
const MONDAY = new Date("2026-09-21T02:30:00Z"); // covers Sunday in the US

function data(overrides: Partial<DigestData> = {}): DigestData {
  return {
    sent: 30,
    sentByCampaign: [{ name: "Revenue — marketplace install", count: 30 }],
    replies: [],
    needsYou: [],
    bounces: 0,
    queued: 300,
    dailyCap: 30,
    activeCampaigns: ["Revenue — marketplace install"],
    emergencyStop: false,
    totals: { sent: 120, replied: 3, interested: 1 },
    ...overrides,
  };
}

describe("digestWarnings", () => {
  it("is quiet when the machine is healthy", () => {
    expect(digestWarnings(data(), WEDNESDAY)).toEqual([]);
  });

  it("flags the emergency stop and a missing campaign", () => {
    const w = digestWarnings(data({ emergencyStop: true, activeCampaigns: [] }), WEDNESDAY);
    expect(w.join(" ")).toMatch(/Emergency stop is ON/);
    expect(w.join(" ")).toMatch(/No ACTIVE campaign/);
  });

  it("flags a silent weekday but not a weekend", () => {
    expect(digestWarnings(data({ sent: 0 }), WEDNESDAY).join(" ")).toMatch(/Zero emails sent/);
    expect(digestWarnings(data({ sent: 0 }), MONDAY)).toEqual([]);
  });

  it("flags a bounce rate over 3%", () => {
    expect(digestWarnings(data({ sent: 30, bounces: 2 }), WEDNESDAY).join(" ")).toMatch(/Bounce rate 6\.7%/);
  });

  it("asks for a list refill when fewer than 5 days of prospects remain", () => {
    expect(digestWarnings(data({ queued: 90 }), WEDNESDAY).join(" ")).toMatch(/Only 90 prospects left/);
  });
});

describe("renderDigest", () => {
  it("puts interested replies in the subject and body", () => {
    const { subject, text } = renderDigest(
      data({
        needsYou: [{
          category: "INTERESTED",
          name: "Jane Doe",
          company: "Acme",
          email: "jane@acme.com",
          snippet: "Yes, send the link",
          autoSendAt: new Date("2026-09-22T15:00:00Z"),
          autoSent: false,
        }],
      }),
      WEDNESDAY,
    );
    expect(subject).toBe("Growth 2026-09-23: 30 sent · 1 need you · 1 interested");
    expect(text).toContain("[INTERESTED] Jane Doe — Acme <jane@acme.com> [auto-reply queued 15:00 UTC]");
    expect(text).toContain("THE DAILY ROUTINE");
  });

  it("marks the subject when something needs fixing", () => {
    expect(renderDigest(data({ emergencyStop: true }), WEDNESDAY).subject.startsWith("⚠ ")).toBe(true);
  });
});
