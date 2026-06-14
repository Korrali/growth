import { prisma } from "@/lib/db";

export async function sendAutoReply(classificationId: string): Promise<void> {
  const classification = await prisma.replyClassification.findUniqueOrThrow({
    where: { id: classificationId },
    include: {
      message: {
        include: { contact: true, outreach: true },
      },
    },
  });

  // Idempotency + cancellation guards
  if (classification.autoSentAt) return;
  if (classification.autoSendCancelledAt) return;
  if (classification.category !== "INTERESTED") return;
  if (!classification.founderDraft) return;

  const contact = classification.message.contact;
  const originalSubject = classification.message.subject ?? "";
  const replySubject = originalSubject.toLowerCase().startsWith("re:")
    ? originalSubject
    : `Re: ${originalSubject}`;

  const fromName = process.env.GROWTH_FROM_NAME ?? "Ashish from Korrali";
  const fromEmail = process.env.GROWTH_FROM_EMAIL ?? "ashish@getkorrali.com";
  const inboundDomain = process.env.RESEND_INBOUND_DOMAIN ?? "reply.getkorrali.com";
  const outreachId = classification.message.outreachId;

  const payload: Record<string, unknown> = {
    from: `${fromName} <${fromEmail}>`,
    to: [contact.email],
    subject: replySubject,
    text: classification.founderDraft,
    reply_to: outreachId
      ? `reply+${outreachId}@${inboundDomain}`
      : fromEmail,
  };

  // Thread the reply using Resend's headers support
  if (classification.message.resendMessageId) {
    payload.headers = {
      "In-Reply-To": classification.message.resendMessageId,
      References: classification.message.resendMessageId,
    };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Resend auto-reply error ${res.status}: ${errText}`);
  }

  const { id: resendMessageId } = (await res.json()) as { id: string };

  await prisma.$transaction([
    prisma.replyClassification.update({
      where: { id: classificationId },
      data: { autoSentAt: new Date() },
    }),
    prisma.emailMessage.create({
      data: {
        contactId: contact.id,
        outreachId: outreachId ?? undefined,
        direction: "OUTBOUND",
        subject: replySubject,
        body: classification.founderDraft,
        resendMessageId,
        sentAt: new Date(),
      },
    }),
    prisma.auditLog.create({
      data: {
        actor: "system",
        action: "reply.auto_sent",
        entity: "ReplyClassification",
        entityId: classificationId,
        metadata: { to: contact.email, resendMessageId },
      },
    }),
  ]);
}
