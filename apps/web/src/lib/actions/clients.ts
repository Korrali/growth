"use server";

import { requireRole } from "@/lib/rbac";
import { prisma } from "@/lib/db";
import { ClientPlan, ClientStatus } from "@prisma/client";
import Stripe from "stripe";

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

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

async function ensureStripeCustomer(stripe: Stripe, client: { id: string; name: string; contactEmail: string; stripeCustomerId: string | null }) {
  if (client.stripeCustomerId) return client.stripeCustomerId;
  const customer = await stripe.customers.create({
    name: client.name,
    email: client.contactEmail,
    metadata: { growthClientId: client.id },
  });
  await prisma.client.update({ where: { id: client.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

async function createAndSendInvoice(
  stripe: Stripe,
  customerId: string,
  amountCents: number,
  description: string,
  growthClientId: string,
  quantity = 1,
): Promise<{ invoiceUrl: string; invoiceId: string }> {
  await stripe.invoiceItems.create({
    customer: customerId,
    amount: amountCents * quantity,
    currency: "usd",
    description,
  });
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: 7,
    auto_advance: true,
    metadata: { growthClientId },
  });
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id);
  await stripe.invoices.sendInvoice(finalized.id);
  return {
    invoiceUrl: finalized.hosted_invoice_url ?? `https://dashboard.stripe.com/invoices/${finalized.id}`,
    invoiceId: finalized.id,
  };
}

export async function sendSetupInvoiceAction(
  clientId: string,
): Promise<{ invoiceUrl: string; invoiceId: string }> {
  await requireRole("ADMIN");

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  if (client.setupFeeUsd === 0) throw new Error("Setup fee is $0 — update the client before sending");

  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(stripe, client);

  return createAndSendInvoice(
    stripe,
    customerId,
    client.setupFeeUsd * 100,
    `Growth-as-Service Setup Fee — ${client.name}`,
    clientId,
  );
}

export async function sendRetainerInvoiceAction(
  clientId: string,
): Promise<{ invoiceUrl: string; invoiceId: string }> {
  await requireRole("ADMIN");

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  if (client.plan !== "RETAINER") throw new Error("Client is on pay-per-meeting plan — use Send Meeting Invoice instead");
  if (client.monthlyFeeUsd === 0) throw new Error("Monthly fee is $0 — update the client before sending");

  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(stripe, client);

  return createAndSendInvoice(
    stripe,
    customerId,
    client.monthlyFeeUsd * 100,
    `Growth-as-Service Monthly Retainer — ${client.name}`,
    clientId,
  );
}

export async function sendMeetingInvoiceAction(
  clientId: string,
  meetingCount: number,
): Promise<{ invoiceUrl: string; invoiceId: string }> {
  await requireRole("ADMIN");
  if (meetingCount < 1) throw new Error("meetingCount must be at least 1");

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) throw new Error("Client not found");
  if (client.perMeetingFeeUsd === 0) throw new Error("Per-meeting fee is $0 — update the client before sending");

  const stripe = getStripe();
  const customerId = await ensureStripeCustomer(stripe, client);

  return createAndSendInvoice(
    stripe,
    customerId,
    client.perMeetingFeeUsd * 100,
    `Growth-as-Service — ${meetingCount} qualified meeting${meetingCount > 1 ? "s" : ""} — ${client.name}`,
    clientId,
    meetingCount,
  );
}
