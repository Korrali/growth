import { prisma } from "@/lib/db";
import { checkSendEligibility } from "@/lib/sending/eligibility";
import { renderTemplate } from "@/lib/sending/template-renderer";
import { generateUnsubscribeToken } from "@/lib/sending/unsubscribe-token";
import { scheduleNextStep } from "@/lib/sending/sequence-scheduler";
import { injectUtmIntoText } from "@/lib/utm";
import { PRODUCTS } from "@/lib/products";

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

  const bodyWithUtm = injectUtmIntoText(draft.body, {
    source:   "cold_email",
    medium:   "email",
    campaign: outreach.campaign.id,
    content:  `step${stepNumber}`,
  });
  const bodyWithFooter = bodyWithUtm + footer;

  // Send via Resend — sender name follows the campaign's product brand so a
  // BillClear email isn't signed "from Korrali"; the address is shared.
  const brand = PRODUCTS[outreach.campaign.product].brand;
  const fromName = brand === "Korrali"
    ? (process.env.GROWTH_FROM_NAME ?? "Ashish from Korrali")
    : `Ashish from ${brand}`;
  const fromEmail = process.env.GROWTH_FROM_EMAIL ?? "outreach@korrali.com";
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
