import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import { verifySvixSignature, extractOutreachId } from "@/app/api/email/inbound/route";

// A real whsec_ secret is base64 after the prefix.
const SECRET_B64 = Buffer.from("super-secret-signing-key-bytes").toString("base64");
const SECRET = `whsec_${SECRET_B64}`;

/** Sign exactly the way Svix does, so the test fails if our verifier drifts. */
function sign(id: string, timestamp: string, body: string, secret = SECRET): string {
  const bytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", bytes).update(`${id}.${timestamp}.${body}`).digest("base64");
  return `v1,${sig}`;
}

describe("verifySvixSignature", () => {
  const nowMs = 1_760_000_000_000;
  const timestamp = String(Math.floor(nowMs / 1000));
  const id = "msg_2abc";
  const body = JSON.stringify({ type: "email.received", data: { email_id: "e_1" } });

  it("accepts a correctly signed payload", () => {
    expect(
      verifySvixSignature({
        id, timestamp, signatureHeader: sign(id, timestamp, body), body, secret: SECRET, nowMs,
      }),
    ).toBe(true);
  });

  it("rejects a hex digest over the raw body — the old implementation's scheme", () => {
    // This is precisely what the previous code produced. It must NOT pass, and
    // its passing would mean we had reintroduced the bug.
    const legacy = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(
      verifySvixSignature({
        id, timestamp, signatureHeader: legacy, body, secret: SECRET, nowMs,
      }),
    ).toBe(false);
  });

  it("rejects a signature over the body alone, without id and timestamp", () => {
    const bytes = Buffer.from(SECRET_B64, "base64");
    const wrong = `v1,${createHmac("sha256", bytes).update(body).digest("base64")}`;
    expect(
      verifySvixSignature({ id, timestamp, signatureHeader: wrong, body, secret: SECRET, nowMs }),
    ).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = sign(id, timestamp, body);
    expect(
      verifySvixSignature({
        id, timestamp, signatureHeader: header, body: body + " ", secret: SECRET, nowMs,
      }),
    ).toBe(false);
  });

  it("accepts when the header carries several signatures (key rotation)", () => {
    const header = `v1,AAAAinvalidAAAA ${sign(id, timestamp, body)}`;
    expect(
      verifySvixSignature({ id, timestamp, signatureHeader: header, body, secret: SECRET, nowMs }),
    ).toBe(true);
  });

  it("rejects a replayed payload outside the tolerance window", () => {
    const old = String(Math.floor(nowMs / 1000) - 60 * 60);
    expect(
      verifySvixSignature({
        id, timestamp: old, signatureHeader: sign(id, old, body), body, secret: SECRET, nowMs,
      }),
    ).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    expect(
      verifySvixSignature({
        id, timestamp, signatureHeader: sign(id, timestamp, body), body, secret: "", nowMs,
      }),
    ).toBe(false);
  });

  it("ignores non-v1 signature versions", () => {
    const header = sign(id, timestamp, body).replace("v1,", "v2,");
    expect(
      verifySvixSignature({ id, timestamp, signatureHeader: header, body, secret: SECRET, nowMs }),
    ).toBe(false);
  });
});

describe("extractOutreachId", () => {
  it("reads the address that actually caused delivery first", () => {
    expect(
      extractOutreachId({
        received_for: "reply+outreach_abc@inbound.getkorrali.com",
        to: ["someone-else@example.com"],
      }),
    ).toBe("outreach_abc");
  });

  it("handles `to` as an array — the old code stringified it", () => {
    expect(
      extractOutreachId({ to: ["reply+outreach_xyz@inbound.getkorrali.com"] }),
    ).toBe("outreach_xyz");
  });

  it("finds the reply address among several recipients", () => {
    expect(
      extractOutreachId({
        to: ["a@example.com", "reply+outreach_9@inbound.getkorrali.com"],
        cc: ["b@example.com"],
      }),
    ).toBe("outreach_9");
  });

  it("returns null for an ordinary address with no outreach tag", () => {
    expect(extractOutreachId({ to: ["ashish@getkorrali.com"] })).toBeNull();
  });

  it("returns null when there are no recipients at all", () => {
    expect(extractOutreachId({})).toBeNull();
  });
});
