import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueReplyClassify } from "@/lib/queue";
import { createHmac, timingSafeEqual } from "crypto";

// Resend signs webhooks with Svix. The previous implementation here computed
// HMAC-SHA256 over the raw body with the secret as a plain string and compared
// a hex digest against the whole header value. Svix does none of those things,
// so every genuine Resend webhook would have been rejected with 401 — the route
// had never worked and could not have.
//
// Correct scheme (https://docs.svix.com/receiving/verifying-payloads/how-manual):
//   signed content = `${svix-id}.${svix-timestamp}.${raw body}`
//   secret         = base64-decode(part after the `whsec_` prefix)
//   signature      = base64(HMAC-SHA256(secret, signed content))
//   header         = space-delimited entries, each `v1,<base64 signature>`
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export function verifySvixSignature(args: {
  id: string;
  timestamp: string;
  signatureHeader: string;
  body: string;
  secret: string;
  nowMs: number;
}): boolean {
  const { id, timestamp, signatureHeader, body, secret, nowMs } = args;
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  // Reject stale/future timestamps so a captured payload can't be replayed.
  const sentSeconds = Number(timestamp);
  if (!Number.isFinite(sentSeconds)) return false;
  const skew = Math.abs(nowMs / 1000 - sentSeconds);
  if (skew > SIGNATURE_TOLERANCE_SECONDS) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  if (secretBytes.length === 0) return false;

  const expected = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  const expectedBuf = Buffer.from(expected);

  // The header may carry several signatures (key rotation). Any valid one passes.
  for (const entry of signatureHeader.split(" ")) {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) continue;
    const candidate = Buffer.from(signature);
    if (candidate.length !== expectedBuf.length) continue;
    if (timingSafeEqual(candidate, expectedBuf)) return true;
  }
  return false;
}

/**
 * Pull the outreach id out of the recipient addresses.
 *
 * `to` is an ARRAY in Resend's payload (the old code did String() on it, which
 * only happened to work for a single recipient and would have produced a
 * comma-joined string otherwise). `received_for` names the address that
 * actually caused delivery, so it is checked first.
 */
export function extractOutreachId(data: Record<string, unknown>): string | null {
  const candidates: string[] = [];
  if (typeof data.received_for === "string") candidates.push(data.received_for);
  for (const key of ["to", "cc", "bcc"]) {
    const value = data[key];
    if (Array.isArray(value)) candidates.push(...value.map(String));
    else if (typeof value === "string") candidates.push(value);
  }
  for (const address of candidates) {
    const match = address.match(/reply\+([^@\s]+)@/);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Resend inbound webhooks carry METADATA ONLY — no body, headers, or
 * attachments (deliberate, so large attachments don't blow serverless request
 * size limits). The body must be fetched separately. The old code read
 * `event.data.text`, which is never present, so every captured reply would have
 * been stored with an empty body and then handed to the reply classifier.
 */
async function fetchReceivedBody(
  emailId: string,
): Promise<{ text: string; subject: string | null }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { text: "", subject: null };

  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.warn(`[inbound] failed to fetch body for ${emailId}: ${res.status}`);
    return { text: "", subject: null };
  }

  const email = (await res.json()) as { text?: string; html?: string; subject?: string };
  return {
    text: email.text ?? email.html ?? "",
    subject: email.subject ?? null,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();

  const ok = verifySvixSignature({
    id: req.headers.get("svix-id") ?? "",
    timestamp: req.headers.get("svix-timestamp") ?? "",
    signatureHeader: req.headers.get("svix-signature") ?? "",
    body,
    secret: process.env.RESEND_WEBHOOK_SECRET ?? "",
    nowMs: Date.now(),
  });
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true });
  }

  const outreachId = extractOutreachId(event.data);
  if (!outreachId) {
    console.warn("[inbound] email.received with no reply+<id> recipient — ignored");
    return NextResponse.json({ ok: true });
  }

  const outreach = await prisma.outreach.findUnique({ where: { id: outreachId } });
  if (!outreach) return NextResponse.json({ ok: true });

  // Svix retries on non-2xx, so the same reply can arrive more than once.
  const emailId = String(event.data.email_id ?? "");
  if (emailId) {
    const existing = await prisma.emailMessage.findFirst({
      where: { direction: "INBOUND", resendMessageId: emailId },
      select: { id: true },
    });
    if (existing) return NextResponse.json({ ok: true, deduped: true });
  }

  const fetched = emailId ? await fetchReceivedBody(emailId) : { text: "", subject: null };
  if (!fetched.text) {
    // Still record it — a reply we know about but can't read beats a lost one.
    console.warn(`[inbound] storing reply for outreach ${outreachId} with empty body`);
  }

  const message = await prisma.emailMessage.create({
    data: {
      outreachId,
      contactId: outreach.contactId,
      direction: "INBOUND",
      subject: fetched.subject ?? String(event.data.subject ?? ""),
      body: fetched.text,
      resendMessageId: emailId || null,
    },
  });

  await enqueueReplyClassify({ messageId: message.id });
  console.log(`[inbound] captured reply for outreach ${outreachId} — message=${message.id}`);

  return NextResponse.json({ ok: true });
}
