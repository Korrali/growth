"use server";

import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { enqueueOutreachSend, enqueueEmailGenerate } from "@/lib/queue";
import { stopOutreachSequence } from "@/lib/sending/sequence-scheduler";

export async function enqueueOutreachAction(formData: FormData): Promise<void> {
  await requireRole("MEMBER");

  const contactId = formData.get("contactId") as string;
  const campaignId = formData.get("campaignId") as string;
  if (!contactId || !campaignId) throw new Error("contactId and campaignId required");

  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });

  const outreach = await prisma.outreach.upsert({
    where: { contactId_campaignId: { contactId, campaignId } },
    create: {
      contactId,
      campaignId,
      companyId: contact.companyId ?? undefined,
      status: "PENDING",
      currentStep: 1,
    },
    update: {},
  });

  // Enqueue email generation first, then send
  await enqueueEmailGenerate({ outreachId: outreach.id });
  await enqueueOutreachSend({ outreachId: outreach.id, stepNumber: 1 });
}

export async function stopOutreachAction(outreachId: string): Promise<void> {
  await requireRole("MEMBER");
  await stopOutreachSequence(outreachId, "manual");
}
