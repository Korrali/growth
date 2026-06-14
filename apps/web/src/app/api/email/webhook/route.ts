import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addEmailSuppression } from "@/lib/sending/suppression";
import { stopOutreachSequence } from "@/lib/sending/sequence-scheduler";
import { SuppressionReason } from "@prisma/client";
import { createHmac, timingSafeEqual } from "crypto";

// Resend uses Svix for webhook delivery. Svix signs with HMAC-SHA256 over
// "{svix-id}.{svix-timestamp}.{body}" and base64-encodes the result.
// The svix-signature header is "v1,{base64sig}" (possibly multiple, comma-separated).
function verifyResendSignature(
  payload: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;

  // Strip the "whsec_" prefix Resend/Svix uses on the secret
  const rawSecret = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");

  const message = `${svixId}.${svixTimestamp}.${payload}`;
  const expected = createHmac("sha256", rawSecret).update(message).digest("base64");

  // svixSignature may be "v1,{base64}" or "v1,{b64} v1,{b64}" (multiple)
  const signatures = svixSignature.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
  for (const sig of signatures) {
    try {
      if (timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return true;
    } catch {
      // length mismatch — keep trying
    }
  }
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const svixId = req.headers.get("svix-id") ?? "";
  const svixTimestamp = req.headers.get("svix-timestamp") ?? "";
  const svixSignature = req.headers.get("svix-signature") ?? "";

  if (!verifyResendSignature(body, svixId, svixTimestamp, svixSignature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = JSON.parse(body) as typeof event;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // V1: handle bounces only (opens/clicks are V2)
  if (event.type !== "email.bounced") {
    return NextResponse.json({ ok: true });
  }

  const resendMessageId = String(event.data.email_id ?? event.data.message_id ?? "");
  if (!resendMessageId) return NextResponse.json({ ok: true });

  const message = await prisma.emailMessage.findUnique({
    where: { resendMessageId },
    include: { contact: true },
  });

  if (!message) return NextResponse.json({ ok: true });

  await prisma.emailMessage.update({
    where: { id: message.id },
    data: { bouncedAt: new Date() },
  });

  if (message.outreachId) {
    await stopOutreachSequence(message.outreachId, "bounce");
  }

  await addEmailSuppression(message.contact.email, SuppressionReason.BOUNCED);
  await prisma.contact.update({
    where: { id: message.contactId },
    data: { suppressedAt: new Date(), suppressReason: SuppressionReason.BOUNCED },
  });

  return NextResponse.json({ ok: true });
}
