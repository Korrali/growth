"use server";

import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { enqueueCallBrief, enqueueCallFollowup } from "@/lib/queue";

export async function generateCallBriefAction(callId: string): Promise<void> {
  await requireRole("MEMBER");
  await enqueueCallBrief({ callId });
}

export async function generateCallFollowupAction(callId: string): Promise<void> {
  await requireRole("MEMBER");
  await enqueueCallFollowup({ callId });
}

export async function saveCallNotesAction(callId: string, notes: string): Promise<void> {
  await requireRole("MEMBER");
  await prisma.call.update({ where: { id: callId }, data: { notes } });
}

export async function createCallAction(formData: FormData): Promise<void> {
  await requireRole("MEMBER");

  const contactId = formData.get("contactId") as string;
  const scheduledAtStr = formData.get("scheduledAt") as string | null;
  const outreachId = formData.get("outreachId") as string | null;

  if (!contactId) throw new Error("contactId is required");

  const contact = await prisma.contact.findUniqueOrThrow({ where: { id: contactId } });

  await prisma.call.create({
    data: {
      contactId,
      companyId: contact.companyId ?? undefined,
      outreachId: outreachId ?? undefined,
      scheduledAt: scheduledAtStr ? new Date(scheduledAtStr) : undefined,
    },
  });
}
