import type { CampaignProduct } from "@prisma/client";
import { prisma } from "@/lib/db";
import { classifyActivationRisk } from "@/lib/trials/activation-classifier";
import { getTrialSequence, getWinbackSequence } from "@/lib/trials/sequences";
import { PRODUCTS } from "@/lib/products";

async function sendTrialEmail(
  product: CampaignProduct,
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const brand = PRODUCTS[product].brand;
  const fromName = brand === "Korrali"
    ? (process.env.GROWTH_FROM_NAME ?? "Ashish from Korrali")
    : `Ashish from ${brand}`;
  const fromEmail = process.env.EMAIL_FROM ?? "Ashish from Korrali <growth@korrali.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      text: body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${errText}`);
  }
}

export async function runTrialIntervention(trialId: string): Promise<void> {
  const trial = await prisma.trial.findUniqueOrThrow({ where: { id: trialId } });

  // Reclassify risk — skip if already converted
  if (trial.status !== "ACTIVE") return;

  const risk = classifyActivationRisk(trial);
  await prisma.trial.update({ where: { id: trialId }, data: { activationRisk: risk } });

  // Skip if trial already activated to LOW risk
  if (risk === "LOW") return;

  const sequence = getTrialSequence(trial.product);
  const template = sequence[trial.interventionsSent];
  if (!template) return; // exhausted sequence

  await sendTrialEmail(trial.product, trial.contactEmail, template.subject, template.body);

  await prisma.trial.update({
    where: { id: trialId },
    data: { interventionsSent: trial.interventionsSent + 1 },
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "trial.intervention.sent",
      entity: "Trial",
      entityId: trialId,
      metadata: {
        stepIndex: trial.interventionsSent,
        subject: template.subject,
        risk,
      },
    },
  });
}

/**
 * Sends the next post-expiry win-back email for an EXPIRED trial. Callers
 * decide *when* a step is due (see WINBACK_SCHEDULE_DAYS); this just sends
 * the next unsent step and stops when the sequence is exhausted.
 */
export async function runTrialWinback(trialId: string): Promise<void> {
  const trial = await prisma.trial.findUniqueOrThrow({ where: { id: trialId } });

  if (trial.status !== "EXPIRED") return; // converted or churned since enqueue

  const sequence = getWinbackSequence(trial.product);
  const template = sequence[trial.winbacksSent];
  if (!template) return; // exhausted sequence

  await sendTrialEmail(trial.product, trial.contactEmail, template.subject, template.body);

  await prisma.trial.update({
    where: { id: trialId },
    data: { winbacksSent: trial.winbacksSent + 1 },
  });

  await prisma.auditLog.create({
    data: {
      actor: "system",
      action: "trial.winback.sent",
      entity: "Trial",
      entityId: trialId,
      metadata: {
        stepIndex: trial.winbacksSent,
        subject: template.subject,
      },
    },
  });
}
