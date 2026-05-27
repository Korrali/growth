import { prisma } from "@/lib/db";
import { classifyActivationRisk } from "@/lib/trials/activation-classifier";
import { getTrialSequence } from "@/lib/trials/sequences";

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

  const fromName = process.env.GROWTH_FROM_NAME ?? "Ashish from Korrali";
  const fromEmail = process.env.EMAIL_FROM ?? "Ashish from Korrali <growth@korrali.com>";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [trial.contactEmail],
      subject: template.subject,
      text: template.body,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Resend error ${res.status}: ${errText}`);
  }

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
