"use server";

import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { CampaignProduct, CampaignStatus } from "@prisma/client";

export async function createCampaignAction(formData: FormData): Promise<void> {
  await requireRole("MEMBER");

  const name = (formData.get("name") as string)?.trim();
  const product = formData.get("product") as CampaignProduct;
  const clientId = (formData.get("clientId") as string)?.trim() || null;
  if (!name || !product) throw new Error("name and product are required");

  await prisma.campaign.create({
    data: {
      name,
      product,
      status: CampaignStatus.DRAFT,
      testMode: true,
      ...(clientId && { clientId }),
    },
  });
}

export async function updateCampaignClientAction(
  campaignId: string,
  formData: FormData,
): Promise<void> {
  await requireRole("MEMBER");

  const clientId = (formData.get("clientId") as string)?.trim() || null;
  const replyForwardTo = (formData.get("replyForwardTo") as string)?.trim() || null;
  const fromName = (formData.get("fromName") as string)?.trim() || null;
  const fromEmail = (formData.get("fromEmail") as string)?.trim().toLowerCase() || null;

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { clientId, replyForwardTo, fromName, fromEmail },
  });
}

export async function updateCampaignStatusAction(
  campaignId: string,
  status: CampaignStatus,
): Promise<void> {
  await requireRole("MEMBER");
  await prisma.campaign.update({ where: { id: campaignId }, data: { status } });
}

export async function pauseCampaignAction(campaignId: string): Promise<void> {
  await requireRole("MEMBER");
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: CampaignStatus.PAUSED },
  });
}

export async function globalEmergencyStopAction(): Promise<void> {
  await requireRole("SUPER_ADMIN");
  await prisma.growthSettings.upsert({
    where: { id: "global" },
    create: { id: "global", globalEmergencyStop: true },
    update: { globalEmergencyStop: true },
  });

  await prisma.auditLog.create({
    data: {
      actor: "founder",
      action: "settings.emergency_stop.activated",
      entity: "GrowthSettings",
      entityId: "global",
    },
  });
}
