import { prisma } from "@/lib/db";
import { SuppressionReason } from "@prisma/client";
import { addEmailSuppression } from "@/lib/sending/suppression";
import { enqueueOutreachSend } from "@/lib/queue";

const STOP_SUPPRESS_REASONS = new Set(["unsubscribe", "bounce", "negative"]);

export async function stopOutreachSequence(
  outreachId: string,
  reason: string,
): Promise<void> {
  const outreach = await prisma.outreach.findUniqueOrThrow({
    where: { id: outreachId },
    include: { contact: true },
  });

  await prisma.outreach.update({
    where: { id: outreachId },
    data: { status: "STOPPED", stoppedAt: new Date(), stoppedReason: reason },
  });

  // Suppress contact email for terminal unsubscribe/bounce reasons
  const lowerReason = reason.toLowerCase();
  if (STOP_SUPPRESS_REASONS.has(lowerReason)) {
    const suppressReason =
      lowerReason === "unsubscribe"
        ? SuppressionReason.UNSUBSCRIBED
        : lowerReason === "bounce"
          ? SuppressionReason.BOUNCED
          : SuppressionReason.MANUAL;

    await addEmailSuppression(outreach.contact.email, suppressReason);
    await prisma.contact.update({
      where: { id: outreach.contactId },
      data: { suppressedAt: new Date(), suppressReason },
    });
  }

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "outreach.stopped",
      entity: "Outreach",
      entityId: outreachId,
      metadata: { reason },
    },
  });
}

export async function scheduleNextStep(outreachId: string): Promise<void> {
  const outreach = await prisma.outreach.findUniqueOrThrow({
    where: { id: outreachId },
    include: {
      campaign: { include: { sequenceSteps: { orderBy: { stepNumber: "asc" } } } },
    },
  });

  const nextStepNumber = outreach.currentStep + 1;
  const nextStep = outreach.campaign.sequenceSteps.find(
    (s) => s.stepNumber === nextStepNumber,
  );

  if (!nextStep) {
    // No more steps — sequence complete
    await prisma.outreach.update({
      where: { id: outreachId },
      data: { status: "COMPLETED" },
    });
    return;
  }

  const nextSendAt = new Date();
  nextSendAt.setDate(nextSendAt.getDate() + nextStep.delayDays);

  await prisma.outreach.update({
    where: { id: outreachId },
    data: {
      currentStep: nextStepNumber,
      nextSendAt,
      status: "ACTIVE",
    },
  });

  await enqueueOutreachSend(
    { outreachId, stepNumber: nextStepNumber },
    { startAfter: nextSendAt },
  );
}
