import { prisma } from "@/lib/db";
import { sendMail } from "@/lib/mail/transport";

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

  const fromName = process.env.GROWTH_FROM_NAME ?? "The Korrali Team";
  const fromEmail = process.env.GROWTH_FROM_EMAIL ?? "outreach@korrali.com";
  const inboundDomain = process.env.RESEND_INBOUND_DOMAIN ?? null;
  const outreachId = classification.message.outreachId;

  // Thread under the prospect's reply. rfcMessageId is set on replies read from
  // the Workspace mailbox; Resend-era inbound rows only carry Resend's own id,
  // which is not a Message-ID, so they are sent unthreaded rather than wrongly.
  const inReplyTo = classification.message.rfcMessageId;
  const sent = await sendMail({
    from: `${fromName} <${fromEmail}>`,
    to: contact.email,
    subject: replySubject,
    text: classification.founderDraft,
    replyTo: (outreachId && inboundDomain)
      ? `reply+${outreachId}@${inboundDomain}`
      : fromEmail,
    inReplyTo,
    references: inReplyTo ? [inReplyTo] : [],
  });
  const resendMessageId = sent.providerId;

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
        rfcMessageId: sent.rfcMessageId,
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
