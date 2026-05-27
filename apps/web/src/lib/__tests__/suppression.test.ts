import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractDomain, isEmailSuppressed, isDomainSuppressed, addEmailSuppression, addDomainSuppression } from "@/lib/sending/suppression";
import { SuppressionReason, SuppressionType } from "@prisma/client";

vi.mock("@/lib/db", () => ({
  prisma: {
    suppression: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

const mockFindUnique = prisma.suppression.findUnique as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.suppression.findFirst as ReturnType<typeof vi.fn>;
const mockUpsert = prisma.suppression.upsert as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── extractDomain ─────────────────────────────────────────────────────────────

describe("extractDomain", () => {
  it("strips @ prefix", () => {
    expect(extractDomain("user@acme.com")).toBe("acme.com");
  });

  it("lowercases the domain", () => {
    expect(extractDomain("User@ACME.COM")).toBe("acme.com");
  });

  it("strips leading www.", () => {
    expect(extractDomain("user@www.acme.com")).toBe("acme.com");
  });

  it("preserves non-www subdomains", () => {
    expect(extractDomain("user@mail.acme.com")).toBe("mail.acme.com");
  });

  it("returns empty string for malformed email", () => {
    expect(extractDomain("notanemail")).toBe("");
  });
});

// ─── isEmailSuppressed ─────────────────────────────────────────────────────────

describe("isEmailSuppressed", () => {
  it("returns true when row found", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "sup-1" });
    const result = await isEmailSuppressed("test@example.com");
    expect(result).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { value: "test@example.com" },
      select: { id: true },
    });
  });

  it("returns false when not suppressed", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await isEmailSuppressed("clean@example.com");
    expect(result).toBe(false);
  });

  it("normalizes email to lowercase before query", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    await isEmailSuppressed("User@EXAMPLE.COM");
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { value: "user@example.com" },
      select: { id: true },
    });
  });
});

// ─── isDomainSuppressed ────────────────────────────────────────────────────────

describe("isDomainSuppressed", () => {
  it("returns true when domain row found", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "sup-2" });
    const result = await isDomainSuppressed("competitor.com");
    expect(result).toBe(true);
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { type: SuppressionType.DOMAIN, value: "competitor.com" },
      select: { id: true },
    });
  });

  it("returns false when domain not suppressed", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    const result = await isDomainSuppressed("clean.com");
    expect(result).toBe(false);
  });

  it("normalizes domain to lowercase", async () => {
    mockFindFirst.mockResolvedValueOnce(null);
    await isDomainSuppressed("COMPETITOR.COM");
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { type: SuppressionType.DOMAIN, value: "competitor.com" },
      select: { id: true },
    });
  });
});

// ─── addEmailSuppression ───────────────────────────────────────────────────────

describe("addEmailSuppression", () => {
  it("upserts with EMAIL type and lowercased value", async () => {
    mockUpsert.mockResolvedValueOnce({});
    await addEmailSuppression("Test@EXAMPLE.COM", SuppressionReason.UNSUBSCRIBED);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { value: "test@example.com" },
      create: { type: SuppressionType.EMAIL, value: "test@example.com", reason: SuppressionReason.UNSUBSCRIBED },
      update: { reason: SuppressionReason.UNSUBSCRIBED },
    });
  });
});

// ─── addDomainSuppression ──────────────────────────────────────────────────────

describe("addDomainSuppression", () => {
  it("upserts with DOMAIN type and lowercased value", async () => {
    mockUpsert.mockResolvedValueOnce({});
    await addDomainSuppression("Competitor.COM", SuppressionReason.COMPETITOR);
    expect(mockUpsert).toHaveBeenCalledWith({
      where: { value: "competitor.com" },
      create: { type: SuppressionType.DOMAIN, value: "competitor.com", reason: SuppressionReason.COMPETITOR },
      update: { reason: SuppressionReason.COMPETITOR },
    });
  });
});
