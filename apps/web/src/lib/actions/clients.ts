"use server";

import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ClientPlan, ClientStatus } from "@prisma/client";

export async function createClientAction(formData: FormData): Promise<string> {
  await requireRole("ADMIN");

  const name = (formData.get("name") as string)?.trim();
  const contactEmail = (formData.get("contactEmail") as string)?.trim().toLowerCase();
  const plan = formData.get("plan") as ClientPlan;
  const fromName = (formData.get("fromName") as string)?.trim();
  const fromEmail = (formData.get("fromEmail") as string)?.trim().toLowerCase();
  const icpProfile = (formData.get("icpProfile") as string)?.trim();
  const inboundDomain = (formData.get("inboundDomain") as string)?.trim() || null;
  const setupFeeUsd = parseInt(formData.get("setupFeeUsd") as string) || 0;
  const monthlyFeeUsd = parseInt(formData.get("monthlyFeeUsd") as string) || 0;
  const perMeetingFeeUsd = parseInt(formData.get("perMeetingFeeUsd") as string) || 0;
  const notes = (formData.get("notes") as string)?.trim() || null;

  if (!name || !contactEmail || !plan || !fromName || !fromEmail || !icpProfile) {
    throw new Error("name, contactEmail, plan, fromName, fromEmail, and icpProfile are required");
  }

  const client = await prisma.client.create({
    data: {
      name,
      contactEmail,
      plan,
      fromName,
      fromEmail,
      icpProfile,
      inboundDomain,
      setupFeeUsd,
      monthlyFeeUsd,
      perMeetingFeeUsd,
      notes,
    },
  });

  return client.id;
}

export async function updateClientAction(clientId: string, formData: FormData): Promise<void> {
  await requireRole("ADMIN");

  const name = (formData.get("name") as string)?.trim();
  const plan = formData.get("plan") as ClientPlan;
  const status = formData.get("status") as ClientStatus;
  const fromName = (formData.get("fromName") as string)?.trim();
  const fromEmail = (formData.get("fromEmail") as string)?.trim().toLowerCase();
  const icpProfile = (formData.get("icpProfile") as string)?.trim();
  const inboundDomain = (formData.get("inboundDomain") as string)?.trim() || null;
  const setupFeeUsd = parseInt(formData.get("setupFeeUsd") as string) || 0;
  const monthlyFeeUsd = parseInt(formData.get("monthlyFeeUsd") as string) || 0;
  const perMeetingFeeUsd = parseInt(formData.get("perMeetingFeeUsd") as string) || 0;
  const stripeCustomerId = (formData.get("stripeCustomerId") as string)?.trim() || null;
  const stripeSubscriptionId = (formData.get("stripeSubscriptionId") as string)?.trim() || null;
  const notes = (formData.get("notes") as string)?.trim() || null;

  await prisma.client.update({
    where: { id: clientId },
    data: {
      ...(name && { name }),
      ...(plan && { plan }),
      ...(status && { status }),
      ...(fromName && { fromName }),
      ...(fromEmail && { fromEmail }),
      ...(icpProfile && { icpProfile }),
      inboundDomain,
      setupFeeUsd,
      monthlyFeeUsd,
      perMeetingFeeUsd,
      stripeCustomerId,
      stripeSubscriptionId,
      notes,
    },
  });
}

export async function updateClientStatusAction(
  clientId: string,
  status: ClientStatus,
): Promise<void> {
  await requireRole("ADMIN");
  await prisma.client.update({ where: { id: clientId }, data: { status } });
}
