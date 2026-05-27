import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueReplyClassify } from "@/lib/queue";
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

  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true });
  }

  const toAddress = String(event.data.to ?? "");
  const match = toAddress.match(/reply\+([^@]+)@/);
  const outreachId = match?.[1];

  if (!outreachId) {
    return NextResponse.json({ ok: true });
  }

  const outreach = await prisma.outreach.findUnique({ where: { id: outreachId } });
  if (!outreach) return NextResponse.json({ ok: true });

  const message = await prisma.emailMessage.create({
    data: {
      outreachId,
      contactId: outreach.contactId,
      direction: "INBOUND",
      subject: String(event.data.subject ?? ""),
      body: String(event.data.text ?? event.data.html ?? ""),
    },
  });

  await enqueueReplyClassify({ messageId: message.id });

  return NextResponse.json({ ok: true });
}
