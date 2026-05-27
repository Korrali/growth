import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { addEmailSuppression } from "@/lib/sending/suppression";
import { stopOutreachSequence } from "@/lib/sending/sequence-scheduler";
import { SuppressionReason } from "@prisma/client";
import { createHmac, timingSafeEqual } from "crypto";

function verifySignature(payload: string, signature: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text();
  const sig = req.headers.get("svix-signature") ?? req.headers.get("webhook-signature") ?? "";

  if (!verifySignature(body, sig)) {
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
