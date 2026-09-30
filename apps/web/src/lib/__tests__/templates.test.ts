import { describe, it, expect } from "vitest";
import { buildSequence, buildFirmSequence, tidySentence, FALLBACK_LINES, FIRM_FALLBACK_LINES, FIRM_TEMPLATE_REVISED_AT, isStaleDraft, TEMPLATE_REVISED_AT } from "@/lib/sending/templates";
import { lintLines } from "@/lib/ai/email-generator";
import { timezoneForCountry } from "@/lib/sending/timezone";

const ctx = {
  firstName: "matt",
  company: "Fairing",
  whyLine: "Fairing bills Shopify brands on monthly and annual plans through Stripe",
  angleLine: "When plans change, customers can stay on a retired price for months.",
};

describe("buildSequence", () => {
  it("gives Revenue a greeting, sentence-case subject, who-I-am, and a signature", () => {
    const [s1, s2, s3, s4] = buildSequence("REVENUE", ctx);
    expect(s1!.subject).toBe("Stripe billing leaks at Fairing");
    expect(s1!.body.startsWith("Hi Matt,\n\nI'm Ashish, founder of Korrali Revenue.")).toBe(true);
    expect(s1!.body).toContain("Fairing bills Shopify brands on monthly and annual plans through Stripe.");
    expect(s1!.body).not.toMatch(/https?:\/\//);
    expect(s1!.body.endsWith("Best,\nAshish Bhagat\nFounder, Korrali Revenue\nKorrali LLC, a US company\nrevenue.korrali.com")).toBe(true);
    for (const s of [s2!, s3!, s4!]) expect(s.body).toContain("https://marketplace.stripe.com/apps/korrali-revenue-recovery");
    expect(s3!.body).toContain(ctx.angleLine);
    expect(s1!.body).toContain("Stripe's app review team tested it over several review rounds before approving it");
    expect(s2!.body).toContain("your Stripe access token is encrypted at rest");
  });

  it("never claims certification or compliance on anyone's behalf", () => {
    for (const product of ["REVENUE", "TRUST"] as const) {
      const text = buildSequence(product, ctx).map((s) => s.body).join("\n");
      expect(text).not.toMatch(/become (SOC ?2|ISO|compliant)|makes? you compliant|certified by|endorsed by/i);
    }
  });

  it("pitches Trust as the AI-native platform, with its own link", () => {
    const [s1, s2, s3, s4] = buildSequence("TRUST", ctx);
    expect(s1!.subject).toBe("SOC 2 and security reviews at Fairing");
    expect(s1!.body).toContain("I'm Ashish, founder of Korrali Trust, an AI-native compliance platform for SOC 2, ISO 27001 and ISO 42001.");
    expect(s1!.body).toContain("AI reviews each control's evidence the way an auditor would");
    expect(s1!.body).toContain("with the source cited for every answer");
    expect(s1!.body).toContain("read-only MCP server");
    expect(s1!.body).toContain("$3,000 a year for up to 50 people");
    expect(s1!.body).toContain("14-day trial");
    for (const s of [s2!, s3!, s4!]) expect(s.body).toContain("https://trust.korrali.com");
    expect(s2!.body).toContain("AI inventory");
    expect(s3!.body).toContain("reply with it attached and I'll send it back completed within two days");
  });

  it("never promises anything free in Trust: the trial needs a card", () => {
    for (const previouslyContacted of [false, true]) {
      const text = buildSequence("TRUST", { ...ctx, previouslyContacted }).map((s) => `${s.subject}\n${s.body}`).join("\n");
      expect(text).not.toMatch(/\bfree\b|no card|without a card|\$299|\$599/i);
    }
  });

  it("re-introduces Trust to prospects who got a pre-relaunch email", () => {
    const [fresh] = buildSequence("TRUST", ctx);
    const [again] = buildSequence("TRUST", { ...ctx, previouslyContacted: true });
    expect(fresh!.body).not.toContain("I wrote to you a while back");
    expect(again!.body).toContain("I wrote to you a while back about Korrali Trust. It has changed a lot since: it's now an AI-native compliance platform");
    expect(again!.subject).toBe(fresh!.subject);
  });

  it("falls back to a neutral greeting without a first name", () => {
    expect(buildSequence("REVENUE", { ...ctx, firstName: null })[0]!.body.startsWith("Hi there,")).toBe(true);
  });
});

describe("tidySentence", () => {
  it("capitalises and ends with punctuation", () => {
    expect(tidySentence("  subscription  billing drifts ")).toBe("Subscription billing drifts.");
    expect(tidySentence("Is it?")).toBe("Is it?");
  });
});

describe("lintLines", () => {
  it("accepts clean lines, including the fallbacks", () => {
    expect(lintLines({ whyLine: ctx.whyLine, angleLine: ctx.angleLine })).toEqual([]);
    for (const p of ["REVENUE", "TRUST"] as const) {
      expect(lintLines({ whyLine: FALLBACK_LINES[p].whyLine("Acme"), angleLine: FALLBACK_LINES[p].angleLine })).toEqual([]);
    }
  });

  it("rejects greetings, questions, links, re-introductions, banned filler and long lines", () => {
    const bad = lintLines({
      whyLine: "Hi Matt, most SaaS teams miss this, right?",
      angleLine: "Korrali flags these: https://x.com " + "word ".repeat(50),
    });
    expect(bad.join(" | ")).toMatch(/starts with a greeting/);
    expect(bad.join(" | ")).toMatch(/is a question/);
    expect(bad.join(" | ")).toMatch(/banned phrase/);
    expect(bad.join(" | ")).toMatch(/contains a link/);
    expect(bad.join(" | ")).toMatch(/re-introduces/);
    expect(bad.join(" | ")).toMatch(/words \(max 45\)/);
  });
});

describe("lintLines — numbers and tech names", () => {
  it("allows standard names like SOC 2 and ISO 27001, but no other figure", () => {
    expect(lintLines({ whyLine: "Acme sells to banks, which ask for a SOC 2 report and ISO 27001 before signing", angleLine: ctx.angleLine })).toEqual([]);
    expect(lintLines({ whyLine: "Acme has 40 enterprise customers asking for SOC 2", angleLine: ctx.angleLine }).join()).toMatch(/contains a number/);
  });
  it("rejects any figure", () => {
    expect(lintLines({ whyLine: "With $11M in annual revenue running through Stripe, leaks add up", angleLine: ctx.angleLine }).join()).toMatch(/contains a number/);
  });
  it("rejects naming tools from the tech list, except the allowed one", () => {
    const opts = { techNames: ["Stripe", "Anthropic Claude", "Claude", "OpenAI", "AWS"], allowedTech: ["Stripe"] };
    expect(lintLines({ whyLine: "Upwave bills through Stripe on annual plans", angleLine: "Buyers ask about AI models like Claude in your platform" }, opts).join()).toMatch(/names "Claude"/);
    expect(lintLines({ whyLine: "Upwave bills through Stripe on annual plans", angleLine: ctx.angleLine }, opts)).toEqual([]);
  });
});

describe("lintLines — Stripe retry timing", () => {
  it("rejects stated retry windows, in words", () => {
    for (const angleLine of [
      "Stripe stops retrying failed payments after a few days, so those renewals stay unpaid.",
      "Failed renewals go quiet once Stripe's retries end within a week.",
      "Declined cards sit unpaid for weeks after the last retry.",
    ]) {
      expect(lintLines({ whyLine: ctx.whyLine, angleLine }).join()).toMatch(/states retry timing/);
    }
  });
  it("allows timing outside retry context, and retries without timing", () => {
    expect(lintLines({ whyLine: ctx.whyLine, angleLine: ctx.angleLine })).toEqual([]);
    expect(
      lintLines({ whyLine: ctx.whyLine, angleLine: "Failed renewals can stay unpaid once Stripe's automatic retries end." }),
    ).toEqual([]);
  });
});

describe("isStaleDraft", () => {
  it("flags drafts written before their product's current template", () => {
    expect(isStaleDraft("REVENUE", new Date("2026-09-24T18:29:00Z"))).toBe(true);
    expect(isStaleDraft("REVENUE", new Date(TEMPLATE_REVISED_AT.REVENUE.getTime() + 1000))).toBe(false);
    expect(isStaleDraft("TRUST", new Date("2026-09-25T09:00:00Z"))).toBe(true);
    // The relaunch drafts, written right after the Trust deploy, are current.
    expect(isStaleDraft("TRUST", new Date("2026-09-27T18:29:15Z"))).toBe(false);
  });

  it("a Trust change leaves Revenue drafts alone", () => {
    expect(isStaleDraft("REVENUE", new Date("2026-09-26T12:00:00Z"))).toBe(false);
  });

  it("never dates a template revision in the future", () => {
    for (const d of Object.values(TEMPLATE_REVISED_AT)) expect(d.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("timezoneForCountry", () => {
  it("maps Apollo countries and ignores unknowns", () => {
    expect(timezoneForCountry("United States")).toBe("America/Chicago");
    expect(timezoneForCountry("Austria")).toBe("Europe/Vienna");
    expect(timezoneForCountry("Atlantis")).toBeNull();
    expect(timezoneForCountry(null)).toBeNull();
  });
});

describe("buildFirmSequence", () => {
  const firm = { ...ctx, company: "Level10 CFO", whyLine: "Level10 CFO runs finance for SaaS startups", angleLine: "A client can keep billing on a retired price." };

  it("asks firms for a conversation, never a price or install link", () => {
    for (const product of ["REVENUE", "TRUST"] as const) {
      const steps = buildFirmSequence(product, firm);
      expect(steps.map((s) => s.stepNumber)).toEqual([1, 2, 3, 4]);
      const text = steps.map((s) => s.body).join("\n");
      expect(text).not.toMatch(/https?:\/\/|\$\d|install it|14-day trial/i);
      expect(steps[0]!.body).toContain("Would you be open to a 20-minute call?");
      expect(steps[0]!.body).toContain("Level10 CFO runs finance for SaaS startups.");
      expect(steps[1]!.body).toContain("sign-off");
      expect(steps[2]!.body.startsWith(`Hi Matt,\n\n${firm.angleLine}`)).toBe(true);
    }
    expect(buildFirmSequence("REVENUE", firm)[0]!.subject).toBe("Stripe billing checks for Level10 CFO's clients");
    expect(buildFirmSequence("TRUST", firm)[0]!.subject).toBe("Security questionnaires for Level10 CFO's clients");
  });

  it("dates firm drafts separately from direct ones", () => {
    const t = new Date(FIRM_TEMPLATE_REVISED_AT.REVENUE.getTime() - 1000);
    expect(isStaleDraft("REVENUE", t, "FIRM")).toBe(true);
    expect(isStaleDraft("REVENUE", new Date(FIRM_TEMPLATE_REVISED_AT.REVENUE.getTime() + 1000), "FIRM")).toBe(false);
  });

  it("firm fallback lines pass the line checks", () => {
    for (const product of ["REVENUE", "TRUST"] as const) {
      const fb = FIRM_FALLBACK_LINES[product];
      expect(lintLines({ whyLine: fb.whyLine("Level10 CFO"), angleLine: fb.angleLine }, { companyName: "Level10 CFO" })).toEqual([]);
    }
  });

  it("a digit in the firm's own name is not a figure", () => {
    expect(lintLines({ whyLine: "Level10 CFO runs finance for SaaS startups.", angleLine: "Retired prices linger." }, { companyName: "Level10 CFO" })).toEqual([]);
    expect(lintLines({ whyLine: "Level10 CFO serves 40 SaaS startups.", angleLine: "Retired prices linger." }, { companyName: "Level10 CFO" })).toContain("whyLine: contains a number");
  });
});
