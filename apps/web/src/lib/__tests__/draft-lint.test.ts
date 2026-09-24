import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/ai/claude", () => ({ anthropic: {}, CLAUDE_MODELS: { cheap: "x", premium: "y", default: "x" } }));
vi.mock("@/lib/ai/critics-reviewer", () => ({ reviewWithCritics: vi.fn() }));

const { lintDraft } = await import("@/lib/ai/email-generator");

describe("lintDraft", () => {
  it("catches the phrases the first live drafts used", () => {
    expect(lintDraft("Many growing SaaS teams see failed renewals")).toEqual(['banned phrase "Many growing SaaS teams"']);
    expect(lintDraft("Another common leak is old coupons")).toEqual(['banned phrase "Another common leak"']);
    expect(lintDraft("I haven't heard back, so")).toEqual(['banned phrase "I haven\'t heard back"']);
    expect(lintDraft("subject: quick follow-up")).toEqual(['banned phrase "quick follow-up"']);
    expect(lintDraft("I noticed your pricing page")).toEqual(['banned phrase "I noticed"']);
  });

  it("catches a headcount written as money", () => {
    // The live draft used U+2011 (non-breaking hyphen), not "-".
    expect(lintDraft("With a $37\u2011person team scaling fast")).toEqual(['headcount written as money "$37\u2011person"']);
    expect(lintDraft("With a $37-person team scaling fast")).toEqual(['headcount written as money "$37-person"']);
    expect(lintDraft("a $120 employee team")).toEqual(['headcount written as money "$120 employee"']);
  });

  it("passes a clean draft", () => {
    expect(lintDraft("Fairing bills annual and monthly plans on Stripe. Who chases invoices still unpaid after Stripe's retries?")).toEqual([]);
  });
});
