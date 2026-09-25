import { describe, it, expect } from "vitest";
import { buildSequence, tidySentence, FALLBACK_LINES } from "@/lib/sending/templates";
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
    expect(s1!.body.endsWith("Best,\nAshish Bhagat\nFounder, Korrali Revenue\nrevenue.korrali.com")).toBe(true);
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

  it("gives Trust its own offer and link", () => {
    const [s1, s2] = buildSequence("TRUST", ctx);
    expect(s1!.subject).toBe("Security questionnaires at Fairing");
    expect(s1!.body).toContain("I'm Ashish, founder of Korrali Trust.");
    expect(s1!.body).toContain("Your first questionnaire is free");
    expect(s1!.body).toContain("trust.korrali.com");
    expect(s2!.body).toContain("https://trust.korrali.com");
    expect(s1!.body).toContain("helps you prepare for SOC 2 and ISO 27001");
    expect(s2!.body).toContain("policy pack and a public trust page");
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
  it("rejects any figure", () => {
    expect(lintLines({ whyLine: "With $11M in annual revenue running through Stripe, leaks add up", angleLine: ctx.angleLine }).join()).toMatch(/contains a number/);
  });
  it("rejects naming tools from the tech list, except the allowed one", () => {
    const opts = { techNames: ["Stripe", "Anthropic Claude", "Claude", "OpenAI", "AWS"], allowedTech: ["Stripe"] };
    expect(lintLines({ whyLine: "Upwave bills through Stripe on annual plans", angleLine: "Buyers ask about AI models like Claude in your platform" }, opts).join()).toMatch(/names "Claude"/);
    expect(lintLines({ whyLine: "Upwave bills through Stripe on annual plans", angleLine: ctx.angleLine }, opts)).toEqual([]);
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
