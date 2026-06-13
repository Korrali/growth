// ─── Pre-send mailbox verification ───────────────────────────────────────────
//
// Why this exists:
//   The contact finder generates likely email *patterns* (firstname@domain, …).
//   Historically it sent to patterns[0] blindly and relied on bounce webhooks to
//   suppress invalids *after the fact*. With ~50% wrong guesses, the resulting
//   hard bounces destroyed sender reputation, which made even valid sends bounce
//   or land in spam. The fix is to verify the mailbox BEFORE sending.
//
// Why an HTTP provider (not SMTP probing):
//   AWS EC2 blocks outbound port 25 by default, and most B2B targets sit on
//   Google Workspace / M365 which accept-all at RCPT TO (catch-all) — so a
//   self-hosted SMTP probe is both blocked on our infra and unreliable for the
//   exact population we target. A dedicated verification API uses pooled
//   reputation + historical data + catch-all detection.
//
// Provider-agnostic: set ONE of the provider keys and the verifier picks it up.
//   NEVERBOUNCE_API_KEY | ZEROBOUNCE_API_KEY | EMAILABLE_API_KEY
//
// Fail-closed: if no provider is configured, verifyEmail() returns "unknown" and
//   pickDeliverableEmail() returns null (the contact is skipped, NOT sent). This
//   is deliberate — sending unverified guesses is what caused the death-spiral.
//   Set GROWTH_ALLOW_UNVERIFIED_SEND=true to override in an emergency (not
//   recommended; it reintroduces the bounce risk).

export type VerificationResult = "deliverable" | "undeliverable" | "risky" | "unknown";

type Provider = "neverbounce" | "zerobounce" | "emailable";

function activeProvider(): { provider: Provider; key: string } | null {
  if (process.env.NEVERBOUNCE_API_KEY) return { provider: "neverbounce", key: process.env.NEVERBOUNCE_API_KEY };
  if (process.env.ZEROBOUNCE_API_KEY) return { provider: "zerobounce", key: process.env.ZEROBOUNCE_API_KEY };
  if (process.env.EMAILABLE_API_KEY) return { provider: "emailable", key: process.env.EMAILABLE_API_KEY };
  return null;
}

export function verificationConfigured(): boolean {
  return activeProvider() !== null;
}

const allowUnverified = () => process.env.GROWTH_ALLOW_UNVERIFIED_SEND === "true";

// ─── Provider adapters ───────────────────────────────────────────────────────

async function checkNeverBounce(email: string, key: string): Promise<VerificationResult> {
  const url = `https://api.neverbounce.com/v4/single/check?key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`;
  const res = await fetch(url);
  if (!res.ok) return "unknown";
  const data = (await res.json()) as { status?: string; result?: string };
  switch (data.result ?? data.status) {
    case "valid": return "deliverable";
    case "invalid": return "undeliverable";
    case "disposable": return "undeliverable";
    case "catchall": return "risky";
    default: return "unknown"; // "unknown"
  }
}

async function checkZeroBounce(email: string, key: string): Promise<VerificationResult> {
  const url = `https://api.zerobounce.net/v2/validate?api_key=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}`;
  const res = await fetch(url);
  if (!res.ok) return "unknown";
  const data = (await res.json()) as { status?: string };
  switch (data.status) {
    case "valid": return "deliverable";
    case "invalid": return "undeliverable";
    case "spamtrap": return "undeliverable";
    case "abuse": return "undeliverable";
    case "do_not_mail": return "undeliverable";
    case "catch-all": return "risky";
    default: return "unknown"; // "unknown"
  }
}

async function checkEmailable(email: string, key: string): Promise<VerificationResult> {
  const url = `https://api.emailable.com/v1/verify?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url);
  if (!res.ok) return "unknown";
  const data = (await res.json()) as { state?: string };
  switch (data.state) {
    case "deliverable": return "deliverable";
    case "undeliverable": return "undeliverable";
    case "risky": return "risky";
    default: return "unknown"; // "unknown"
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function verifyEmail(email: string): Promise<VerificationResult> {
  const cfg = activeProvider();
  if (!cfg) return "unknown";
  try {
    switch (cfg.provider) {
      case "neverbounce": return await checkNeverBounce(email, cfg.key);
      case "zerobounce": return await checkZeroBounce(email, cfg.key);
      case "emailable": return await checkEmailable(email, cfg.key);
    }
  } catch {
    return "unknown";
  }
}

export interface PickedEmail {
  email: string;
  result: VerificationResult;
}

/**
 * Verify candidate patterns in order and return the best sendable mailbox.
 * - Returns the first "deliverable" address.
 * - Otherwise holds the first "risky" (catch-all) address as a fallback and
 *   returns it only after exhausting all candidates (catch-all domains can't be
 *   verified at the mailbox level — risky is the best obtainable signal).
 * - Returns null if nothing is deliverable/risky → caller SKIPS the contact.
 *
 * Fail-closed: with no provider configured, returns null unless
 * GROWTH_ALLOW_UNVERIFIED_SEND=true (then returns patterns[0] as "unknown").
 */
export async function pickDeliverableEmail(patterns: string[]): Promise<PickedEmail | null> {
  if (patterns.length === 0) return null;

  if (!verificationConfigured()) {
    if (allowUnverified()) return { email: patterns[0], result: "unknown" };
    return null; // fail-closed: do not send unverified guesses
  }

  let riskyFallback: string | null = null;

  for (const candidate of patterns) {
    const result = await verifyEmail(candidate);
    if (result === "deliverable") return { email: candidate, result };
    if (result === "risky" && riskyFallback === null) riskyFallback = candidate;
    // "undeliverable" and "unknown" → try the next pattern
  }

  if (riskyFallback) return { email: riskyFallback, result: "risky" };
  return null;
}
