import { describe, it, expect, beforeEach } from "vitest";

// Set secret before importing token functions so the env is available
beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-for-unsubscribe-token-tests";
});

// Dynamically import to pick up env
async function getTokenFns() {
  const mod = await import("@/lib/sending/unsubscribe-token");
  return mod;
}

describe("generateUnsubscribeToken", () => {
  it("returns a non-empty string", async () => {
    const { generateUnsubscribeToken } = await getTokenFns();
    const token = generateUnsubscribeToken("user@example.com");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("is deterministic — same email always same token", async () => {
    const { generateUnsubscribeToken } = await getTokenFns();
    const t1 = generateUnsubscribeToken("user@example.com");
    const t2 = generateUnsubscribeToken("user@example.com");
    expect(t1).toBe(t2);
  });

  it("normalizes email to lowercase before hashing", async () => {
    const { generateUnsubscribeToken } = await getTokenFns();
    const t1 = generateUnsubscribeToken("User@Example.COM");
    const t2 = generateUnsubscribeToken("user@example.com");
    expect(t1).toBe(t2);
  });

  it("different emails produce different tokens", async () => {
    const { generateUnsubscribeToken } = await getTokenFns();
    const t1 = generateUnsubscribeToken("alice@example.com");
    const t2 = generateUnsubscribeToken("bob@example.com");
    expect(t1).not.toBe(t2);
  });
});

describe("verifyUnsubscribeToken", () => {
  it("returns true for a valid token", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await getTokenFns();
    const email = "user@example.com";
    const token = generateUnsubscribeToken(email);
    expect(verifyUnsubscribeToken(email, token)).toBe(true);
  });

  it("returns false for a tampered token", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await getTokenFns();
    const email = "user@example.com";
    const token = generateUnsubscribeToken(email);
    const tampered = token.slice(0, -4) + "XXXX";
    expect(verifyUnsubscribeToken(email, tampered)).toBe(false);
  });

  it("returns false for a completely wrong token", async () => {
    const { verifyUnsubscribeToken } = await getTokenFns();
    expect(verifyUnsubscribeToken("user@example.com", "notavalidtoken")).toBe(false);
  });

  it("returns true even when email is passed with different case", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await getTokenFns();
    const token = generateUnsubscribeToken("user@example.com");
    expect(verifyUnsubscribeToken("USER@EXAMPLE.COM", token)).toBe(true);
  });

  it("returns false when token is empty string", async () => {
    const { verifyUnsubscribeToken } = await getTokenFns();
    expect(verifyUnsubscribeToken("user@example.com", "")).toBe(false);
  });
});
