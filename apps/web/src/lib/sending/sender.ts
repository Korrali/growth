import { prisma } from "@/lib/db";
import { checkSendEligibility } from "@/lib/sending/eligibility";
import { renderTemplate } from "@/lib/sending/template-renderer";
import { generateUnsubscribeToken } from "@/lib/sending/unsubscribe-token";
import { scheduleNextStep } from "@/lib/sending/sequence-scheduler";

export interface SendResult {
  sent: boolean;
  reason?: string;
  messageId?: string;
}

export async function sendOutreachStep(
  outreachId: string,
  stepNumber: number,
): Promise<SendResult> {
  // Gate check
  const eligibility = await checkSendEligibility(outreachId, stepNumber);
  if (!eligibility.eligible) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.skipped",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, reason: eligibility.reason },
      },
    });
    return { sent: false, reason: eligibility.reason };
  }

  const outreach = await prisma.outreach.findUniqueOrThrow({
    where: { id: outreachId },
    include: {
      contact: true,
      company: true,
      campaign: { include: { sequenceSteps: { orderBy: { stepNumber: "asc" } } } },
    },
  });

  // Test mode — log without sending
  if (outreach.campaign.testMode) {
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.test_mode_send",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, testMode: true },
      },
    });
    await scheduleNextStep(outreachId);
    return { sent: false, reason: "test-mode" };
  }

  // Load AI-generated draft
  const draft = await prisma.outreachEmailDraft.findUnique({
    where: { outreachId_stepNumber: { outreachId, stepNumber } },
  });

  if (!draft) {
    // Live mode — abort if no AI draft exists
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.aborted",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, reason: "no-draft" },
      },
    });
    return { sent: false, reason: "no-draft" };
  }

  const contact = outreach.contact;
  const company = outreach.company;

  // Build unsubscribe footer
  const appUrl = process.env.APP_URL ?? "";
  const token = generateUnsubscribeToken(contact.email);
  const emailB64 = Buffer.from(contact.email.toLowerCase()).toString("base64url");
  const unsubscribeUrl = `${appUrl}/unsubscribe?email=${emailB64}&token=${token}`;
  const footer = `\n\n---\nDon't want to hear from us? [Unsubscribe](${unsubscribeUrl})`;

  const bodyWithFooter = draft.body + footer;

  // Send via Resend
  const fromName = process.env.GROWTH_FROM_NAME ?? "Ashish from Korrali";
  const fromEmail = process.env.GROWTH_FROM_EMAIL ?? "ashish@outreach.korrali.com";
  const inboundDomain = process.env.RESEND_INBOUND_DOMAIN ?? "reply.outreach.korrali.com";

  const payload = {
    from: `${fromName} <${fromEmail}>`,
    to: [contact.email],
    subject: draft.subject,
    text: bodyWithFooter,
    reply_to: `reply+${outreachId}@${inboundDomain}`,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    await prisma.auditLog.create({
      data: {
        actor: "system",
        action: "outreach.send.failed",
        entity: "Outreach",
        entityId: outreachId,
        metadata: { stepNumber, status: res.status, error: errorText },
      },
    });
    throw new Error(`Resend API error ${res.status}: ${errorText}`);
  }

  const resendData = (await res.json()) as { id: string };

  // Record EmailMessage
  await prisma.emailMessage.create({
    data: {
      outreachId,
      contactId: contact.id,
      direction: "OUTBOUND",
      subject: draft.subject,
      body: bodyWithFooter,
      resendMessageId: resendData.id,
      sentAt: new Date(),
      stepNumber,
    },
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "outreach.sent",
      entity: "Outreach",
      entityId: outreachId,
      metadata: { stepNumber, resendMessageId: resendData.id, to: contact.email },
    },
  });

  // Schedule next step
  await scheduleNextStep(outreachId);

  return { sent: true, messageId: resendData.id };
}
