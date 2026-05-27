"use server";

import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ContentType } from "@prisma/client";
import { enqueueContentGenerate } from "@/lib/queue";

export async function generateContentAction(
  type: ContentType,
  sourceData: Record<string, unknown>,
): Promise<void> {
  await requireRole("MEMBER");
  await enqueueContentGenerate({ type, sourceData });
}

export async function approveContentAction(draftId: string): Promise<void> {
  await requireRole("MEMBER");
  await prisma.contentDraft.update({
    where: { id: draftId },
    data: { status: "approved" },
  });
}
