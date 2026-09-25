import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/mail/transport", () => ({ sendMail: vi.fn() }));
vi.mock("@/lib/sending/send-budget", () => ({ globalDailyCap: vi.fn() }));

const { digestWarnings, renderDigest, shouldBrake } = await import("@/lib/digest/daily-digest");
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
    awaitingResearch: 0,
    emailed: [],
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
    expect(text).toContain("YOUR PART");
  });

  it("marks the subject when something needs fixing", () => {
    expect(renderDigest(data({ emergencyStop: true }), WEDNESDAY).subject.startsWith("⚠ ")).toBe(true);
  });
});

describe("bounce brake", () => {
  it("pulls the stop above 5% bounces once there is enough volume", () => {
    expect(shouldBrake(data({ sent: 30, bounces: 2 }))).toBe(true);
    expect(shouldBrake(data({ sent: 30, bounces: 1 }))).toBe(false);
    expect(shouldBrake(data({ sent: 10, bounces: 3 }))).toBe(false);
    expect(shouldBrake(data({ sent: 30, bounces: 5, emergencyStop: true }))).toBe(false);
  });

  it("says so at the top of the digest", () => {
    const { subject, text } = renderDigest(data({ sent: 30, bounces: 3, emergencyStop: true, autoPaused: true }), WEDNESDAY);
    expect(subject.startsWith("⚠ ")).toBe(true);
    expect(text).toContain("AUTO-PAUSED: bounce rate 10.0%");
    expect(text).not.toContain("Emergency stop is ON — nothing is sending");
  });
});

describe("emailed list and fuel", () => {
  it("lists first-touch prospects with LinkedIn links", () => {
    const { text } = renderDigest(
      data({ emailed: [{ name: "Matt Smith", title: "CEO", company: "Fairing", linkedinUrl: "http://linkedin.com/in/matt", product: "Revenue" }] }),
      WEDNESDAY,
    );
    expect(text).toContain("EMAILED FOR THE FIRST TIME — connect on LinkedIn (1)");
    expect(text).toContain("[Revenue] Matt Smith, CEO — Fairing");
    expect(text).toContain("http://linkedin.com/in/matt");
  });

  it("counts companies still being researched as fuel", () => {
    expect(digestWarnings(data({ queued: 124, awaitingResearch: 1300 }), WEDNESDAY).join(" ")).not.toMatch(/prospects left/);
    expect(digestWarnings(data({ queued: 40, awaitingResearch: 50 }), WEDNESDAY).join(" ")).toMatch(/Only 90 prospects left/);
  });
});
