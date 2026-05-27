import { describe, it, expect } from "vitest";
import { normalizeDomain, deduplicateByDomain, deduplicateByEmail } from "@/lib/import/csv-parser";

describe("normalizeDomain", () => {
  it("strips https:// protocol", () => {
    expect(normalizeDomain("https://acme.com")).toBe("acme.com");
  });

  it("strips http:// protocol", () => {
    expect(normalizeDomain("http://acme.com")).toBe("acme.com");
  });

  it("strips www. prefix", () => {
    expect(normalizeDomain("www.acme.com")).toBe("acme.com");
  });

  it("strips https://www. prefix", () => {
    expect(normalizeDomain("https://www.acme.com/about")).toBe("acme.com");
  });

  it("strips trailing path", () => {
    expect(normalizeDomain("acme.com/pricing/enterprise")).toBe("acme.com");
  });

  it("strips port number", () => {
    expect(normalizeDomain("acme.com:8080")).toBe("acme.com");
  });

  it("lowercases the domain", () => {
    expect(normalizeDomain("ACME.COM")).toBe("acme.com");
  });

  it("handles empty string", () => {
    expect(normalizeDomain("")).toBe("");
  });

  it("handles subdomain (not www)", () => {
    expect(normalizeDomain("https://app.acme.com")).toBe("app.acme.com");
  });

  it("handles trailing dot", () => {
    expect(normalizeDomain("acme.com.")).toBe("acme.com");
  });
});

describe("deduplicateByDomain", () => {
  it("keeps unique domains", () => {
    const rows = [
      { domain: "acme.com" },
      { domain: "widgets.io" },
    ];
    const { unique, skipped } = deduplicateByDomain(rows, []);
    expect(unique).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it("removes domains already in existingDomains", () => {
    const rows = [{ domain: "acme.com" }, { domain: "new.io" }];
    const { unique, skipped } = deduplicateByDomain(rows, ["acme.com"]);
    expect(unique).toHaveLength(1);
    expect(unique[0]!.domain).toBe("new.io");
    expect(skipped).toBe(1);
  });

  it("removes intra-batch duplicates", () => {
    const rows = [
      { domain: "acme.com" },
      { domain: "acme.com" },
    ];
    const { unique, skipped } = deduplicateByDomain(rows, []);
    expect(unique).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("is case-insensitive", () => {
    const rows = [{ domain: "ACME.COM" }];
    const { unique, skipped } = deduplicateByDomain(rows, ["acme.com"]);
    expect(unique).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it("skips rows with empty domain", () => {
    const rows = [{ domain: "" }, { domain: "real.io" }];
    const { unique, skipped } = deduplicateByDomain(rows, []);
    expect(unique).toHaveLength(1);
    expect(skipped).toBe(1);
  });
});

describe("deduplicateByEmail", () => {
  it("keeps unique emails", () => {
    const rows = [{ email: "a@acme.com" }, { email: "b@acme.com" }];
    const { unique, skipped } = deduplicateByEmail(rows, []);
    expect(unique).toHaveLength(2);
    expect(skipped).toBe(0);
  });

  it("removes emails already in existingEmails", () => {
    const rows = [{ email: "a@acme.com" }, { email: "new@acme.com" }];
    const { unique, skipped } = deduplicateByEmail(rows, ["a@acme.com"]);
    expect(unique).toHaveLength(1);
    expect(skipped).toBe(1);
  });

  it("is case-insensitive", () => {
    const rows = [{ email: "A@ACME.COM" }];
    const { unique, skipped } = deduplicateByEmail(rows, ["a@acme.com"]);
    expect(unique).toHaveLength(0);
    expect(skipped).toBe(1);
  });
});
