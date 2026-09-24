import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/ai/claude", () => ({ anthropic: {}, CLAUDE_MODELS: { cheap: "x" } }));
vi.mock("@/lib/queue", () => ({ enqueueFitScore: vi.fn(), enqueueContactFind: vi.fn() }));
vi.mock("@/lib/sending/suppression", () => ({ getDomainSuppressionReason: vi.fn() }));

const { applyCuratedListRule } = await import("@/lib/ai/fit-scorer");

const weak = { fitProduct: "REJECT", fitScore: 2, fitReasoning: "Lacks public signals of an enterprise customer base." };

describe("applyCuratedListRule", () => {
  it("enrolls a weak-fit Apollo lead into the product it was imported for", () => {
    const r = applyCuratedListRule(weak, "apollo:Revenue contacts.csv", ["REVENUE"]);
    expect(r.fitProduct).toBe("REVENUE");
    expect(r.fitScore).toBe(6);
    expect(r.fitReasoning).toMatch(/^\[curated Apollo list — enrolled despite AI verdict REJECT 2\]/);
  });

  it("keeps a good score as it is", () => {
    const good = { fitProduct: "TRUST", fitScore: 8, fitReasoning: "Sells to enterprise." };
    expect(applyCuratedListRule(good, "apollo:x.csv", ["TRUST"])).toBe(good);
  });

  it("still blocks competitors and acquired companies", () => {
    for (const reason of ["They are a competitor offering dunning.", "Acquired by Zendesk in 2024.", "A subsidiary of Big Co."]) {
      const r = applyCuratedListRule({ ...weak, fitReasoning: reason }, "apollo:x.csv", ["REVENUE"]);
      expect(r.fitProduct).toBe("REJECT");
    }
  });

  it("leaves discovered companies and unrestricted scoring to the normal gate", () => {
    expect(applyCuratedListRule(weak, "web_research", ["REVENUE"])).toBe(weak);
    expect(applyCuratedListRule(weak, null, ["REVENUE"])).toBe(weak);
    expect(applyCuratedListRule(weak, "apollo:x.csv", ["REVENUE", "TRUST"])).toBe(weak);
  });
});
