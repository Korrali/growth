"use server";

import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { CampaignProduct, CampaignStatus } from "@prisma/client";

export async function createCampaignAction(formData: FormData): Promise<void> {
  await requireRole("MEMBER");

  const name = (formData.get("name") as string)?.trim();
  const product = formData.get("product") as CampaignProduct;
  if (!name || !product) throw new Error("name and product are required");

  await prisma.campaign.create({
    data: {
      name,
      product,
      status: CampaignStatus.DRAFT,
      testMode: true,
    },
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
  await requireRole("OWNER");
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
