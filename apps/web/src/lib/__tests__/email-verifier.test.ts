import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Each test controls provider env + the global fetch mock, so import fresh.
async function getVerifier() {
  vi.resetModules();
  return import("@/lib/import/email-verifier");
}

const PROVIDER_KEYS = ["NEVERBOUNCE_API_KEY", "ZEROBOUNCE_API_KEY", "EMAILABLE_API_KEY"];
function clearProviders() {
  for (const k of PROVIDER_KEYS) delete process.env[k];
  delete process.env.GROWTH_ALLOW_UNVERIFIED_SEND;
}

beforeEach(clearProviders);
afterEach(() => {
  vi.restoreAllMocks();
  clearProviders();
});

// Mock NeverBounce: map address → result code
function mockNeverBounce(map: Record<string, string>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const email = decodeURIComponent(new URL(url).searchParams.get("email") ?? "");
      return {
        ok: true,
        json: async () => ({ result: map[email] ?? "unknown" }),
      } as Response;
    }),
  );
}

describe("pickDeliverableEmail — fail-closed without a provider", () => {
  it("returns null when no provider key is set", async () => {
    const { pickDeliverableEmail } = await getVerifier();
    const picked = await pickDeliverableEmail(["a@x.com", "b@x.com"]);
    expect(picked).toBeNull();
  });

  it("falls back to patterns[0] only when explicitly overridden", async () => {
    process.env.GROWTH_ALLOW_UNVERIFIED_SEND = "true";
    const { pickDeliverableEmail } = await getVerifier();
    const picked = await pickDeliverableEmail(["a@x.com", "b@x.com"]);
    expect(picked).toEqual({ email: "a@x.com", result: "unknown" });
  });
});

describe("pickDeliverableEmail — with NeverBounce", () => {
  beforeEach(() => {
    process.env.NEVERBOUNCE_API_KEY = "test-key";
  });

  it("returns the first deliverable mailbox, skipping invalid guesses", async () => {
    mockNeverBounce({
      "first@x.com": "invalid",
      "first.last@x.com": "valid",
      "flast@x.com": "valid",
    });
    const { pickDeliverableEmail } = await getVerifier();
    const picked = await pickDeliverableEmail(["first@x.com", "first.last@x.com", "flast@x.com"]);
    expect(picked).toEqual({ email: "first.last@x.com", result: "deliverable" });
  });

  it("skips the contact entirely when every candidate is undeliverable", async () => {
    mockNeverBounce({ "a@x.com": "invalid", "b@x.com": "invalid" });
    const { pickDeliverableEmail } = await getVerifier();
    expect(await pickDeliverableEmail(["a@x.com", "b@x.com"])).toBeNull();
  });

  it("uses a catch-all (risky) address only as a last resort", async () => {
    mockNeverBounce({ "a@x.com": "invalid", "b@x.com": "catchall" });
    const { pickDeliverableEmail } = await getVerifier();
    expect(await pickDeliverableEmail(["a@x.com", "b@x.com"])).toEqual({
      email: "b@x.com",
      result: "risky",
    });
  });

  it("prefers a deliverable address over an earlier catch-all", async () => {
    mockNeverBounce({ "a@x.com": "catchall", "b@x.com": "valid" });
    const { pickDeliverableEmail } = await getVerifier();
    expect(await pickDeliverableEmail(["a@x.com", "b@x.com"])).toEqual({
      email: "b@x.com",
      result: "deliverable",
    });
  });
});
