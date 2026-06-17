import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  // Use a dedicated secret so rotating NEXTAUTH_SECRET doesn't invalidate
  // previously sent unsubscribe links (which would be a CAN-SPAM violation).
  const secret = process.env.UNSUBSCRIBE_HMAC_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("UNSUBSCRIBE_HMAC_SECRET must be set for unsubscribe token generation");
  return secret;
}

export function generateUnsubscribeToken(email: string): string {
  const normalized = email.toLowerCase().trim();
  const mac = createHmac("sha256", getSecret())
    .update(normalized)
    .digest("base64url");
  return mac;
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  try {
    const expected = generateUnsubscribeToken(email);
    const expectedBuf = Buffer.from(expected, "utf8");
    const receivedBuf = Buffer.from(token, "utf8");
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}
