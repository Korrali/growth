import { prisma } from "@/lib/db";
import { SuppressionReason, SuppressionType } from "@prisma/client";

export function extractDomain(email: string): string {
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2 || !parts[1]) return "";
  // Strip leading www. subdomain for domain matching
  return parts[1].replace(/^www\./, "");
}

export async function isEmailSuppressed(email: string): Promise<boolean> {
  const row = await prisma.suppression.findUnique({
    where: { value: email.toLowerCase() },
    select: { id: true },
  });
  return row !== null;
}

export async function isDomainSuppressed(domain: string): Promise<boolean> {
  const row = await prisma.suppression.findFirst({
    where: { type: SuppressionType.DOMAIN, value: domain.toLowerCase() },
    select: { id: true },
  });
  return row !== null;
}

export async function getDomainSuppressionReason(
  domain: string,
): Promise<SuppressionReason | null> {
  const row = await prisma.suppression.findFirst({
    where: { type: SuppressionType.DOMAIN, value: domain.toLowerCase() },
    select: { reason: true },
  });
  return row?.reason ?? null;
}

export async function addEmailSuppression(
  email: string,
  reason: SuppressionReason,
): Promise<void> {
  await prisma.suppression.upsert({
    where: { value: email.toLowerCase() },
    create: { type: SuppressionType.EMAIL, value: email.toLowerCase(), reason },
    update: { reason },
  });
}

export async function addDomainSuppression(
  domain: string,
  reason: SuppressionReason,
): Promise<void> {
  await prisma.suppression.upsert({
    where: { value: domain.toLowerCase() },
    create: { type: SuppressionType.DOMAIN, value: domain.toLowerCase(), reason },
    update: { reason },
  });
}
