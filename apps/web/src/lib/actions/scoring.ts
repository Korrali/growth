"use server";

import { requireRole } from "@/lib/rbac";
import { enqueueFitScore } from "@/lib/queue";
import { bulkScoreCompanies } from "@/lib/ai/fit-scorer";

export async function triggerSingleScoreAction(companyId: string): Promise<void> {
  await requireRole("MEMBER");
  await enqueueFitScore({ companyId });
}

export async function triggerBulkScoreAction(companyIds: string[]): Promise<void> {
  await requireRole("MEMBER");
  await bulkScoreCompanies(companyIds);
}
